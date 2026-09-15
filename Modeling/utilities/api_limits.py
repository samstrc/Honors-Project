"""
Two questions about the deployed model, answered by measurement rather than inspection.

1. Which form fields actually matter? The top-600 selection dropped several raw
   application columns, but some of those still feed derived features that survived
   (CNT_CHILDREN is gone, INCOME_PER_CHILD is not). So checking whether a column made
   the feature list is the wrong test. This script perturbs each field on a baseline
   applicant and measures how many model inputs change and how far the prediction moves.

2. How much does the missing credit history cost? The API leaves most auxiliary-table
   aggregates NaN, since a prospective applicant has no bureau record to join. Two
   separate numbers come out of this: the AUC lost by blanking those columns, and how
   the model does on clients who genuinely have no history. The second one is the real
   ceiling for a thin-file scorecard.
"""

from __future__ import annotations

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from evaluation import RESULTS, load
from build_features import add_application_features
from run_one import select_features

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
NAME = "lightgbm_tuned_v2"

BASELINE = {
    "AMT_INCOME_TOTAL": 150000, "AMT_CREDIT": 500000, "AMT_ANNUITY": 25000,
    "AMT_GOODS_PRICE": 450000, "DAYS_BIRTH": -35 * 365, "DAYS_EMPLOYED": -5 * 365,
    "DAYS_EMPLOYED_ANOM": 0, "CNT_CHILDREN": 1, "CNT_FAM_MEMBERS": 3,
    "CODE_GENDER": "F", "NAME_FAMILY_STATUS": "Married",
    "NAME_EDUCATION_TYPE": "Secondary / secondary special",
    "NAME_HOUSING_TYPE": "House / apartment", "NAME_INCOME_TYPE": "Working",
    "NAME_CONTRACT_TYPE": "Cash loans", "FLAG_OWN_CAR": "N", "FLAG_OWN_REALTY": "Y",
    "OCCUPATION_TYPE": "Laborers", "EXT_SOURCE_1": 0.5, "EXT_SOURCE_2": 0.5,
    "EXT_SOURCE_3": 0.5,
}

# Alternative values used to perturb each field.
VARIANTS = {
    "AMT_INCOME_TOTAL": [60000, 400000], "AMT_CREDIT": [150000, 1200000],
    "AMT_ANNUITY": [10000, 60000], "AMT_GOODS_PRICE": [150000, 1000000],
    "DAYS_BIRTH": [-22 * 365, -60 * 365], "DAYS_EMPLOYED": [-0.5 * 365, -25 * 365],
    "DAYS_EMPLOYED_ANOM": [1], "CNT_CHILDREN": [0, 4], "CNT_FAM_MEMBERS": [1, 6],
    "CODE_GENDER": ["M"], "NAME_FAMILY_STATUS": ["Single / not married", "Widow"],
    "NAME_EDUCATION_TYPE": ["Higher education", "Lower secondary"],
    "NAME_HOUSING_TYPE": ["Rented apartment", "With parents"],
    "NAME_INCOME_TYPE": ["Pensioner", "Commercial associate"],
    "NAME_CONTRACT_TYPE": ["Revolving loans"], "FLAG_OWN_CAR": ["Y"],
    "FLAG_OWN_REALTY": ["N"], "OCCUPATION_TYPE": ["Managers", "Low-skill Laborers"],
    "EXT_SOURCE_1": [0.1, 0.9], "EXT_SOURCE_2": [0.1, 0.9], "EXT_SOURCE_3": [0.1, 0.9],
}


def build(raw: dict, schema: dict) -> pd.DataFrame:
    df = add_application_features(pd.DataFrame([raw])).reindex(columns=schema["features"])
    for c, levels in schema["categoricals"].items():
        df[c] = pd.Categorical(df[c].astype("object"), categories=levels)
    for c in df.columns:
        if c not in schema["categoricals"]:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("float32")
    return df


