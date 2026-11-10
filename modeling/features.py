"""
Feature engineering, shared by the notebooks and the site's backend.

The notebooks build the feature matrix with this module and decide everything about the
model; the backend only imports `add_application_features` from it to turn a form into a
model input. One definition for both means the site can't quietly compute a feature
differently from how the model learned it.

`FORM_INPUTS` and `form_feature_columns` say which of the model's features a preapproval
form can supply. 03_train.ipynb trains the served model on exactly those, minus the
`PROTECTED` attributes.

Built in two stages, each cached to `cache/` so later runs skip straight to training:

  1. `build_full`: application-level ratios plus deep aggregations of the five auxiliary
     tables (~1,480 columns). Each table is read with narrow dtypes, aggregated to one row
     per applicant and freed before the next, so this runs in under 4 GB of RAM.
  2. `build_extra`: features that need the full matrix first. Cohort statistics (an
     income of 150,000 means something different for a labourer than for a manager) and
     two-level installment aggregates ("the worst single prior loan").
"""

from __future__ import annotations

import gc
import json
import os
import re
import warnings

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CACHE = os.path.join(HERE, "cache")
FULL_PATH = os.path.join(CACHE, "features_full.parquet")
EXTRA_PATH = os.path.join(CACHE, "features_extra.parquet")
SEED = 42

# Aggregations applied to every numeric column of an auxiliary table.
NUM_AGGS = ["min", "max", "mean", "sum", "var"]

# The raw columns a preapproval applicant can answer about themselves: the application's
# amounts, age, household, education, employment, the three bureau scores (optional) and
# their credit card utilization (optional). Everything else in the data -- building and
# region statistics, document flags, the bureau and prior-loan history -- is something a
# lender looks up or never sees, so a form-only model cannot use it.
# backend/app/model/schema.py is the form itself and maps its fields onto these columns.
FORM_INPUTS = [
    "AMT_INCOME_TOTAL", "AMT_CREDIT", "AMT_ANNUITY", "AMT_GOODS_PRICE",
    "DAYS_BIRTH", "CNT_CHILDREN", "CNT_FAM_MEMBERS", "NAME_EDUCATION_TYPE",
    "NAME_INCOME_TYPE", "OCCUPATION_TYPE", "ORGANIZATION_TYPE",
    "DAYS_EMPLOYED", "DAYS_EMPLOYED_ANOM",
    "EXT_SOURCE_1", "EXT_SOURCE_2", "EXT_SOURCE_3",
    "CC_UTILIZATION_MEAN", "CC_COUNT",
]

# Sex and marital status. US fair-lending law (the Equal Credit Opportunity Act and its
# Regulation B) bars using either in a credit decision, so the served model is trained
# without them and without any feature built from them. 02_research.ipynb, section 3,
# measures what that costs.
PROTECTED = ["CODE_GENDER", "NAME_FAMILY_STATUS"]


def _downcast(df: pd.DataFrame) -> pd.DataFrame:
    """float64 -> float32, int64 -> int32. Halves memory with no meaningful precision loss."""
    for c in df.columns:
        if df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
        elif df[c].dtype == "int64":
            df[c] = df[c].astype("int32")
    return df


def _one_hot(df: pd.DataFrame, nan_as_category: bool = True):
    """One-hot every object column; return (frame, names of the new columns)."""
    original = list(df.columns)
    cats = [c for c in df.columns if df[c].dtype == "object"]
    df = pd.get_dummies(df, columns=cats, dummy_na=nan_as_category, dtype="uint8")
    return df, [c for c in df.columns if c not in original]


def _flatten(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """Collapse a MultiIndex column agg result into PREFIX_COL_AGG names."""
    df.columns = pd.Index([f"{prefix}_{a}_{b}".upper() for a, b in df.columns.tolist()])
    return df


# ----------------------------------------------------------------------------------
# application_train
# ----------------------------------------------------------------------------------
def application() -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, "application_train.csv"))
    df = _downcast(df)

    # Four rows carry CODE_GENDER='XNA'; treat as missing rather than a real level.
    df = df[df["CODE_GENDER"] != "XNA"].reset_index(drop=True)

    # 365243 is Home Credit's sentinel for "not currently employed" (pensioners and so
    # on). Null it out, but keep a flag: having no employment record is itself predictive.
    df["DAYS_EMPLOYED_ANOM"] = (df["DAYS_EMPLOYED"] == 365243).astype("int8")
    df["DAYS_EMPLOYED"] = df["DAYS_EMPLOYED"].replace(365243, np.nan)

    return _downcast(add_application_features(df))


