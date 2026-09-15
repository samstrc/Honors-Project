"""FastAPI service behind the preapproval form.

Takes the fields a form can realistically ask for, rebuilds as many of the model's
features as those fields allow, and returns a probability, a decision against the saved
threshold, and the factors that moved the score.

A form carries no credit history, so most features arrive missing and the model runs at
roughly 0.760 AUC here instead of the 0.797 it reaches with full history.
"""

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException

from api.schema import FeatureContribution, LoanApplication, PreapprovalResponse

# Derived features come from the same function the training pipeline uses. A second copy
# of these formulas here would be free to drift, and that kind of train/serve skew is hard
# to catch from outside: the predictions stay plausible while quietly getting worse.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "utilities"))
from build_features import add_application_features  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")

# Built in Part 2 of the notebook: test AUC 0.7770 -> 0.7970.
#
# No calibration wrapper here. The Part 1 model needed CalibratedClassifierCV(isotonic)
# because scale_pos_weight inflated the raw probabilities about 3x. The ablation showed
# reweighting bought no AUC, so this configuration drops it. Straight out of the model,
# the mean predicted probability is 7.95% against a base rate of 8.07%.
MODEL_NAME = os.environ.get("PREAPPROVAL_MODEL", "lightgbm_tuned_v2")

N_TOP_FACTORS = 8

app = FastAPI(title="Home Credit Preapproval API")

_model = None
_schema = None
_percentile_edges = None
_cohorts = None


def get_cohorts():
    """Group means/stds so a single applicant can be placed against their cohort.

    Exported by Part 3 of the notebook. Without them the 80 cohort features arrive
    missing and the served model drops from 0.760 to 0.744 AUC. A missing file is not
    fatal: the features just stay NaN.
    """
    global _cohorts
    if _cohorts is None:
        path = os.path.join(MODEL_DIR, f"{MODEL_NAME}_cohorts.json")
        if os.path.exists(path):
            with open(path) as f:
                _cohorts = json.load(f)
        else:
            _cohorts = {"numerics": [], "cohorts": {}}
    return _cohorts


def add_cohort_features(row: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Return `df` with COH_*_MEAN and COH_*_Z added, for cohorts the form can resolve.

    A cohort whose key the form does not collect (ORGANIZATION_TYPE, when the applicant
    leaves it blank) is skipped and its features stay missing, which the model handles.

    Columns are collected and joined in one concat rather than assigned one at a time:
    128 individual insertions fragment the frame and make pandas complain on every
    request.
    """
    tables = get_cohorts()
    new: dict[str, float] = {}
    for tag, spec in tables.get("cohorts", {}).items():
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


def get_schema():
    """Feature order and categorical levels the model was fit with.

    LightGBM matches categoricals by integer code, so serving a frame whose category
    levels are ordered differently would silently map e.g. "Married" onto whatever level
    happened to occupy that slot. The levels are pinned at export time for that reason.
    """
    global _schema
    if _schema is None:
        path = os.path.join(MODEL_DIR, f"{MODEL_NAME}_schema.json")
        if not os.path.exists(path):
            raise RuntimeError(
                f"Schema not found at {path}. Run Part 3 of the notebook to produce "
                f"the model, threshold, percentiles and schema together."
            )
        with open(path) as f:
            _schema = json.load(f)
    return _schema


def _load_default_threshold() -> float:
    path = os.path.join(MODEL_DIR, f"{MODEL_NAME}_threshold.json")
    if os.path.exists(path):
        with open(path) as f:
            return float(json.load(f)["threshold"])
    # The cutoff is a business decision: the cost of a missed default against the cost of
    # turning away a good applicant. Falls back to an env var if there is no threshold
    # file for this model.
    return float(os.environ.get("PREAPPROVAL_THRESHOLD", "0.158"))


DEFAULT_THRESHOLD = _load_default_threshold()


def get_percentile_edges():
    global _percentile_edges
    if _percentile_edges is None:
        path = os.path.join(MODEL_DIR, f"{MODEL_NAME}_percentiles.json")
        if os.path.exists(path):
            with open(path) as f:
                _percentile_edges = json.load(f)["percentile_edges"]
        else:
            _percentile_edges = []
    return _percentile_edges


def compute_risk_percentile(proba: float) -> int:
    edges = get_percentile_edges()
    if not edges:
        return 50  # no reference distribution available -- neutral fallback
    return int(np.searchsorted(edges, proba)) + 1


def get_model():
    global _model
    if _model is None:
        model_path = os.path.join(MODEL_DIR, f"{MODEL_NAME}.joblib")
        if not os.path.exists(model_path):
            raise RuntimeError(
                f"Model file not found at {model_path}. Run Part 3 of the notebook first."
            )
        _model = joblib.load(model_path)
    return _model


@app.on_event("startup")
def load_model_on_startup():
    get_model()
    get_schema()
    get_percentile_edges()
    get_cohorts()


@app.get("/health")
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
    """Turn the request into the 693-column frame the model expects.

    The model was trained on application data joined to aggregates of the client's
    bureau history, prior Home Credit applications, and installment repayment records.
    A preapproval request for a prospective applicant carries none of that, so those
    columns stay NaN -- which LightGBM routes natively, and which the model saw plenty of
    during training from clients who genuinely had no credit history. Predictions here
    are therefore "as if no prior credit record", and a client with real history would be
    scored more sharply by joining their aggregates in first.
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
        "CODE_GENDER": app_data.gender.value,
        "NAME_FAMILY_STATUS": app_data.family_status.value,
        "NAME_EDUCATION_TYPE": app_data.education.value,
        "NAME_INCOME_TYPE": app_data.income_type.value,
        "EXT_SOURCE_1": app_data.ext_score_1,
        "EXT_SOURCE_2": app_data.ext_score_2,
        "EXT_SOURCE_3": app_data.ext_score_3,
    }
    if app_data.occupation is not None:
        raw["OCCUPATION_TYPE"] = app_data.occupation.value
    if app_data.organization_type:
        raw["ORGANIZATION_TYPE"] = app_data.organization_type

    # Home Credit encodes "not currently employed" as 365243. The pipeline turns that
    # into NaN plus a flag, so do both here.
    if app_data.years_employed is not None:
        raw["DAYS_EMPLOYED"] = -app_data.years_employed * 365
        raw["DAYS_EMPLOYED_ANOM"] = 0
    else:
        raw["DAYS_EMPLOYED"] = np.nan
        raw["DAYS_EMPLOYED_ANOM"] = 1

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