def field_sensitivity(model, schema):
    base_X = build(BASELINE, schema)
    base_p = float(model.predict_proba(base_X)[0, 1])
    base_vals = base_X.iloc[0]
    print(f"baseline applicant: P(default) = {base_p:.4%}\n")

    rows = []
    for field, alts in VARIANTS.items():
        touched, moves = set(), []
        for alt in alts:
            raw = dict(BASELINE)
            raw[field] = alt
            X = build(raw, schema)
            p = float(model.predict_proba(X)[0, 1])
            moves.append(abs(p - base_p))
            v = X.iloc[0]
            for c in X.columns:
                a, b = base_vals[c], v[c]
                if pd.isna(a) and pd.isna(b):
                    continue
                if pd.isna(a) != pd.isna(b) or a != b:
                    touched.add(c)
        rows.append({"form field": field, "model inputs changed": len(touched),
                     "max |dP|": max(moves)})

    df = pd.DataFrame(rows).sort_values("max |dP|", ascending=False).reset_index(drop=True)
    df["max |dP|"] = (df["max |dP|"] * 100).round(3)
    print(df.to_string(index=False))
    print("\n(max |dP| is the largest absolute change in predicted default probability,")
    print(" in percentage points, from changing that one field alone.)")
    return df


def credit_history_cost(model, schema, X_test, y_test):
    feats = schema["features"]
    # Aggregate columns come from the five auxiliary tables; the rest are application-level.
    aux_prefixes = ("BURO_", "BB_", "PREV_", "POS_", "INS_", "CC_", "INSL_")
    aux = [c for c in feats if c.startswith(aux_prefixes)]
    coh = [c for c in feats if c.startswith("COH_")]
    app_only = [c for c in feats if c not in set(aux) | set(coh)]
    print(f"\nfeature groups: {len(app_only)} application-level, {len(aux)} auxiliary-table, "
          f"{len(coh)} cohort")

    full_p = model.predict_proba(X_test)[:, 1]
    print(f"\n{'scenario':<46} {'AUC':>8} {'delta':>9}")
    base_auc = roc_auc_score(y_test, full_p)
    print(f"{'everything available (as trained)':<46} {base_auc:>8.5f} {'--':>9}")

    # What the API actually sees for a prospective applicant.
    X_blank = X_test.copy()
    X_blank[aux] = np.nan
    blank_auc = roc_auc_score(y_test, model.predict_proba(X_blank)[:, 1])
    print(f"{'auxiliary aggregates blanked (API today)':<46} {blank_auc:>8.5f} "
          f"{blank_auc - base_auc:>+9.5f}")

    X_blank2 = X_blank.copy()
    X_blank2[coh] = np.nan
    b2 = roc_auc_score(y_test, model.predict_proba(X_blank2)[:, 1])
    print(f"{'+ cohort features blanked':<46} {b2:>8.5f} {b2 - base_auc:>+9.5f}")

    # Clients who genuinely have no bureau record -- the honest thin-file population.
    if "BURO_COUNT" in X_test.columns:
        thin = (X_test["BURO_COUNT"].fillna(0) == 0).to_numpy()
        print(f"\nclients with no bureau record at all: {thin.sum():,} of {len(X_test):,} "
              f"({thin.mean():.1%}), default rate {y_test.to_numpy()[thin].mean():.2%} "
              f"vs {y_test.mean():.2%} overall")
        if thin.sum() > 500:
            a = roc_auc_score(y_test.to_numpy()[thin], full_p[thin])
            print(f"  model AUC on that subgroup (with their real features): {a:.5f}")
        thick = ~thin
        a2 = roc_auc_score(y_test.to_numpy()[thick], full_p[thick])
        print(f"  model AUC on clients who DO have history:                 {a2:.5f}")


def main():
    with open(os.path.join(MODEL_DIR, f"{NAME}_schema.json")) as f:
        schema = json.load(f)
    model = joblib.load(os.path.join(MODEL_DIR, f"{NAME}.joblib"))

    print("=" * 72)
    print("1. FORM FIELD SENSITIVITY")
    print("=" * 72)
    sens = field_sensitivity(model, schema)
    sens.to_csv(os.path.join(RESULTS, "form_field_sensitivity.csv"), index=False)

    print("\n" + "=" * 72)
    print("2. COST OF MISSING CREDIT HISTORY")
    print("=" * 72)
    X_train, X_test, y_train, y_test = load("full_plus")
    keep = select_features(os.path.join(RESULTS, "features_top600.json"), X_train, "full_plus")
    credit_history_cost(model, schema, X_test[keep], y_test)


if __name__ == "__main__":
    main()