def add_application_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive the application-level features from the raw columns.

    Split out from `application()` so the serving path (`backend/app/model/service.py`) can build a
    feature row with this code rather than a reimplementation. A second copy of these
    formulas would be free to drift from the one the model was trained on, and the
    resulting skew is close to undetectable from the outside -- the site would just
    quietly get worse.

    Operates on whatever columns are present; callers reindex to the model's schema
    afterwards, so a partially-populated row is fine.
    """
    def col(name):
        """Column if present, otherwise an all-NaN column. Lets a partially-populated
        serving row flow through the same formulas as a full training frame."""
        if name in df.columns:
            return df[name]
        return pd.Series(np.nan, index=df.index, dtype="float32")

    eps = 1e-6
    # --- affordability ratios: how big is this loan relative to what they earn ---
    df["CREDIT_INCOME_RATIO"] = col("AMT_CREDIT") / (col("AMT_INCOME_TOTAL") + eps)
    df["ANNUITY_INCOME_RATIO"] = col("AMT_ANNUITY") / (col("AMT_INCOME_TOTAL") + eps)
    df["CREDIT_TERM"] = col("AMT_ANNUITY") / (col("AMT_CREDIT") + eps)
    df["CREDIT_GOODS_RATIO"] = col("AMT_CREDIT") / (col("AMT_GOODS_PRICE") + eps)
    df["GOODS_INCOME_RATIO"] = col("AMT_GOODS_PRICE") / (col("AMT_INCOME_TOTAL") + eps)
    df["CREDIT_MINUS_GOODS"] = col("AMT_CREDIT") - col("AMT_GOODS_PRICE")
    df["INCOME_PER_PERSON"] = col("AMT_INCOME_TOTAL") / (col("CNT_FAM_MEMBERS") + eps)
    df["INCOME_PER_CHILD"] = col("AMT_INCOME_TOTAL") / (1 + col("CNT_CHILDREN"))
    df["CHILDREN_RATIO"] = col("CNT_CHILDREN") / (col("CNT_FAM_MEMBERS") + eps)

    # --- life-stage ratios ---
    df["EMPLOYED_BIRTH_RATIO"] = col("DAYS_EMPLOYED") / (col("DAYS_BIRTH") + eps)
    df["CAR_TO_BIRTH_RATIO"] = col("OWN_CAR_AGE") / (-col("DAYS_BIRTH") / 365.0 + eps)
    df["CAR_TO_EMPLOY_RATIO"] = col("OWN_CAR_AGE") / (-col("DAYS_EMPLOYED") / 365.0 + eps)
    df["PHONE_TO_BIRTH_RATIO"] = col("DAYS_LAST_PHONE_CHANGE") / (col("DAYS_BIRTH") + eps)
    df["PHONE_TO_EMPLOY_RATIO"] = col("DAYS_LAST_PHONE_CHANGE") / (col("DAYS_EMPLOYED") + eps)
    df["ID_TO_BIRTH_RATIO"] = col("DAYS_ID_PUBLISH") / (col("DAYS_BIRTH") + eps)
    df["REGISTRATION_TO_BIRTH_RATIO"] = col("DAYS_REGISTRATION") / (col("DAYS_BIRTH") + eps)

    # --- external bureau scores: the strongest signal in the dataset, so pass summary
    # statistics across the three as well as the raw values ---
    ext = pd.concat([col(f"EXT_SOURCE_{i}") for i in (1, 2, 3)], axis=1)
    df["EXT_SOURCES_MEAN"] = ext.mean(axis=1)
    df["EXT_SOURCES_MIN"] = ext.min(axis=1)
    df["EXT_SOURCES_MAX"] = ext.max(axis=1)
    df["EXT_SOURCES_STD"] = ext.std(axis=1)
    df["EXT_SOURCES_PROD"] = ext.iloc[:, 0] * ext.iloc[:, 1] * ext.iloc[:, 2]
    df["EXT_SOURCES_NAN_COUNT"] = ext.isna().sum(axis=1).astype("int8")
    # Weighted blend -- EXT_SOURCE_3 and _2 have the most coverage and signal.
    df["EXT_SOURCES_WEIGHTED"] = (
        ext.iloc[:, 0].fillna(0) * 2 + ext.iloc[:, 1].fillna(0) * 3 + ext.iloc[:, 2].fillna(0) * 4
    )
    # Interactions with age -- a low score at 25 means something different than at 60.
    for i in range(1, 4):
        df[f"EXT_SOURCE_{i}_X_AGE"] = ext.iloc[:, i - 1] * (-col("DAYS_BIRTH") / 365.0)
        df[f"EXT_SOURCE_{i}_X_EMPLOYED"] = ext.iloc[:, i - 1] * (-col("DAYS_EMPLOYED") / 365.0)

    # --- document flags: how many were supplied matters more than which ones ---
    doc_cols = [c for c in df.columns if c.startswith("FLAG_DOCUMENT_")]
    df["DOCUMENT_COUNT"] = df[doc_cols].sum(axis=1).astype("int8") if doc_cols else np.nan
    df["DOCUMENT_KURTOSIS"] = df[doc_cols].kurtosis(axis=1) if doc_cols else np.nan

    # --- credit bureau enquiry volume ---
    req_cols = [c for c in df.columns if c.startswith("AMT_REQ_CREDIT_BUREAU_")]
    df["BUREAU_REQ_TOTAL"] = df[req_cols].sum(axis=1) if req_cols else np.nan

    # --- social circle: fraction of the client's contacts who themselves defaulted ---
    df["DEF_30_RATIO"] = col("DEF_30_CNT_SOCIAL_CIRCLE") / (col("OBS_30_CNT_SOCIAL_CIRCLE") + eps)
    df["DEF_60_RATIO"] = col("DEF_60_CNT_SOCIAL_CIRCLE") / (col("OBS_60_CNT_SOCIAL_CIRCLE") + eps)

    return _downcast(df)


# ----------------------------------------------------------------------------------
# bureau + bureau_balance
# ----------------------------------------------------------------------------------
def bureau_and_balance() -> pd.DataFrame:
    bb = pd.read_csv(
        os.path.join(DATA, "bureau_balance.csv"),
        dtype={"SK_ID_BUREAU": "int32", "MONTHS_BALANCE": "int16", "STATUS": "category"},
    )

    # Monthly repayment status per bureau loan. STATUS: C=closed, X=unknown, 0=current,
    # 1-5 = increasingly severe days-past-due buckets.
    bb["STATUS"] = bb["STATUS"].astype("object")
    bb, bb_cat = _one_hot(bb, nan_as_category=False)
    aggs = {"MONTHS_BALANCE": ["min", "max", "size"]}
    aggs.update({c: ["mean", "sum"] for c in bb_cat})
    bb_agg = _flatten(bb.groupby("SK_ID_BUREAU").agg(aggs), "BB")
    del bb, bb_cat
    gc.collect()

    bureau = _downcast(pd.read_csv(os.path.join(DATA, "bureau.csv")))
    eps = 1e-6
    bureau["BUREAU_DEBT_CREDIT_RATIO"] = bureau["AMT_CREDIT_SUM_DEBT"] / (bureau["AMT_CREDIT_SUM"] + eps)
    bureau["BUREAU_OVERDUE_DEBT_RATIO"] = bureau["AMT_CREDIT_SUM_OVERDUE"] / (bureau["AMT_CREDIT_SUM_DEBT"] + eps)
    bureau["BUREAU_CREDIT_DURATION"] = bureau["DAYS_CREDIT_ENDDATE"] - bureau["DAYS_CREDIT"]
    # How long ago the loan actually closed vs when it was scheduled to -- early
    # payoff and overrun are different risk signals.
    bureau["BUREAU_ENDDATE_DIFF"] = bureau["DAYS_ENDDATE_FACT"] - bureau["DAYS_CREDIT_ENDDATE"]
    bureau["BUREAU_ANNUITY_CREDIT_RATIO"] = bureau["AMT_ANNUITY"] / (bureau["AMT_CREDIT_SUM"] + eps)

    bureau = bureau.merge(bb_agg, how="left", on="SK_ID_BUREAU")
    del bb_agg
    gc.collect()

    bureau, bureau_cat = _one_hot(bureau)
    num_cols = [
        c
        for c in bureau.select_dtypes(include=[np.number]).columns
        if c not in ("SK_ID_CURR", "SK_ID_BUREAU") and c not in bureau_cat
    ]
    num_aggs = {c: NUM_AGGS for c in num_cols}
    cat_aggs = {c: ["mean"] for c in bureau_cat}

    agg = _flatten(bureau.groupby("SK_ID_CURR").agg({**num_aggs, **cat_aggs}), "BURO")
    agg["BURO_COUNT"] = bureau.groupby("SK_ID_CURR").size()

    # Active and closed bureau loans carry very different information: outstanding
    # debt on live accounts vs. a track record of loans repaid. Aggregate separately.
    for label, mask in [
        ("ACTIVE", bureau["CREDIT_ACTIVE_Active"] == 1),
        ("CLOSED", bureau["CREDIT_ACTIVE_Closed"] == 1),
    ]:
        sub = bureau[mask]
        sub_agg = _flatten(sub.groupby("SK_ID_CURR").agg(num_aggs), f"BURO_{label}")
        sub_agg[f"BURO_{label}_COUNT"] = sub.groupby("SK_ID_CURR").size()
        agg = agg.join(sub_agg, how="left")
        del sub, sub_agg
        gc.collect()

    del bureau
    gc.collect()
    return _downcast(agg)


# ----------------------------------------------------------------------------------
# previous_application
# ----------------------------------------------------------------------------------
def previous_applications() -> pd.DataFrame:
    prev = _downcast(pd.read_csv(os.path.join(DATA, "previous_application.csv")))

    # Same 365243 sentinel as DAYS_EMPLOYED, here meaning "never happened".
    for c in ["DAYS_FIRST_DRAWING", "DAYS_FIRST_DUE", "DAYS_LAST_DUE_1ST_VERSION", "DAYS_LAST_DUE", "DAYS_TERMINATION"]:
        prev[c] = prev[c].replace(365243, np.nan)

    eps = 1e-6
    prev["APP_CREDIT_RATIO"] = prev["AMT_APPLICATION"] / (prev["AMT_CREDIT"] + eps)
    prev["CREDIT_GOODS_RATIO"] = prev["AMT_CREDIT"] / (prev["AMT_GOODS_PRICE"] + eps)
    prev["DOWN_PAYMENT_RATIO"] = prev["AMT_DOWN_PAYMENT"] / (prev["AMT_CREDIT"] + eps)
    prev["PREV_CREDIT_TERM"] = prev["AMT_ANNUITY"] / (prev["AMT_CREDIT"] + eps)
    # Did the loan run past its originally scheduled end date?
    prev["DUE_DIFF"] = prev["DAYS_LAST_DUE"] - prev["DAYS_LAST_DUE_1ST_VERSION"]

    prev, prev_cat = _one_hot(prev)
    num_cols = [
        c
        for c in prev.select_dtypes(include=[np.number]).columns
        if c not in ("SK_ID_CURR", "SK_ID_PREV") and c not in prev_cat
    ]
    num_aggs = {c: NUM_AGGS for c in num_cols}
    cat_aggs = {c: ["mean"] for c in prev_cat}

    agg = _flatten(prev.groupby("SK_ID_CURR").agg({**num_aggs, **cat_aggs}), "PREV")
    agg["PREV_COUNT"] = prev.groupby("SK_ID_CURR").size()

    # A history of refusals is a much stronger signal than the overall average, so
    # split it out instead of letting approved applications dilute it.
    for label, mask in [
        ("APPROVED", prev["NAME_CONTRACT_STATUS_Approved"] == 1),
        ("REFUSED", prev["NAME_CONTRACT_STATUS_Refused"] == 1),
    ]:
        sub = prev[mask]
        sub_agg = _flatten(sub.groupby("SK_ID_CURR").agg(num_aggs), f"PREV_{label}")
        sub_agg[f"PREV_{label}_COUNT"] = sub.groupby("SK_ID_CURR").size()
        agg = agg.join(sub_agg, how="left")
        del sub, sub_agg
        gc.collect()

    del prev
    gc.collect()
    return _downcast(agg)


# ----------------------------------------------------------------------------------
# POS_CASH_balance
# ----------------------------------------------------------------------------------
def pos_cash() -> pd.DataFrame:
    pos = pd.read_csv(
        os.path.join(DATA, "POS_CASH_balance.csv"),
        dtype={
            "SK_ID_PREV": "int32",
            "SK_ID_CURR": "int32",
            "MONTHS_BALANCE": "int16",
            "CNT_INSTALMENT": "float32",
            "CNT_INSTALMENT_FUTURE": "float32",
            "NAME_CONTRACT_STATUS": "object",
            "SK_DPD": "int32",
            "SK_DPD_DEF": "int32",
        },
    )

    pos["IS_DPD"] = (pos["SK_DPD"] > 0).astype("int8")
    pos["IS_DPD_DEF"] = (pos["SK_DPD_DEF"] > 0).astype("int8")
    pos["INSTALMENT_PAID_RATIO"] = 1 - pos["CNT_INSTALMENT_FUTURE"] / (pos["CNT_INSTALMENT"] + 1e-6)

    pos, pos_cat = _one_hot(pos)
    aggs = {
        "MONTHS_BALANCE": ["min", "max", "mean", "size"],
        "SK_DPD": ["max", "mean", "sum", "var"],
        "SK_DPD_DEF": ["max", "mean", "sum", "var"],
        "CNT_INSTALMENT": ["min", "max", "mean"],
        "CNT_INSTALMENT_FUTURE": ["min", "max", "mean"],
        "IS_DPD": ["mean", "sum"],
        "IS_DPD_DEF": ["mean", "sum"],
        "INSTALMENT_PAID_RATIO": ["min", "max", "mean"],
    }
    aggs.update({c: ["mean"] for c in pos_cat})
    agg = _flatten(pos.groupby("SK_ID_CURR").agg(aggs), "POS")
    agg["POS_COUNT"] = pos.groupby("SK_ID_CURR").size()
    agg["POS_LOAN_COUNT"] = pos.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    # The last 12 months predict better than the lifetime average.
    recent = pos[pos["MONTHS_BALANCE"] >= -12]
    rec_agg = _flatten(
        recent.groupby("SK_ID_CURR").agg(
            {"SK_DPD": ["max", "mean"], "SK_DPD_DEF": ["max", "mean"], "IS_DPD": ["mean", "sum"]}
        ),
        "POS_RECENT",
    )
    agg = agg.join(rec_agg, how="left")

    del pos, recent, rec_agg
    gc.collect()
    return _downcast(agg)


# ----------------------------------------------------------------------------------
# installments_payments
# ----------------------------------------------------------------------------------
def installments() -> pd.DataFrame:
    ins = pd.read_csv(
        os.path.join(DATA, "installments_payments.csv"),
        dtype={
            "SK_ID_PREV": "int32",
            "SK_ID_CURR": "int32",
            "NUM_INSTALMENT_VERSION": "float32",
            "NUM_INSTALMENT_NUMBER": "int16",
            "DAYS_INSTALMENT": "float32",
            "DAYS_ENTRY_PAYMENT": "float32",
            "AMT_INSTALMENT": "float32",
            "AMT_PAYMENT": "float32",
        },
    )

    eps = 1e-6
    ins["PAYMENT_PERC"] = ins["AMT_PAYMENT"] / (ins["AMT_INSTALMENT"] + eps)
    ins["PAYMENT_DIFF"] = ins["AMT_INSTALMENT"] - ins["AMT_PAYMENT"]
    # DPD = days paid late, DBD = days paid early. Both clipped at 0 so they stay
    # separable rather than cancelling out in a single signed column.
    ins["DPD"] = (ins["DAYS_ENTRY_PAYMENT"] - ins["DAYS_INSTALMENT"]).clip(lower=0)
    ins["DBD"] = (ins["DAYS_INSTALMENT"] - ins["DAYS_ENTRY_PAYMENT"]).clip(lower=0)
    ins["IS_LATE"] = (ins["DPD"] > 0).astype("int8")
    ins["IS_UNDERPAID"] = (ins["PAYMENT_DIFF"] > 0.01).astype("int8")

    aggs = {
        "NUM_INSTALMENT_VERSION": ["nunique", "max"],
        "NUM_INSTALMENT_NUMBER": ["max", "mean"],
        "DPD": ["max", "mean", "sum", "var"],
        "DBD": ["max", "mean", "sum", "var"],
        "PAYMENT_PERC": ["min", "max", "mean", "sum", "var"],
        "PAYMENT_DIFF": ["min", "max", "mean", "sum", "var"],
        "AMT_INSTALMENT": ["min", "max", "mean", "sum"],
        "AMT_PAYMENT": ["min", "max", "mean", "sum"],
        "DAYS_ENTRY_PAYMENT": ["min", "max", "mean", "sum"],
        "DAYS_INSTALMENT": ["min", "max", "mean"],
        "IS_LATE": ["mean", "sum"],
        "IS_UNDERPAID": ["mean", "sum"],
    }
    agg = _flatten(ins.groupby("SK_ID_CURR").agg(aggs), "INS")
    agg["INS_COUNT"] = ins.groupby("SK_ID_CURR").size()
    agg["INS_LOAN_COUNT"] = ins.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    # Recency windows. Someone late two years ago but clean since is a different risk
    # from someone who started missing payments last quarter.
    for label, days in [("1Y", 365), ("2Y", 730)]:
        recent = ins[ins["DAYS_INSTALMENT"] >= -days]
        rec_agg = _flatten(
            recent.groupby("SK_ID_CURR").agg(
                {
                    "DPD": ["max", "mean", "sum"],
                    "PAYMENT_PERC": ["min", "mean"],
                    "PAYMENT_DIFF": ["max", "mean", "sum"],
                    "IS_LATE": ["mean", "sum"],
                    "IS_UNDERPAID": ["mean", "sum"],
                }
            ),
            f"INS_{label}",
        )
        rec_agg[f"INS_{label}_COUNT"] = recent.groupby("SK_ID_CURR").size()
        agg = agg.join(rec_agg, how="left")
        del recent, rec_agg
        gc.collect()

    # Trend: is the client's lateness getting worse over time? Ratio of recent mean
    # DPD to lifetime mean DPD.
    agg["INS_DPD_TREND"] = agg["INS_1Y_DPD_MEAN"] / (agg["INS_DPD_MEAN"] + eps)
    agg["INS_LATE_TREND"] = agg["INS_1Y_IS_LATE_MEAN"] / (agg["INS_IS_LATE_MEAN"] + eps)

    del ins
    gc.collect()
    return _downcast(agg)


# ----------------------------------------------------------------------------------
# credit_card_balance
# ----------------------------------------------------------------------------------
def credit_card() -> pd.DataFrame:
    cc = _downcast(pd.read_csv(os.path.join(DATA, "credit_card_balance.csv")))

    eps = 1e-6
    cc["UTILIZATION"] = cc["AMT_BALANCE"] / (cc["AMT_CREDIT_LIMIT_ACTUAL"] + eps)
    cc["PAYMENT_TO_MIN"] = cc["AMT_PAYMENT_TOTAL_CURRENT"] / (cc["AMT_INST_MIN_REGULARITY"] + eps)
    cc["PAYMENT_TO_BALANCE"] = cc["AMT_PAYMENT_TOTAL_CURRENT"] / (cc["AMT_BALANCE"] + eps)
    cc["DRAWINGS_TO_LIMIT"] = cc["AMT_DRAWINGS_CURRENT"] / (cc["AMT_CREDIT_LIMIT_ACTUAL"] + eps)
    # Paying only the minimum every month is a classic distress signal.
    cc["PAYS_MINIMUM_ONLY"] = (
        (cc["AMT_PAYMENT_TOTAL_CURRENT"] <= cc["AMT_INST_MIN_REGULARITY"] * 1.05)
        & (cc["AMT_INST_MIN_REGULARITY"] > 0)
    ).astype("int8")
    cc["IS_DPD"] = (cc["SK_DPD"] > 0).astype("int8")

    cc, cc_cat = _one_hot(cc)
    num_cols = [
        c
        for c in cc.select_dtypes(include=[np.number]).columns
        if c not in ("SK_ID_CURR", "SK_ID_PREV") and c not in cc_cat
    ]
    aggs = {c: NUM_AGGS for c in num_cols}
    aggs.update({c: ["mean"] for c in cc_cat})
    agg = _flatten(cc.groupby("SK_ID_CURR").agg(aggs), "CC")
    agg["CC_COUNT"] = cc.groupby("SK_ID_CURR").size()
    agg["CC_CARD_COUNT"] = cc.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    recent = cc[cc["MONTHS_BALANCE"] >= -12]
    rec_agg = _flatten(
        recent.groupby("SK_ID_CURR").agg(
            {
                "UTILIZATION": ["max", "mean"],
                "AMT_BALANCE": ["max", "mean"],
                "SK_DPD": ["max", "mean"],
                "IS_DPD": ["mean", "sum"],
                "PAYS_MINIMUM_ONLY": ["mean"],
                "AMT_DRAWINGS_ATM_CURRENT": ["max", "mean"],
            }
        ),
        "CC_RECENT",
    )
    agg = agg.join(rec_agg, how="left")

    del cc, recent, rec_agg
    gc.collect()
    return _downcast(agg)


# ----------------------------------------------------------------------------------
def build_full() -> pd.DataFrame:
    """Every engineered feature, one row per application (~1,480 columns, ~15 minutes)."""
    print("[features] application")
    df = application()

    for name, fn in [
        ("bureau", bureau_and_balance),
        ("previous_application", previous_applications),
        ("pos_cash", pos_cash),
        ("installments", installments),
        ("credit_card", credit_card),
    ]:
        agg = fn()
        print(f"[features] {name:22s} -> {agg.shape[1]} features")
        df = df.join(agg, how="left", on="SK_ID_CURR")
        del agg
        gc.collect()

    # No rows in a table means zero records, so every count is a true zero when absent.
    count_cols = [c for c in df.columns if c.endswith("_COUNT") and c != "EXT_SOURCES_NAN_COUNT"]
    df[count_cols] = df[count_cols].fillna(0)

    # Cross-table ratios -- these only exist once everything is joined.
    eps = 1e-6
    df["ANNUITY_TO_PREV_ANNUITY"] = df["AMT_ANNUITY"] / (df["PREV_AMT_ANNUITY_MEAN"] + eps)
    df["CREDIT_TO_PREV_CREDIT"] = df["AMT_CREDIT"] / (df["PREV_AMT_CREDIT_MEAN"] + eps)
    df["BUREAU_DEBT_TO_INCOME"] = df["BURO_AMT_CREDIT_SUM_DEBT_SUM"] / (df["AMT_INCOME_TOTAL"] + eps)
    df["BUREAU_CREDIT_TO_INCOME"] = df["BURO_AMT_CREDIT_SUM_SUM"] / (df["AMT_INCOME_TOTAL"] + eps)
    # Total annuity burden = this loan + everything still open at the bureau.
    df["TOTAL_ANNUITY_TO_INCOME"] = (
        df["AMT_ANNUITY"].fillna(0) + df["BURO_ACTIVE_AMT_ANNUITY_SUM"].fillna(0)
    ) / (df["AMT_INCOME_TOTAL"] + eps)

    # Drop columns that are entirely constant or entirely missing. They cost memory and
    # only add noise to the feature-importance readings.
    nunique = df.nunique(dropna=False)
    dead = [c for c in nunique[nunique <= 1].index if c != "TARGET"]
    if dead:
        df = df.drop(columns=dead)
        print(f"[features] dropped {len(dead)} constant/all-missing columns")

    # LightGBM rejects these characters in feature names.
    df.columns = [
        c.replace(" ", "_").replace(":", "_").replace(",", "_").replace("[", "(").replace("]", ")")
        for c in df.columns
    ]
    print(f"[features] full matrix {df.shape}")
    return df


# ----------------------------------------------------------------------------------
# cohort and per-prior-loan features
# ----------------------------------------------------------------------------------
# Hand-written tags so two cohorts can never share a name. Truncating the key names did
# collide (NAME_EDUCATION_TYPE and NAME_INCOME_TYPE both became "NAME") and silently
# dropped 16 features (02_research §2.9). A cohort without a tag fails loudly here.
COHORT_TAG = {
    ("ORGANIZATION_TYPE",): "ORG",
    ("OCCUPATION_TYPE",): "OCC",
    ("NAME_EDUCATION_TYPE",): "EDU",
    ("NAME_INCOME_TYPE",): "INC",
    ("CODE_GENDER", "NAME_EDUCATION_TYPE"): "GENDER_EDU",
}
COHORTS = list(COHORT_TAG)
assert len(set(COHORT_TAG.values())) == len(COHORT_TAG), "cohort tags must be unique"

COHORT_NUMERICS = [
    "EXT_SOURCES_MEAN",
    "AMT_INCOME_TOTAL",
    "AMT_CREDIT",
    "AMT_ANNUITY",
    "CREDIT_INCOME_RATIO",
    "ANNUITY_INCOME_RATIO",
    "DAYS_EMPLOYED",
    "DAYS_BIRTH",
]


def cohort_features(df: pd.DataFrame, fit_mask: np.ndarray) -> pd.DataFrame:
    """
    Cohort statistics are estimated on training rows only (`fit_mask`) and then mapped
    onto every row. They use no target information, so pooling would not leak the label
    -- but estimating them over train+test would still be transductive, and a held-out
    test set is supposed to stand in for applicants the model has never seen.
    """
    out = pd.DataFrame(index=df.index)
    fit = df.loc[fit_mask]
    for keys in COHORTS:
        keys = [k for k in keys if k in df.columns]
        if not keys:
            continue
        tag = COHORT_TAG[tuple(keys)]
        g = fit.groupby(keys, observed=True, dropna=False)
        key_idx = pd.MultiIndex.from_frame(df[keys]) if len(keys) > 1 else pd.Index(df[keys[0]])
        for col in COHORT_NUMERICS:
            if col not in df.columns:
                continue
            stats = g[col].agg(["mean", "std"])
            mean = pd.Series(stats["mean"].reindex(key_idx).values, index=df.index)
            std = pd.Series(stats["std"].reindex(key_idx).values, index=df.index)
            out[f"COH_{tag}_{col}_MEAN"] = mean.astype("float32")
            # Deviation from cohort, in cohort standard deviations.
            out[f"COH_{tag}_{col}_Z"] = ((df[col] - mean) / (std + 1e-6)).astype("float32")
    return out


def form_feature_columns(columns, include_protected: bool = False) -> list[str]:
    """The columns in `columns` that a preapproval form can populate, in their given order.

    Worked out from the formulas rather than listed by hand: every form input is set on a
    one-row frame, the application features are derived from it with the same code the
    backend runs, and whatever comes out populated counts. Cohort features count when every
    key of their cohort is a form input. So a new formula in `add_application_features`
    joins the form model automatically if, and only if, a form can feed it.
    """
    inputs = FORM_INPUTS + (PROTECTED if include_protected else [])
    probe = pd.DataFrame([{c: 1.0 for c in inputs}])
    derived = add_application_features(probe)
    available = set(derived.columns[derived.notna().iloc[0].to_numpy()])
    for keys, tag in COHORT_TAG.items():
        if set(keys) <= set(inputs):
            for col in COHORT_NUMERICS:
                if col in available:
                    available |= {f"COH_{tag}_{col}_MEAN", f"COH_{tag}_{col}_Z"}
    return [c for c in columns if c in available]


def export_cohort_tables(df: pd.DataFrame, fit_mask, path: str, cohorts=None) -> dict:
    """Save the cohort means and standard deviations so the backend can rebuild these features.

    The serving path has one applicant, not a population, so it cannot compute a group mean
    on the fly; without these tables every cohort feature would arrive missing. `cohorts`
    limits the export to the cohorts the served model uses (default: all of them).

    Statistics come from the same training rows `cohort_features` uses, so a served value is
    identical to the one the model was trained on. Kept here rather than in the backend for the
    same reason `add_application_features` is shared: one definition, no drift.
    """
    fit = df.loc[fit_mask]
    out = {"numerics": list(COHORT_NUMERICS), "cohorts": {}}
    for keys in (COHORTS if cohorts is None else cohorts):
        keys = [k for k in keys if k in df.columns]
        if not keys:
            continue
        tag = COHORT_TAG[tuple(keys)]
        g = fit.groupby(keys, observed=True, dropna=False)
        stats = {}
        for col in COHORT_NUMERICS:
            if col not in df.columns:
                continue
            agg = g[col].agg(["mean", "std"])
            for idx, row in agg.iterrows():
                # Multi-key cohorts are keyed on the joined values, matching the backend.
                k = "||".join(str(v) for v in (idx if isinstance(idx, tuple) else (idx,)))
                if pd.isna(row["mean"]):
                    continue
                stats.setdefault(k, {})[col] = [float(row["mean"]),
                                                float(row["std"]) if pd.notna(row["std"]) else 0.0]
        out["cohorts"][tag] = {"keys": keys, "stats": stats}

    with open(path, "w") as f:
        json.dump(out, f)
    n = sum(len(c["stats"]) for c in out["cohorts"].values())
    print(f"  wrote {path}: {len(out['cohorts'])} cohorts, {n} groups, "
          f"{os.path.getsize(path)/1e3:.0f} KB")
    return out


def installments_per_loan() -> pd.DataFrame:
    """Aggregate per prior loan first, then summarise the distribution across loans."""
    ins = pd.read_csv(
        os.path.join(DATA, "installments_payments.csv"),
        usecols=["SK_ID_PREV", "SK_ID_CURR", "DAYS_INSTALMENT", "DAYS_ENTRY_PAYMENT",
                 "AMT_INSTALMENT", "AMT_PAYMENT"],
        dtype={"SK_ID_PREV": "int32", "SK_ID_CURR": "int32", "DAYS_INSTALMENT": "float32",
               "DAYS_ENTRY_PAYMENT": "float32", "AMT_INSTALMENT": "float32", "AMT_PAYMENT": "float32"},
    )
    ins["DPD"] = (ins["DAYS_ENTRY_PAYMENT"] - ins["DAYS_INSTALMENT"]).clip(lower=0)
    ins["SHORTFALL"] = (ins["AMT_INSTALMENT"] - ins["AMT_PAYMENT"]).clip(lower=0)
    ins["IS_LATE"] = (ins["DPD"] > 0).astype("int8")

    per_loan = ins.groupby(["SK_ID_CURR", "SK_ID_PREV"]).agg(
        LOAN_DPD_MAX=("DPD", "max"),
        LOAN_DPD_MEAN=("DPD", "mean"),
        LOAN_LATE_RATE=("IS_LATE", "mean"),
        LOAN_SHORTFALL_SUM=("SHORTFALL", "sum"),
        LOAN_N=("DPD", "size"),
    ).reset_index()
    del ins
    gc.collect()

    agg = per_loan.groupby("SK_ID_CURR").agg(
        INSL_DPD_MAX_MAX=("LOAN_DPD_MAX", "max"),
        INSL_DPD_MAX_MEAN=("LOAN_DPD_MAX", "mean"),
        INSL_DPD_MAX_STD=("LOAN_DPD_MAX", "std"),
        INSL_DPD_MEAN_MAX=("LOAN_DPD_MEAN", "max"),
        INSL_LATE_RATE_MAX=("LOAN_LATE_RATE", "max"),
        INSL_LATE_RATE_MEAN=("LOAN_LATE_RATE", "mean"),
        INSL_LATE_RATE_STD=("LOAN_LATE_RATE", "std"),
        INSL_SHORTFALL_MAX=("LOAN_SHORTFALL_SUM", "max"),
        INSL_SHORTFALL_SUM=("LOAN_SHORTFALL_SUM", "sum"),
        INSL_N_LOANS=("LOAN_N", "size"),
        INSL_N_PER_LOAN_MEAN=("LOAN_N", "mean"),
    )
    # Fraction of prior loans that were ever late -- concentration matters, not just volume.
    bad = per_loan[per_loan["LOAN_LATE_RATE"] > 0].groupby("SK_ID_CURR").size()
    agg["INSL_LOANS_EVER_LATE"] = bad.reindex(agg.index).fillna(0)
    agg["INSL_FRAC_LOANS_LATE"] = agg["INSL_LOANS_EVER_LATE"] / agg["INSL_N_LOANS"]

    del per_loan
    gc.collect()
    return agg.astype("float32")


# ----------------------------------------------------------------------------------
# cache and loading
# ----------------------------------------------------------------------------------
def train_mask(target: pd.Series) -> np.ndarray:
    """Which rows are in the training split. `train_test_split` stratified on y alone gives
    the same partition whatever columns are loaded, so this matches the notebook's split."""
    train_idx, _ = train_test_split(target.index, test_size=0.2, random_state=SEED, stratify=target)
    return target.index.isin(train_idx)