def prettify(name: str) -> str:
    """Turn an internal feature name into something a loan officer can read."""
    labels = {
        "EXT_SOURCES_MEAN": "External credit scores (average)",
        "EXT_SOURCES_MIN": "External credit scores (lowest)",
        "EXT_SOURCES_MAX": "External credit scores (highest)",
        "EXT_SOURCES_WEIGHTED": "External credit scores (weighted)",
        "EXT_SOURCES_PROD": "External credit scores (combined)",
        "EXT_SOURCES_STD": "External credit scores (spread)",
        "EXT_SOURCES_NAN_COUNT": "Missing external credit scores",
        "EXT_SOURCE_1_X_AGE": "External score 1 relative to age",
        "EXT_SOURCE_2_X_AGE": "External score 2 relative to age",
        "EXT_SOURCE_3_X_AGE": "External score 3 relative to age",
        "EXT_SOURCE_1_X_EMPLOYED": "External score 1 relative to employment",
        "EXT_SOURCE_2_X_EMPLOYED": "External score 2 relative to employment",
        "EXT_SOURCE_3_X_EMPLOYED": "External score 3 relative to employment",
        "DAYS_EMPLOYED_ANOM": "No employment record",
        "EXT_SOURCE_1": "External credit score 1",
        "EXT_SOURCE_2": "External credit score 2",
        "EXT_SOURCE_3": "External credit score 3",
        "CREDIT_TERM": "Annuity as a share of loan amount",
        "CREDIT_INCOME_RATIO": "Loan amount vs. income",
        "ANNUITY_INCOME_RATIO": "Annual payment vs. income",
        "CREDIT_GOODS_RATIO": "Loan amount vs. goods price",
        "CREDIT_MINUS_GOODS": "Loan amount above goods price",
        "GOODS_INCOME_RATIO": "Goods price vs. income",
        "INCOME_PER_PERSON": "Income per household member",
        "DAYS_BIRTH": "Age",
        "DAYS_EMPLOYED": "Length of employment",
        "EMPLOYED_BIRTH_RATIO": "Share of life spent employed",
        "AMT_INCOME_TOTAL": "Income",
        "AMT_CREDIT": "Loan amount",
        "AMT_ANNUITY": "Annual payment",
        "AMT_GOODS_PRICE": "Goods price",
        "CODE_GENDER": "Gender",
        "NAME_EDUCATION_TYPE": "Education",
        "NAME_FAMILY_STATUS": "Family status",
        "NAME_INCOME_TYPE": "Income type",
        "OCCUPATION_TYPE": "Occupation",
        "ORGANIZATION_TYPE": "Employer type",
    }
    if name in labels:
        return labels[name]
    for prefix, source in (("BURO_", "Credit bureau"), ("PREV_", "Previous applications"),
                           ("INS_", "Installment history"), ("POS_", "POS/cash history"),
                           ("CC_", "Credit card history"), ("COH_", "Peer group"),
                           ("INSL_", "Prior loan history")):
        if name.startswith(prefix):
            return f"{source}: {name[len(prefix):].replace('_', ' ').lower()}"
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


@app.post("/predict", response_model=PreapprovalResponse)
def predict(app_data: LoanApplication):
    model = get_model()
    try:
        X = build_feature_row(app_data)
        proba = float(model.predict_proba(X)[0, 1])
        top_factors, base_rate, n_contributing = explain_row(model, X)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

    decision = "declined" if proba >= DEFAULT_THRESHOLD else "preapproved"
    return PreapprovalResponse(
        default_probability=proba,
        threshold=DEFAULT_THRESHOLD,
        decision=decision,
        model_used=MODEL_NAME,
        risk_percentile=compute_risk_percentile(proba),
        base_rate=base_rate,
        n_contributing=n_contributing,
        top_factors=top_factors,
    )
