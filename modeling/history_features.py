"""
Builds the research table: every application joined to a summary of its credit history.

Home Credit's history tables hold many rows per applicant (one per past loan, monthly
balance or payment), so they can't be joined to the applications as they are. Each table
function below reads one table, adds a few columns of its own, and summarises it to one row
per applicant. `build_full` then joins those summaries onto the application table.

The file reads top to bottom:

  1. Shared helpers              summarise, numeric_aggs, one_hot
  2. The application table       application
  3. The credit-history tables   one function per table
  4. Building the cache          build_full, build_extra, build_cache

`build_cache` runs once (about 15 minutes) and saves two files in `cache/`, which
`features.load_matrix` reads from then on. `build_full` handles one table at a time and
drops it before reading the next, so it runs in under 4 GB of RAM. `build_extra` adds what
needs the full table first: the cohort features, and payment summaries per earlier loan.
"""

from __future__ import annotations

import gc
import os

import numpy as np
import pandas as pd

import features
from features import DATA, EPS, add_application_features, downcast

# Summary statistics taken of every numeric column of a credit-history table.
NUM_AGGS = ["min", "max", "mean", "sum", "var"]
ID_COLS = ("SK_ID_CURR", "SK_ID_BUREAU", "SK_ID_PREV")


# ==================================================================================
# 1. Shared helpers
# ==================================================================================
def read(name: str, **kwargs) -> pd.DataFrame:
    return pd.read_csv(os.path.join(DATA, name), **kwargs)


def one_hot(df: pd.DataFrame, nan_as_category: bool = True):
    """One-hot every text column; return (frame, names of the new columns)."""
    original = list(df.columns)
    cats = [c for c in df.columns if df[c].dtype == "object"]
    df = pd.get_dummies(df, columns=cats, dummy_na=nan_as_category, dtype="uint8")
    return df, [c for c in df.columns if c not in original]


def numeric_aggs(df: pd.DataFrame, one_hot_cols) -> dict:
    """NUM_AGGS for every numeric column that isn't an ID or a one-hot column."""
    numeric = df.select_dtypes(include=[np.number]).columns
    return {c: NUM_AGGS for c in numeric if c not in ID_COLS and c not in one_hot_cols}


def summarise(df: pd.DataFrame, prefix: str, aggs: dict, by: str = "SK_ID_CURR",
              count: bool = True) -> pd.DataFrame:
    """One row per `by`, with a column PREFIX_COLUMN_STAT for each statistic in `aggs`.

    This is the step every table goes through. `count` adds PREFIX_COUNT, the number of
    rows that went into the summary.
    """
    groups = df.groupby(by)
    out = groups.agg(aggs)
    out.columns = pd.Index([f"{prefix}_{col}_{stat}".upper() for col, stat in out.columns.tolist()])
    if count:
        out[f"{prefix}_COUNT"] = groups.size()
    return out


# ==================================================================================
# 2. The application table
# ==================================================================================
def application() -> pd.DataFrame:
    df = downcast(read("application_train.csv"))

    # Four rows carry CODE_GENDER='XNA'; treat as missing rather than a real level.
    df = df[df["CODE_GENDER"] != "XNA"].reset_index(drop=True)

    # 365243 is Home Credit's sentinel for "not currently employed" (pensioners and so
    # on). Null it out, but keep a flag: having no employment record is itself predictive.
    df["DAYS_EMPLOYED_ANOM"] = (df["DAYS_EMPLOYED"] == 365243).astype("int8")
    df["DAYS_EMPLOYED"] = df["DAYS_EMPLOYED"].replace(365243, np.nan)

    return downcast(add_application_features(df))


# ==================================================================================
# 3. The credit-history tables
# ==================================================================================
# Each function returns one row per applicant (indexed by SK_ID_CURR), with its columns
# prefixed by the table (BURO_, PREV_, POS_, INS_, INSL_, CC_).

