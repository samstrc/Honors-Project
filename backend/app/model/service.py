"""The model behind the preapproval form.

Takes the fields a form can realistically ask for, rebuilds as many of the model's
features as those fields allow, and returns a probability, a decision against the saved
threshold, and the factors that moved the score. A lending-policy rule (affordability)
can decline an application whatever its score, and some scores carry a caveat.

The model is trained on the form's fields alone (modeling/03_train.ipynb), so what it is
given here is what it learned from. Its test AUC is saved in the schema file and reported
by /api/health.
"""

from __future__ import annotations

import json
import os
import sys
from functools import cache
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import HTTPException

from ..paths import MODEL_NAME, MODELING_DIR, MODELS_DIR
from .schema import FeatureContribution, LoanApplication, PreapprovalResponse

# Derived features come from the same function the training pipeline uses. A second copy
# of these formulas here would be free to drift, and that kind of train/serve skew is hard
# to catch from outside: the predictions stay plausible while quietly getting worse.
sys.path.insert(0, MODELING_DIR)
from features import add_application_features  # noqa: E402

# Built by modeling/03_train.ipynb. No calibration wrapper: without scale_pos_weight, and
# trained on the inputs it is served, the model's probabilities come out calibrated on
# their own (03_train, section 7).

N_TOP_FACTORS = 8

# Lending policy, applied on top of the model. The model can't enforce affordability: in
# the training data a payment of 40-50% of income missed early payments at 8.6%, barely
# above the 8.1% average, because Home Credit had already turned away the applicants who
# couldn't pay. A lender still wouldn't approve them, so neither does this tool. 40% is
# the policy line (about 2.6% of real applicants were above it), not something learned.
MAX_PAYMENT_SHARE_OF_INCOME = 0.40

# The form leaves job length blank for these, and in training a blank job length almost
# always meant a pensioner (55,352 of 55,374), a low-risk group. Only 22 unemployed
# applicants and 18 students were in the data, too few to correct for, so the score is
# shown with a warning instead.
UNRELIABLE_INCOME_TYPES = {"Unemployed": ("unemployed applicants", 22), "Student": ("students", 18)}


def _model_file(suffix: str) -> str:
    return os.path.join(MODELS_DIR, f"{MODEL_NAME}{suffix}")


def _read_json(suffix: str, default: Any = None) -> Any:
    path = _model_file(suffix)
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


@cache
def get_model():
    path = _model_file(".joblib")
    if not os.path.exists(path):
        raise RuntimeError(f"Model file not found at {path}. Run modeling/03_train.ipynb first.")
    return joblib.load(path)


@cache
def get_schema():
    """Feature order and categorical levels the model was fit with.

    LightGBM matches categoricals by integer code, so serving a frame whose category
    levels are ordered differently would silently map e.g. "Married" onto whatever level
    happened to occupy that slot. The levels are pinned at export time for that reason.
    """
    schema = _read_json("_schema.json")
    if schema is None:
        raise RuntimeError(f"Schema not found at {_model_file('_schema.json')}. Run modeling/03_train.ipynb.")
    return schema


@cache
def get_cohorts():
    """Group means/stds so a single applicant can be placed against their cohort.

    Without them every cohort feature arrives missing. A missing file is not fatal: the
    features just stay NaN, which costs accuracy but still scores.
    """
    return _read_json("_cohorts.json", {"numerics": [], "cohorts": {}})


@cache
def get_percentile_edges():
    return _read_json("_percentiles.json", {}).get("percentile_edges", [])


# The cutoff is a business decision (a missed default against a good applicant turned
# away), taken from out-of-fold F1 in the notebook. The env var is only a fallback.
_threshold = _read_json("_threshold.json")
DEFAULT_THRESHOLD = float(_threshold["threshold"] if _threshold else os.environ.get("PREAPPROVAL_THRESHOLD", "0.158"))


def warm():
    """Load everything up front so the first request doesn't pay for it."""
    get_model()
    get_schema()
    get_percentile_edges()
    get_cohorts()


