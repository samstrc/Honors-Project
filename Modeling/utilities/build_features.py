"""
Feature engineering for Home Credit Default Risk.

Builds a wide feature matrix from application_train and all five auxiliary tables, then
caches it to `cache/features.parquet`. It runs in under 4 GB of RAM: each auxiliary table
is read with narrow dtypes, aggregated to one row per SK_ID_CURR, and freed before the
next one is touched.

Two feature sets, so the ablation study can measure what the extra engineering is worth:

  * `--level base`  -- the aggregations the original notebook used (~40 aux features)
  * `--level full`  -- deep aggregations + application-level ratios (~700 features)
"""

from __future__ import annotations

import argparse
import gc
import os
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "Data")
CACHE = os.path.join(HERE, "cache")

# Aggregations applied to every numeric column of an auxiliary table.
NUM_AGGS = ["min", "max", "mean", "sum", "var"]


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
def application(level: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, "application_train.csv"))
    df = _downcast(df)

    # Four rows carry CODE_GENDER='XNA'; treat as missing rather than a real level.
    df = df[df["CODE_GENDER"] != "XNA"].reset_index(drop=True)

    # 365243 is Home Credit's sentinel for "not currently employed" (pensioners and so
    # on). Null it out, but keep a flag: having no employment record is itself predictive.
    df["DAYS_EMPLOYED_ANOM"] = (df["DAYS_EMPLOYED"] == 365243).astype("int8")
    df["DAYS_EMPLOYED"] = df["DAYS_EMPLOYED"].replace(365243, np.nan)

    if level == "full":
        df = add_application_features(df)

    return _downcast(df)