def bureau_and_balance() -> pd.DataFrame:
    """Loans held at other lenders (bureau.csv), with their monthly status history."""
    # The monthly statuses are one level down, many rows per bureau loan, so they are
    # summarised per loan first. STATUS: C=closed, X=unknown, 0=current, 1-5 = increasingly
    # severe days-past-due buckets.
    bb = read("bureau_balance.csv",
              dtype={"SK_ID_BUREAU": "int32", "MONTHS_BALANCE": "int16", "STATUS": "object"})
    bb, statuses = one_hot(bb, nan_as_category=False)
    aggs = {"MONTHS_BALANCE": ["min", "max", "size"], **{c: ["mean", "sum"] for c in statuses}}
    per_loan = summarise(bb, "BB", aggs, by="SK_ID_BUREAU", count=False)
    del bb
    gc.collect()

    bureau = downcast(read("bureau.csv"))
    bureau["BUREAU_DEBT_CREDIT_RATIO"] = bureau["AMT_CREDIT_SUM_DEBT"] / (bureau["AMT_CREDIT_SUM"] + EPS)
    bureau["BUREAU_OVERDUE_DEBT_RATIO"] = bureau["AMT_CREDIT_SUM_OVERDUE"] / (bureau["AMT_CREDIT_SUM_DEBT"] + EPS)
    bureau["BUREAU_CREDIT_DURATION"] = bureau["DAYS_CREDIT_ENDDATE"] - bureau["DAYS_CREDIT"]
    # How long ago the loan actually closed vs when it was scheduled to -- early
    # payoff and overrun are different risk signals.
    bureau["BUREAU_ENDDATE_DIFF"] = bureau["DAYS_ENDDATE_FACT"] - bureau["DAYS_CREDIT_ENDDATE"]
    bureau["BUREAU_ANNUITY_CREDIT_RATIO"] = bureau["AMT_ANNUITY"] / (bureau["AMT_CREDIT_SUM"] + EPS)
    bureau = bureau.merge(per_loan, how="left", on="SK_ID_BUREAU")

    bureau, cats = one_hot(bureau)
    num_aggs = numeric_aggs(bureau, cats)
    agg = summarise(bureau, "BURO", {**num_aggs, **{c: ["mean"] for c in cats}})

    # Active and closed bureau loans carry very different information: outstanding
    # debt on live accounts vs. a track record of loans repaid. Summarise separately.
    for label, flag in [("ACTIVE", "CREDIT_ACTIVE_Active"), ("CLOSED", "CREDIT_ACTIVE_Closed")]:
        agg = agg.join(summarise(bureau[bureau[flag] == 1], f"BURO_{label}", num_aggs), how="left")
    return downcast(agg)


def previous_applications() -> pd.DataFrame:
    """The applicant's earlier applications to Home Credit, approved and refused."""
    prev = downcast(read("previous_application.csv"))

    # Same 365243 sentinel as DAYS_EMPLOYED, here meaning "never happened".
    for c in ["DAYS_FIRST_DRAWING", "DAYS_FIRST_DUE", "DAYS_LAST_DUE_1ST_VERSION", "DAYS_LAST_DUE", "DAYS_TERMINATION"]:
        prev[c] = prev[c].replace(365243, np.nan)

    prev["APP_CREDIT_RATIO"] = prev["AMT_APPLICATION"] / (prev["AMT_CREDIT"] + EPS)
    prev["CREDIT_GOODS_RATIO"] = prev["AMT_CREDIT"] / (prev["AMT_GOODS_PRICE"] + EPS)
    prev["DOWN_PAYMENT_RATIO"] = prev["AMT_DOWN_PAYMENT"] / (prev["AMT_CREDIT"] + EPS)
    prev["PREV_CREDIT_TERM"] = prev["AMT_ANNUITY"] / (prev["AMT_CREDIT"] + EPS)
    # Did the loan run past its originally scheduled end date?
    prev["DUE_DIFF"] = prev["DAYS_LAST_DUE"] - prev["DAYS_LAST_DUE_1ST_VERSION"]

    prev, cats = one_hot(prev)
    num_aggs = numeric_aggs(prev, cats)
    agg = summarise(prev, "PREV", {**num_aggs, **{c: ["mean"] for c in cats}})

    # A history of refusals is a much stronger signal than the overall average, so
    # split it out instead of letting approved applications dilute it.
    for label, flag in [("APPROVED", "NAME_CONTRACT_STATUS_Approved"), ("REFUSED", "NAME_CONTRACT_STATUS_Refused")]:
        agg = agg.join(summarise(prev[prev[flag] == 1], f"PREV_{label}", num_aggs), how="left")
    return downcast(agg)