def add_cohort_features(row: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Return `df` with COH_*_MEAN and COH_*_Z added, for cohorts the form can resolve.

    A cohort whose key the form does not collect (ORGANIZATION_TYPE, when the applicant
    leaves it blank) is skipped and its features stay missing, which the model handles.
    The new columns are joined in one concat: inserting 128 one at a time fragments the
    frame and makes pandas warn on every request.
    """
    new: dict[str, float] = {}
    for tag, spec in get_cohorts().get("cohorts", {}).items():
        vals = [row.get(k) for k in spec["keys"]]
        if any(v is None for v in vals):
            continue
        stats = spec["stats"].get("||".join(str(v) for v in vals))
        if not stats:
            continue
        for col, (mean, std) in stats.items():
            own = df[col].iloc[0] if col in df.columns else np.nan
            new[f"COH_{tag}_{col}_MEAN"] = mean
            new[f"COH_{tag}_{col}_Z"] = (own - mean) / (std + 1e-6)
    if not new:
        return df
    return pd.concat([df, pd.DataFrame([new], index=df.index)], axis=1)


def compute_risk_percentile(proba: float) -> int:
    edges = get_percentile_edges()
    if not edges:
        return 50  # no reference distribution available, so say "middle"
    return int(np.searchsorted(edges, proba)) + 1


def health():
    schema = get_schema()
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "threshold": DEFAULT_THRESHOLD,
        "n_features": len(schema["features"]),
        "cohort_tables": len(get_cohorts().get("cohorts", {})),
        "test_auc": schema.get("test_auc"),
    }


def build_feature_row(app_data: LoanApplication) -> pd.DataFrame:
    """Turn the request into the frame the model expects, in the schema's column order.

    Every feature the model was trained on is one a form can supply (modeling/features.py,
    `form_feature_columns`), so a fully answered form fills them all. Optional answers left
    blank (occupation, employer, card utilization) stay NaN, which LightGBM routes natively
    and saw plenty of in training.
    """
    schema = get_schema()

    raw = {
        "AMT_INCOME_TOTAL": app_data.income,
        "AMT_CREDIT": app_data.credit_amount,
        "AMT_ANNUITY": app_data.annuity,
        "AMT_GOODS_PRICE": app_data.goods_price,
        "DAYS_BIRTH": -app_data.age_years * 365,
        "CNT_CHILDREN": app_data.children,
        "CNT_FAM_MEMBERS": app_data.family_members,
        "NAME_EDUCATION_TYPE": app_data.education.value,
        "NAME_INCOME_TYPE": app_data.income_type.value,
        "EXT_SOURCE_1": app_data.ext_score_1,
        "EXT_SOURCE_2": app_data.ext_score_2,
        "EXT_SOURCE_3": app_data.ext_score_3,
    }
    # Blank scores stay missing. 03_train hides the scores on a share of its training rows,
    # producing exactly these inputs, so the model has learned to score a form without them.
    if app_data.occupation is not None:
        raw["OCCUPATION_TYPE"] = app_data.occupation.value
    if app_data.organization_type:
        raw["ORGANIZATION_TYPE"] = app_data.organization_type

    # Training turned Home Credit's "not currently employed" code into NaN plus a flag
    years_employed = app_data.years_employed
    employed = years_employed is not None
    raw["DAYS_EMPLOYED"] = -years_employed * 365 if years_employed is not None else np.nan
    raw["DAYS_EMPLOYED_ANOM"] = 0 if employed else 1

    if app_data.cc_utilization is not None:
        raw["CC_UTILIZATION_MEAN"] = app_data.cc_utilization
        raw["CC_COUNT"] = 1

    df = add_application_features(pd.DataFrame([raw]))
    df = add_cohort_features(raw, df)
    # Anything the model expects but we couldn't derive becomes NaN, and anything we
    # derived that the importance sweep dropped gets dropped.
    df = df.reindex(columns=schema["features"])

    for col, levels in schema["categoricals"].items():
        df[col] = pd.Categorical(df[col].astype("object"), categories=levels)
    for col in df.columns:
        if col not in schema["categoricals"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float32")

    return df


def uses_own_scores(app_data: LoanApplication) -> bool:
    return any(v is not None for v in (app_data.ext_score_1, app_data.ext_score_2, app_data.ext_score_3))


def policy_and_notes(app_data: LoanApplication) -> tuple[str | None, list[str]]:
    """The policy decline reason, if any, and the caveats to show beside the score."""
    reason = None
    share = app_data.annuity / app_data.income
    if share > MAX_PAYMENT_SHARE_OF_INCOME:
        reason = (f"The payment is {share:.0%} of monthly income, over the "
                  f"{MAX_PAYMENT_SHARE_OF_INCOME:.0%} limit.")

    notes = []
    if app_data.income_type.value in UNRELIABLE_INCOME_TYPES:
        group, n = UNRELIABLE_INCOME_TYPES[app_data.income_type.value]
        notes.append(f"Less reliable for {group}: only {n} were in the data, and with no "
                     f"job length the model reads them much like a pensioner.")
    if not uses_own_scores(app_data):
        notes.append("No bureau scores given, so this is scored on the rest of the form. "
                     "Real scores could move it a lot.")
    return reason, notes


FEATURE_LABELS = {
    # Bureau scores use the form's own name for them, so a reason on the result page
    # points at a field the applicant can find.
    "EXT_SOURCE_1": "Bureau score 1",
    "EXT_SOURCE_2": "Bureau score 2",
    "EXT_SOURCE_3": "Bureau score 3",
    "EXT_SOURCES_MEAN": "Bureau scores, average",
    "EXT_SOURCES_MIN": "Bureau scores, lowest",
    "EXT_SOURCES_MAX": "Bureau scores, highest",
    "EXT_SOURCES_WEIGHTED": "Bureau scores, weighted",
    "EXT_SOURCES_PROD": "Bureau scores, combined",
    "EXT_SOURCES_NAN_COUNT": "Missing bureau scores",
    "EXT_SOURCE_1_X_AGE": "Bureau score 1 with age",
    "EXT_SOURCE_2_X_AGE": "Bureau score 2 with age",
    "EXT_SOURCE_3_X_AGE": "Bureau score 3 with age",
    "EXT_SOURCE_1_X_EMPLOYED": "Bureau score 1 with time employed",
    "EXT_SOURCE_2_X_EMPLOYED": "Bureau score 2 with time employed",
    "EXT_SOURCE_3_X_EMPLOYED": "Bureau score 3 with time employed",
    "DAYS_EMPLOYED_ANOM": "No employment record",
    "CREDIT_TERM": "Monthly payment as a share of loan amount",
    "CREDIT_INCOME_RATIO": "Loan amount vs. income",
    "ANNUITY_INCOME_RATIO": "Monthly payment vs. income",
    "CREDIT_GOODS_RATIO": "Loan amount vs. item price",
    "CREDIT_MINUS_GOODS": "Loan amount above item price",
    "GOODS_INCOME_RATIO": "Item price vs. income",
    "INCOME_PER_PERSON": "Income per household member",
    "INCOME_PER_CHILD": "Income per child",
    "CHILDREN_RATIO": "Children as a share of the household",
    "CNT_CHILDREN": "Children",
    "CNT_FAM_MEMBERS": "People in household",
    "DAYS_BIRTH": "Age",
    "DAYS_EMPLOYED": "Years at current job",
    "EMPLOYED_BIRTH_RATIO": "Share of life spent employed",
    "AMT_INCOME_TOTAL": "Income",
    "AMT_CREDIT": "Loan amount",
    "AMT_ANNUITY": "Monthly payment",
    "AMT_GOODS_PRICE": "Item price",
    "NAME_EDUCATION_TYPE": "Education",
    "NAME_INCOME_TYPE": "Income source",
    "OCCUPATION_TYPE": "Occupation",
    "ORGANIZATION_TYPE": "Employer type",
    "CC_UTILIZATION_MEAN": "Credit card use",
    "CC_COUNT": "Credit card history",
}

# Cohort features (features.py) compare an applicant with others in the same group.
# COH_<group>_<value>_MEAN is the group's average; COH_<group>_<value>_Z is how far the
# applicant sits from it.
COHORT_GROUPS = {"ORG": "employer type", "OCC": "occupation", "EDU": "education",
                 "INC": "income source"}
COHORT_VALUES = {"EXT_SOURCES_MEAN": "bureau score", "AMT_INCOME_TOTAL": "income",
                 "AMT_CREDIT": "loan amount", "AMT_ANNUITY": "monthly payment",
                 "CREDIT_INCOME_RATIO": "loan vs. income", "ANNUITY_INCOME_RATIO": "payment vs. income",
                 "DAYS_EMPLOYED": "time employed", "DAYS_BIRTH": "age"}


def _cohort_label(name: str) -> str | None:
    body = name[len("COH_"):]
    for code, group in sorted(COHORT_GROUPS.items(), key=lambda kv: -len(kv[0])):
        if not body.startswith(code + "_"):
            continue
        rest = body[len(code) + 1:]
        for suffix, template in (("_MEAN", "Average {v} in your {g} group"), ("_Z", "{V} compared with your {g} group")):
            if rest.endswith(suffix) and rest[: -len(suffix)] in COHORT_VALUES:
                v = COHORT_VALUES[rest[: -len(suffix)]]
                return template.format(v=v, V=v[0].upper() + v[1:], g=group)
    return None


def prettify(name: str) -> str:
    """Turn an internal feature name into something a loan officer can read."""
    if name in FEATURE_LABELS:
        return FEATURE_LABELS[name]
    if name.startswith("COH_") and (label := _cohort_label(name)):
        return label
    return name.replace("_", " ").capitalize()


def explain_row(model, X: pd.DataFrame):
    """Exact per-feature contributions from LightGBM's own SHAP implementation.

    `pred_contrib=True` returns one column per feature plus a trailing expected-value
    column, in log-odds space. Using the booster directly rather than the `shap` package
    means categorical splits are handled by the same code that made them.
    """
    contrib = model.booster_.predict(X, pred_contrib=True)[0]
    expected_value = float(contrib[-1])
    values = contrib[:-1]

    # Features we couldn't populate contribute nothing and would just be noise in a
    # "why was I declined" answer, so drop them before ranking.
    populated = ~X.iloc[0].isna().to_numpy()
    idx = [i for i in range(len(values)) if populated[i] and values[i] != 0]
    order = sorted(idx, key=lambda i: -abs(values[i]))[:N_TOP_FACTORS]

    top = [FeatureContribution(feature=prettify(X.columns[i]), contribution=float(values[i]))
           for i in order]
    # `idx` is every feature that moved the score at all. The caller needs the count so the
    # site can say the chart shows the largest few of that many rather than all of them.
    return top, expected_value, len(idx)


def predict(app_data: LoanApplication):
    model = get_model()
    try:
        X = build_feature_row(app_data)
        proba = float(model.predict_proba(X)[0, 1])
        top_factors, base_rate, n_contributing = explain_row(model, X)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

    policy_reason, notes = policy_and_notes(app_data)
    decision = "declined" if proba >= DEFAULT_THRESHOLD or policy_reason else "preapproved"
    return PreapprovalResponse(
        default_probability=proba,
        threshold=DEFAULT_THRESHOLD,
        decision=decision,
        model_used=MODEL_NAME,
        risk_percentile=compute_risk_percentile(proba),
        base_rate=base_rate,
        n_contributing=n_contributing,
        top_factors=top_factors,
        policy_reason=policy_reason,
        notes=notes,
    )