def add_application_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive the application-level features from the raw columns.

    Split out from `application()` so the serving path (`api/main.py`) can build a
    feature row with this code rather than a reimplementation. A second copy of these
    formulas would be free to drift from the one the model was trained on, and the
    resulting skew is close to undetectable from the outside -- the API would just
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
    df["DOCUMENT_COUNT"] = (df[doc_cols].sum(axis=1).astype("int8")
                    if doc_cols else np.nan)
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
def bureau_and_balance(level: str) -> pd.DataFrame:
    bb = pd.read_csv(
        os.path.join(DATA, "bureau_balance.csv"),
        dtype={"SK_ID_BUREAU": "int32", "MONTHS_BALANCE": "int16", "STATUS": "category"},
    )

    if level == "base":
        bb["IS_DPD"] = bb["STATUS"].isin(["1", "2", "3", "4", "5"]).astype("int8")
        bb_agg = bb.groupby("SK_ID_BUREAU").agg(
            MONTHS_BALANCE_COUNT=("MONTHS_BALANCE", "size"),
            DPD_STATUS_RATE=("IS_DPD", "mean"),
        )
        del bb
        gc.collect()

        bureau = _downcast(pd.read_csv(os.path.join(DATA, "bureau.csv")))
        bureau = bureau.merge(bb_agg, on="SK_ID_BUREAU", how="left")
        del bb_agg
        gc.collect()
        bureau["IS_ACTIVE"] = (bureau["CREDIT_ACTIVE"] == "Active").astype("int8")
        bureau["DEBT_TO_CREDIT"] = bureau["AMT_CREDIT_SUM_DEBT"] / bureau["AMT_CREDIT_SUM"].replace(0, np.nan)
        out = bureau.groupby("SK_ID_CURR").agg(
            BUREAU_LOAN_COUNT=("SK_ID_BUREAU", "count"),
            BUREAU_ACTIVE_RATIO=("IS_ACTIVE", "mean"),
            BUREAU_DAYS_CREDIT_MEAN=("DAYS_CREDIT", "mean"),
            BUREAU_CREDIT_SUM_MEAN=("AMT_CREDIT_SUM", "mean"),
            BUREAU_CREDIT_SUM_DEBT_MEAN=("AMT_CREDIT_SUM_DEBT", "mean"),
            BUREAU_CREDIT_OVERDUE_MEAN=("AMT_CREDIT_SUM_OVERDUE", "mean"),
            BUREAU_DPD_STATUS_RATE_MEAN=("DPD_STATUS_RATE", "mean"),
            BUREAU_CREDIT_MAX_OVERDUE_MEAN=("AMT_CREDIT_MAX_OVERDUE", "mean"),
            BUREAU_CNT_PROLONGED_SUM=("CNT_CREDIT_PROLONG", "sum"),
            BUREAU_DAYS_CREDIT_ENDDATE_MEAN=("DAYS_CREDIT_ENDDATE", "mean"),
            BUREAU_CREDIT_SUM_LIMIT_MEAN=("AMT_CREDIT_SUM_LIMIT", "mean"),
            BUREAU_DEBT_TO_CREDIT_MEAN=("DEBT_TO_CREDIT", "mean"),
            BUREAU_CREDIT_TYPE_NUNIQUE=("CREDIT_TYPE", "nunique"),
        )
        del bureau
        gc.collect()
        return _downcast(out)

    # --- full ---
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
def previous_applications(level: str) -> pd.DataFrame:
    prev = _downcast(pd.read_csv(os.path.join(DATA, "previous_application.csv")))

    if level == "base":
        prev["IS_REFUSED"] = (prev["NAME_CONTRACT_STATUS"] == "Refused").astype("int8")
        prev["IS_APPROVED"] = (prev["NAME_CONTRACT_STATUS"] == "Approved").astype("int8")
        prev["CREDIT_TO_APPLICATION"] = prev["AMT_CREDIT"] / prev["AMT_APPLICATION"].replace(0, np.nan)
        out = prev.groupby("SK_ID_CURR").agg(
            PREV_APP_COUNT=("SK_ID_PREV", "count"),
            PREV_REFUSAL_RATE=("IS_REFUSED", "mean"),
            PREV_APPROVAL_RATE=("IS_APPROVED", "mean"),
            PREV_AMT_CREDIT_MEAN=("AMT_CREDIT", "mean"),
            PREV_AMT_ANNUITY_MEAN=("AMT_ANNUITY", "mean"),
            PREV_DAYS_DECISION_MEAN=("DAYS_DECISION", "mean"),
            PREV_CNT_PAYMENT_MEAN=("CNT_PAYMENT", "mean"),
            PREV_DOWN_PAYMENT_RATE_MEAN=("RATE_DOWN_PAYMENT", "mean"),
            PREV_APP_CREDIT_RATIO_MEAN=("CREDIT_TO_APPLICATION", "mean"),
            PREV_INSURED_RATE=("NFLAG_INSURED_ON_APPROVAL", "mean"),
        )
        del prev
        gc.collect()
        return _downcast(out)

    # --- full ---
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
def pos_cash(level: str) -> pd.DataFrame:
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

    if level == "base":
        pos["IS_COMPLETED"] = (pos["NAME_CONTRACT_STATUS"] == "Completed").astype("int8")
        out = pos.groupby("SK_ID_CURR").agg(
            POS_RECORD_COUNT=("SK_ID_PREV", "count"),
            POS_SK_DPD_MEAN=("SK_DPD", "mean"),
            POS_SK_DPD_DEF_MEAN=("SK_DPD_DEF", "mean"),
            POS_COMPLETED_RATIO=("IS_COMPLETED", "mean"),
            POS_CNT_INSTALMENT_MEAN=("CNT_INSTALMENT", "mean"),
            POS_MONTHS_BALANCE_MIN=("MONTHS_BALANCE", "min"),
        )
        del pos
        gc.collect()
        return _downcast(out)

    # --- full ---
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
def installments(level: str) -> pd.DataFrame:
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

    if level == "base":
        ins["LATE_DAYS"] = (ins["DAYS_ENTRY_PAYMENT"] - ins["DAYS_INSTALMENT"]).clip(lower=0)
        ins["PAYMENT_DIFF"] = ins["AMT_INSTALMENT"] - ins["AMT_PAYMENT"]
        ins["IS_LATE"] = (ins["LATE_DAYS"] > 0).astype("int8")
        ins["IS_UNDERPAID"] = (ins["PAYMENT_DIFF"] > 0).astype("int8")
        out = ins.groupby("SK_ID_CURR").agg(
            INSTALLMENT_COUNT=("SK_ID_PREV", "count"),
            INSTALLMENT_LATE_DAYS_MEAN=("LATE_DAYS", "mean"),
            INSTALLMENT_PAYMENT_DIFF_MEAN=("PAYMENT_DIFF", "mean"),
            INSTALLMENT_LATE_RATE=("IS_LATE", "mean"),
            INSTALLMENT_UNDERPAID_RATE=("IS_UNDERPAID", "mean"),
            INSTALLMENT_NUM_VERSION_NUNIQUE=("NUM_INSTALMENT_VERSION", "nunique"),
        )
        del ins
        gc.collect()
        return _downcast(out)

    # --- full ---
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
def credit_card(level: str) -> pd.DataFrame:
    cc = _downcast(pd.read_csv(os.path.join(DATA, "credit_card_balance.csv")))

    if level == "base":
        cc["UTILIZATION"] = cc["AMT_BALANCE"] / cc["AMT_CREDIT_LIMIT_ACTUAL"].replace(0, np.nan)
        cc["PAYMENT_TO_MIN"] = cc["AMT_PAYMENT_TOTAL_CURRENT"] / cc["AMT_INST_MIN_REGULARITY"].replace(0, np.nan)
        out = cc.groupby("SK_ID_CURR").agg(
            CC_RECORD_COUNT=("SK_ID_PREV", "count"),
            CC_UTILIZATION_MEAN=("UTILIZATION", "mean"),
            CC_SK_DPD_MEAN=("SK_DPD", "mean"),
            CC_DRAWINGS_ATM_MEAN=("AMT_DRAWINGS_ATM_CURRENT", "mean"),
            CC_CNT_DRAWINGS_MEAN=("CNT_DRAWINGS_CURRENT", "mean"),
            CC_PAYMENT_TO_MIN_MEAN=("PAYMENT_TO_MIN", "mean"),
        )
        del cc
        gc.collect()
        return _downcast(out)

    # --- full ---
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
def build(level: str) -> pd.DataFrame:
    print(f"[fe] building level={level}")
    df = application(level)
    print(f"  application            -> {df.shape}")

    for name, fn in [
        ("bureau", bureau_and_balance),
        ("previous_application", previous_applications),
        ("pos_cash", pos_cash),
        ("installments", installments),
        ("credit_card", credit_card),
    ]:
        agg = fn(level)
        print(f"  {name:22s} -> {agg.shape[1]} features")
        df = df.join(agg, how="left", on="SK_ID_CURR")
        del agg
        gc.collect()

    if level == "base":
        # The original notebook filled the *_COUNT columns with 0 (no rows in that
        # table unambiguously means zero records) and left the rate/mean columns NaN.
        count_cols = [
            "BUREAU_LOAN_COUNT", "BUREAU_CNT_PROLONGED_SUM", "BUREAU_CREDIT_TYPE_NUNIQUE",
            "PREV_APP_COUNT", "POS_RECORD_COUNT", "CC_RECORD_COUNT",
            "INSTALLMENT_COUNT", "INSTALLMENT_NUM_VERSION_NUNIQUE",
        ]
        df[count_cols] = df[count_cols].fillna(0)
    else:
        # Same idea, generalised: any *_COUNT column is a true zero when absent.
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
        print(f"  dropped {len(dead)} constant/all-missing columns")

    # LightGBM rejects these characters in feature names.
    df.columns = [
        c.replace(" ", "_").replace(":", "_").replace(",", "_").replace("[", "(").replace("]", ")")
        for c in df.columns
    ]
    print(f"[fe] final shape {df.shape}")
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", choices=["base", "full"], default="full")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    df = build(args.level)
    out = os.path.join(CACHE, f"features_{args.level}.parquet")
    df.to_parquet(out, compression="zstd", index=False)
    print(f"[fe] wrote {out} ({os.path.getsize(out)/1e6:.0f} MB)")


if __name__ == "__main__":
    main()