def build_extra() -> pd.DataFrame:
    """Cohort and per-prior-loan features, in the full matrix's row order.

    Reads the cohort columns back from the saved full matrix rather than taking the frame
    in memory: a missing occupation is stored as None in parquet, which groups into its own
    cohort, and the served model was trained on features built exactly this way.
    """
    cols = ["SK_ID_CURR", "TARGET"] + sorted({c for keys in COHORTS for c in keys} | set(COHORT_NUMERICS))
    df = pd.read_parquet(FULL_PATH, columns=cols)
    extra = cohort_features(df, train_mask(df["TARGET"]))
    loans = installments_per_loan().reindex(df["SK_ID_CURR"].values)
    loans.index = extra.index
    extra = pd.concat([extra, loans], axis=1)
    extra.insert(0, "SK_ID_CURR", df["SK_ID_CURR"].to_numpy())
    print(f"[features] extra features {extra.shape[1] - 1}")
    return extra


def build_cache():
    """Build both feature matrices from the raw CSVs and save them to cache/."""
    os.makedirs(CACHE, exist_ok=True)
    build_full().to_parquet(FULL_PATH, compression="zstd", index=False)
    build_extra().to_parquet(EXTRA_PATH, compression="zstd", index=False)
    print(f"[features] wrote {FULL_PATH} and {EXTRA_PATH}")


