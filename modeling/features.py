"""
Feature engineering shared by the notebooks and the site's backend.

The backend imports `add_application_features` to turn one form into one model input, and
reads the cohort tables `export_cohort_tables` writes. The notebooks use the same functions,
so the site can't quietly compute a feature differently from how the model learned it.

The file reads top to bottom:

  1. Paths and settings
  2. What a preapproval form can supply   FORM_INPUTS, PROTECTED, form_feature_columns
  3. Application features                 add_application_features
  4. Cohort features                      cohort_features, export_cohort_tables
  5. Split and loading                    train_mask, load_matrix

The features built from the credit-history tables are in `history_features.py`. That module
writes the two cached tables in `cache/` that `load_matrix` reads; the site never needs it.
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

# The feature formulas divide by zero and take the variance of single rows all the time,
# by design: the results are inf or NaN, which LightGBM handles. Pandas and NumPy warn on
# every one, which buries anything useful. This applies to whoever imports the module.
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)


# ==================================================================================
# 1. Paths and settings
# ==================================================================================
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CACHE = os.path.join(HERE, "cache")
FULL_PATH = os.path.join(CACHE, "features_full.parquet")
EXTRA_PATH = os.path.join(CACHE, "features_extra.parquet")
SEED = 42

# Added to every denominator, so a zero (or a missing count treated as zero) gives a huge
# ratio rather than a division error.
EPS = 1e-6


# ==================================================================================
# 2. What a preapproval form can supply
# ==================================================================================
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



# ==================================================================================
# 3. Application features
# ==================================================================================
def downcast(df: pd.DataFrame) -> pd.DataFrame:
    """float64 -> float32, int64 -> int32. Halves memory with no meaningful precision loss."""
    for c in df.columns:
        if df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
        elif df[c].dtype == "int64":
            df[c] = df[c].astype("int32")
    return df


def add_application_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive the application-level features from the raw columns.

    Kept as its own function so the serving path (`backend/app/model/service.py`) can build a
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

    # --- affordability ratios: how big is this loan relative to what they earn ---
    df["CREDIT_INCOME_RATIO"] = col("AMT_CREDIT") / (col("AMT_INCOME_TOTAL") + EPS)
    df["ANNUITY_INCOME_RATIO"] = col("AMT_ANNUITY") / (col("AMT_INCOME_TOTAL") + EPS)
    df["CREDIT_TERM"] = col("AMT_ANNUITY") / (col("AMT_CREDIT") + EPS)
    df["CREDIT_GOODS_RATIO"] = col("AMT_CREDIT") / (col("AMT_GOODS_PRICE") + EPS)
    df["GOODS_INCOME_RATIO"] = col("AMT_GOODS_PRICE") / (col("AMT_INCOME_TOTAL") + EPS)
    df["CREDIT_MINUS_GOODS"] = col("AMT_CREDIT") - col("AMT_GOODS_PRICE")
    df["INCOME_PER_PERSON"] = col("AMT_INCOME_TOTAL") / (col("CNT_FAM_MEMBERS") + EPS)
    df["INCOME_PER_CHILD"] = col("AMT_INCOME_TOTAL") / (1 + col("CNT_CHILDREN"))
    df["CHILDREN_RATIO"] = col("CNT_CHILDREN") / (col("CNT_FAM_MEMBERS") + EPS)

    # --- life-stage ratios ---
    df["EMPLOYED_BIRTH_RATIO"] = col("DAYS_EMPLOYED") / (col("DAYS_BIRTH") + EPS)
    df["CAR_TO_BIRTH_RATIO"] = col("OWN_CAR_AGE") / (-col("DAYS_BIRTH") / 365.0 + EPS)
    df["CAR_TO_EMPLOY_RATIO"] = col("OWN_CAR_AGE") / (-col("DAYS_EMPLOYED") / 365.0 + EPS)
    df["PHONE_TO_BIRTH_RATIO"] = col("DAYS_LAST_PHONE_CHANGE") / (col("DAYS_BIRTH") + EPS)
    df["PHONE_TO_EMPLOY_RATIO"] = col("DAYS_LAST_PHONE_CHANGE") / (col("DAYS_EMPLOYED") + EPS)
    df["ID_TO_BIRTH_RATIO"] = col("DAYS_ID_PUBLISH") / (col("DAYS_BIRTH") + EPS)
    df["REGISTRATION_TO_BIRTH_RATIO"] = col("DAYS_REGISTRATION") / (col("DAYS_BIRTH") + EPS)

    # --- external bureau scores: the strongest signal in the dataset, so pass summary
    # statistics across the three as well as the raw values ---
    ext = pd.concat([col(f"EXT_SOURCE_{i}") for i in (1, 2, 3)], axis=1)
    df["EXT_SOURCES_MEAN"] = ext.mean(axis=1)
    df["EXT_SOURCES_MIN"] = ext.min(axis=1)
    df["EXT_SOURCES_MAX"] = ext.max(axis=1)
    df["EXT_SOURCES_STD"] = ext.std(axis=1)
    df["EXT_SOURCES_PROD"] = ext.iloc[:, 0] * ext.iloc[:, 1] * ext.iloc[:, 2]
    df["EXT_SOURCES_NAN_COUNT"] = ext.isna().sum(axis=1).astype("int8")
    # Weighted blend -- EXT_SOURCE_3 and _2 have the most coverage and signal. A missing
    # score counts as zero here, so a form with no scores gets 0 rather than NaN.
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
    df["DEF_30_RATIO"] = col("DEF_30_CNT_SOCIAL_CIRCLE") / (col("OBS_30_CNT_SOCIAL_CIRCLE") + EPS)
    df["DEF_60_RATIO"] = col("DEF_60_CNT_SOCIAL_CIRCLE") / (col("OBS_60_CNT_SOCIAL_CIRCLE") + EPS)

    return downcast(df)


# ==================================================================================
# 4. Cohort features
# ==================================================================================
# Each cohort compares an applicant with others who share a trait: how far their income,
# loan, bureau score and so on sit from their group's average.
#
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


def _cohort_stats(df: pd.DataFrame, fit_mask, cohorts=None):
    """Yield (tag, keys, column, stats) for each cohort and numeric column in `df`.

    `stats` is the mean and standard deviation of the column within each group, estimated on
    the training rows (`fit_mask`) only. Both `cohort_features` (training) and
    `export_cohort_tables` (the website) read from here, so the site's lookup tables always
    hold exactly the numbers the model was trained with.
    """
    fit = df.loc[fit_mask]
    for keys in (COHORTS if cohorts is None else cohorts):
        keys = [k for k in keys if k in df.columns]
        if not keys:
            continue
        g = fit.groupby(keys, observed=True, dropna=False)
        for col in COHORT_NUMERICS:
            if col in df.columns:
                yield COHORT_TAG[tuple(keys)], keys, col, g[col].agg(["mean", "std"])


def cohort_features(df: pd.DataFrame, fit_mask: np.ndarray) -> pd.DataFrame:
    """COH_<tag>_<column>_MEAN (the group's average) and _Z (the applicant's distance from
    it, in group standard deviations) for every row of `df`.

    The statistics come from training rows only. They use no target information, so pooling
    would not leak the label -- but estimating them over train+test would still be
    transductive, and a held-out test set is supposed to stand in for applicants the model
    has never seen.
    """
    out = pd.DataFrame(index=df.index)
    group_of = {}  # each row's group, per cohort
    for tag, keys, col, stats in _cohort_stats(df, fit_mask):
        if tag not in group_of:
            group_of[tag] = pd.MultiIndex.from_frame(df[keys]) if len(keys) > 1 else pd.Index(df[keys[0]])
        mean = pd.Series(stats["mean"].reindex(group_of[tag]).values, index=df.index)
        std = pd.Series(stats["std"].reindex(group_of[tag]).values, index=df.index)
        out[f"COH_{tag}_{col}_MEAN"] = mean.astype("float32")
        out[f"COH_{tag}_{col}_Z"] = ((df[col] - mean) / (std + EPS)).astype("float32")
    return out


def export_cohort_tables(df: pd.DataFrame, fit_mask, path: str, cohorts=None) -> dict:
    """Save the cohort means and standard deviations so the backend can rebuild these features.

    The serving path has one applicant, not a population, so it cannot compute a group mean
    on the fly; without these tables every cohort feature would arrive missing. `cohorts`
    limits the export to the cohorts the served model uses (default: all of them).
    """
    out = {"numerics": list(COHORT_NUMERICS), "cohorts": {}}
    for tag, keys, col, stats in _cohort_stats(df, fit_mask, cohorts):
        groups = out["cohorts"].setdefault(tag, {"keys": keys, "stats": {}})["stats"]
        for idx, row in stats.iterrows():
            # Multi-key cohorts are keyed on the joined values, matching the backend.
            k = "||".join(str(v) for v in (idx if isinstance(idx, tuple) else (idx,)))
            if pd.isna(row["mean"]):
                continue
            groups.setdefault(k, {})[col] = [float(row["mean"]),
                                             float(row["std"]) if pd.notna(row["std"]) else 0.0]

    with open(path, "w") as f:
        json.dump(out, f)
    n = sum(len(c["stats"]) for c in out["cohorts"].values())
    print(f"  wrote {path}: {len(out['cohorts'])} cohorts, {n} groups, "
          f"{os.path.getsize(path)/1e3:.0f} KB")
    return out


# ==================================================================================
# 5. Split and loading
# ==================================================================================
def train_mask(target: pd.Series) -> np.ndarray:
    """Which rows are in the training split. `train_test_split` stratified on y alone gives
    the same partition whatever columns are loaded, so this matches the notebook's split."""
    train_idx, _ = train_test_split(target.index, test_size=0.2, random_state=SEED, stratify=target)
    return target.index.isin(train_idx)


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