def pos_cash() -> pd.DataFrame:
    """Monthly balances of earlier point-of-sale and cash loans."""
    pos = read(
        "POS_CASH_balance.csv",
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
    pos["INSTALMENT_PAID_RATIO"] = 1 - pos["CNT_INSTALMENT_FUTURE"] / (pos["CNT_INSTALMENT"] + EPS)

    pos, cats = one_hot(pos)
    agg = summarise(pos, "POS", {
        "MONTHS_BALANCE": ["min", "max", "mean", "size"],
        "SK_DPD": ["max", "mean", "sum", "var"],
        "SK_DPD_DEF": ["max", "mean", "sum", "var"],
        "CNT_INSTALMENT": ["min", "max", "mean"],
        "CNT_INSTALMENT_FUTURE": ["min", "max", "mean"],
        "IS_DPD": ["mean", "sum"],
        "IS_DPD_DEF": ["mean", "sum"],
        "INSTALMENT_PAID_RATIO": ["min", "max", "mean"],
        **{c: ["mean"] for c in cats},
    })
    agg["POS_LOAN_COUNT"] = pos.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    # The last 12 months predict better than the lifetime average.
    recent = summarise(pos[pos["MONTHS_BALANCE"] >= -12], "POS_RECENT", {
        "SK_DPD": ["max", "mean"],
        "SK_DPD_DEF": ["max", "mean"],
        "IS_DPD": ["mean", "sum"],
    }, count=False)
    return downcast(agg.join(recent, how="left"))


def installments() -> pd.DataFrame:
    """Every scheduled payment on earlier loans, summarised across all of them."""
    ins = read(
        "installments_payments.csv",
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

    ins["PAYMENT_PERC"] = ins["AMT_PAYMENT"] / (ins["AMT_INSTALMENT"] + EPS)
    ins["PAYMENT_DIFF"] = ins["AMT_INSTALMENT"] - ins["AMT_PAYMENT"]
    # DPD = days paid late, DBD = days paid early. Both clipped at 0 so they stay
    # separable rather than cancelling out in a single signed column.
    ins["DPD"] = (ins["DAYS_ENTRY_PAYMENT"] - ins["DAYS_INSTALMENT"]).clip(lower=0)
    ins["DBD"] = (ins["DAYS_INSTALMENT"] - ins["DAYS_ENTRY_PAYMENT"]).clip(lower=0)
    ins["IS_LATE"] = (ins["DPD"] > 0).astype("int8")
    ins["IS_UNDERPAID"] = (ins["PAYMENT_DIFF"] > 0.01).astype("int8")

    agg = summarise(ins, "INS", {
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
    })
    agg["INS_LOAN_COUNT"] = ins.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    # Recency windows. Someone late two years ago but clean since is a different risk
    # from someone who started missing payments last quarter.
    for label, days in [("1Y", 365), ("2Y", 730)]:
        recent = summarise(ins[ins["DAYS_INSTALMENT"] >= -days], f"INS_{label}", {
            "DPD": ["max", "mean", "sum"],
            "PAYMENT_PERC": ["min", "mean"],
            "PAYMENT_DIFF": ["max", "mean", "sum"],
            "IS_LATE": ["mean", "sum"],
            "IS_UNDERPAID": ["mean", "sum"],
        })
        agg = agg.join(recent, how="left")

    # Trend: is the client's lateness getting worse over time? Ratio of recent mean
    # DPD to lifetime mean DPD.
    agg["INS_DPD_TREND"] = agg["INS_1Y_DPD_MEAN"] / (agg["INS_DPD_MEAN"] + EPS)
    agg["INS_LATE_TREND"] = agg["INS_1Y_IS_LATE_MEAN"] / (agg["INS_IS_LATE_MEAN"] + EPS)
    return downcast(agg)


def installments_per_loan() -> pd.DataFrame:
    """The same payments, summarised per prior loan first and then across loans.

    `installments` pools every payment, so one bad loan among many good ones is diluted.
    Summarising each loan first keeps "the worst single prior loan" visible. Built in the
    second stage, by `build_extra`.
    """
    ins = read(
        "installments_payments.csv",
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
    return agg.astype("float32")


def credit_card() -> pd.DataFrame:
    """Monthly balances of earlier Home Credit credit cards."""
    cc = downcast(read("credit_card_balance.csv"))

    cc["UTILIZATION"] = cc["AMT_BALANCE"] / (cc["AMT_CREDIT_LIMIT_ACTUAL"] + EPS)
    cc["PAYMENT_TO_MIN"] = cc["AMT_PAYMENT_TOTAL_CURRENT"] / (cc["AMT_INST_MIN_REGULARITY"] + EPS)
    cc["PAYMENT_TO_BALANCE"] = cc["AMT_PAYMENT_TOTAL_CURRENT"] / (cc["AMT_BALANCE"] + EPS)
    cc["DRAWINGS_TO_LIMIT"] = cc["AMT_DRAWINGS_CURRENT"] / (cc["AMT_CREDIT_LIMIT_ACTUAL"] + EPS)
    # Paying only the minimum every month is a classic distress signal.
    cc["PAYS_MINIMUM_ONLY"] = (
        (cc["AMT_PAYMENT_TOTAL_CURRENT"] <= cc["AMT_INST_MIN_REGULARITY"] * 1.05)
        & (cc["AMT_INST_MIN_REGULARITY"] > 0)
    ).astype("int8")
    cc["IS_DPD"] = (cc["SK_DPD"] > 0).astype("int8")

    cc, cats = one_hot(cc)
    agg = summarise(cc, "CC", {**numeric_aggs(cc, cats), **{c: ["mean"] for c in cats}})
    agg["CC_CARD_COUNT"] = cc.groupby("SK_ID_CURR")["SK_ID_PREV"].nunique()

    recent = summarise(cc[cc["MONTHS_BALANCE"] >= -12], "CC_RECENT", {
        "UTILIZATION": ["max", "mean"],
        "AMT_BALANCE": ["max", "mean"],
        "SK_DPD": ["max", "mean"],
        "IS_DPD": ["mean", "sum"],
        "PAYS_MINIMUM_ONLY": ["mean"],
        "AMT_DRAWINGS_ATM_CURRENT": ["max", "mean"],
    }, count=False)
    return downcast(agg.join(recent, how="left"))


# ==================================================================================
# 4. Building the cache
# ==================================================================================
def build_full() -> pd.DataFrame:
    """Every application joined to its history summaries (~1,480 columns, ~15 minutes)."""
    print("[features] application")
    df = application()

    for name, table in [
        ("bureau", bureau_and_balance),
        ("previous_application", previous_applications),
        ("pos_cash", pos_cash),
        ("installments", installments),
        ("credit_card", credit_card),
    ]:
        agg = table()
        print(f"[features] {name:22s} -> {agg.shape[1]} features")
        df = df.join(agg, how="left", on="SK_ID_CURR")
        del agg
        gc.collect()

    # No rows in a table means zero records, so every count is a true zero when absent.
    count_cols = [c for c in df.columns if c.endswith("_COUNT") and c != "EXT_SOURCES_NAN_COUNT"]
    df[count_cols] = df[count_cols].fillna(0)

    # Cross-table ratios -- these only exist once everything is joined.
    df["ANNUITY_TO_PREV_ANNUITY"] = df["AMT_ANNUITY"] / (df["PREV_AMT_ANNUITY_MEAN"] + EPS)
    df["CREDIT_TO_PREV_CREDIT"] = df["AMT_CREDIT"] / (df["PREV_AMT_CREDIT_MEAN"] + EPS)
    df["BUREAU_DEBT_TO_INCOME"] = df["BURO_AMT_CREDIT_SUM_DEBT_SUM"] / (df["AMT_INCOME_TOTAL"] + EPS)
    df["BUREAU_CREDIT_TO_INCOME"] = df["BURO_AMT_CREDIT_SUM_SUM"] / (df["AMT_INCOME_TOTAL"] + EPS)
    # Total annuity burden = this loan + everything still open at the bureau.
    df["TOTAL_ANNUITY_TO_INCOME"] = (
        df["AMT_ANNUITY"].fillna(0) + df["BURO_ACTIVE_AMT_ANNUITY_SUM"].fillna(0)
    ) / (df["AMT_INCOME_TOTAL"] + EPS)

    # Drop columns that are entirely constant or entirely missing. They cost memory and
    # only add noise to the feature-importance readings.
    nunique = df.nunique(dropna=False)
    dead = [c for c in nunique[nunique <= 1].index if c != "TARGET"]
    if dead:
        df = df.drop(columns=dead)
        print(f"[features] dropped {len(dead)} constant/all-missing columns")

    # A first clean-up of the one-hot names, which carry spaces and punctuation from the raw
    # category labels. The cache stores these names; `features.load_matrix` then makes them
    # fully LightGBM-safe with `sanitize`. Both steps stay as they are because the trained
    # models know their features by the names that come out of the two together.
    df.columns = [
        c.replace(" ", "_").replace(":", "_").replace(",", "_").replace("[", "(").replace("]", ")")
        for c in df.columns
    ]
    print(f"[features] full matrix {df.shape}")
    return df


def build_extra() -> pd.DataFrame:
    """Cohort and per-prior-loan features, in the full matrix's row order.

    Reads the cohort columns back from the saved full matrix rather than taking the frame
    in memory: a missing occupation is stored as None in parquet, which groups into its own
    cohort, and the served model was trained on features built exactly this way.
    """
    cohort_cols = {c for keys in features.COHORTS for c in keys} | set(features.COHORT_NUMERICS)
    df = pd.read_parquet(features.FULL_PATH, columns=["SK_ID_CURR", "TARGET"] + sorted(cohort_cols))
    extra = features.cohort_features(df, features.train_mask(df["TARGET"]))
    loans = installments_per_loan().reindex(df["SK_ID_CURR"].values)
    loans.index = extra.index
    extra = pd.concat([extra, loans], axis=1)
    extra.insert(0, "SK_ID_CURR", df["SK_ID_CURR"].to_numpy())
    print(f"[features] extra features {extra.shape[1] - 1}")
    return extra


def build_cache():
    """Build both tables from the raw CSVs and save them to cache/."""
    os.makedirs(features.CACHE, exist_ok=True)
    build_full().to_parquet(features.FULL_PATH, compression="zstd", index=False)
    build_extra().to_parquet(features.EXTRA_PATH, compression="zstd", index=False)
    print(f"[features] wrote {features.FULL_PATH} and {features.EXTRA_PATH}")