def sanitize(names) -> list[str]:
    """LightGBM rejects non-alphanumeric characters in feature names; make them safe and unique."""
    out, seen = [], {}
    for n in names:
        s = re.sub(r"[^0-9a-zA-Z_]+", "_", str(n)).strip("_") or "f"
        if s in seen:
            seen[s] += 1
            s = f"{s}_{seen[s]}"
        else:
            seen[s] = 0
        out.append(s)
    return out


def load_matrix() -> tuple[pd.DataFrame, pd.Series]:
    """The cached features joined into one frame, as (X, y).

    Text columns become pandas categories so LightGBM can split on them natively. The
    categories are assigned before any split, so train and test share one encoding.
    """
    df = pd.read_parquet(FULL_PATH)
    extra = pd.read_parquet(EXTRA_PATH)
    assert np.array_equal(df["SK_ID_CURR"].to_numpy(), extra["SK_ID_CURR"].to_numpy()), "row order mismatch"
    extra = extra.drop(columns=["SK_ID_CURR"])
    extra.index = df.index
    df = pd.concat([df, extra], axis=1)
    del extra
    gc.collect()

    df.columns = sanitize(df.columns)
    y = df["TARGET"].astype("int8")
    X = df.drop(columns=["SK_ID_CURR", "TARGET"])
    for c in X.select_dtypes(include=["object"]).columns:
        X[c] = X[c].astype("category")
    return X, y


def extra_columns() -> list[str]:
    """Names of the cohort and per-loan features, read from the parquet schema (no data load)."""
    import pyarrow.parquet as pq

    names = pq.ParquetFile(EXTRA_PATH).schema_arrow.names
    return [c for c in sanitize(names) if c != "SK_ID_CURR"]
