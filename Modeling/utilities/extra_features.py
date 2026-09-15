"""
Round-two features computed on top of the cached matrix (no re-reading the raw CSVs).

Two families:

1. Cohort-relative statistics. An income of 150,000 means something different for a
   labourer than for a manager; a raw value can't express that but a z-score against
   the client's own cohort can. For each (categorical cohort, numeric feature) pair,
   compute the cohort mean/std and the client's deviation from it. These use no target
   information at all, so they are safe to compute on the full frame before splitting.

2. Two-level installment aggregation. `installments_payments` is aggregated per
   SK_ID_PREV first and only then per SK_ID_CURR, which surfaces "the worst single
   prior loan" -- a client with one disastrous loan among ten clean ones looks fine
   under a flat client-level mean.
"""

from __future__ import annotations

import gc
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "Data")
CACHE = os.path.join(HERE, "cache")

# Explicit tags rather than a truncation rule. The previous rule was
# "_".join(k[:4] for k in keys), under which NAME_EDUCATION_TYPE and NAME_INCOME_TYPE both
# produced "NAME" -- so the education cohort was silently overwritten by the income-type
# cohort and 16 features vanished without any error. A hand-written mapping cannot collide
# by accident, and a new cohort that forgets to add one fails loudly in COHORT_TAG[keys].
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


def export_cohort_tables(df: pd.DataFrame, fit_mask, path: str) -> dict:
    """Save the cohort means and standard deviations so the API can rebuild these features.

    The serving path has one applicant, not a population, so it cannot compute a group mean
    on the fly. Without these tables all 80 cohort features arrive missing and the deployed
    model drops from 0.760 to 0.744 AUC.

    Statistics come from the same training rows `cohort_features` uses, so a served value is
    identical to the one the model was trained on. Kept here rather than in the API for the
    same reason `add_application_features` is shared: one definition, no drift.
    """
    fit = df.loc[fit_mask]
    out = {"numerics": list(COHORT_NUMERICS), "cohorts": {}}
    for keys in COHORTS:
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
                # Multi-key cohorts are keyed on the joined values, matching the API side.
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
    agg["INSL_LOANS_EVER_LATE"] = bad
    agg["INSL_LOANS_EVER_LATE"] = agg["INSL_LOANS_EVER_LATE"].fillna(0)
    agg["INSL_FRAC_LOANS_LATE"] = agg["INSL_LOANS_EVER_LATE"] / agg["INSL_N_LOANS"]

    del per_loan
    gc.collect()
    return agg.astype("float32")


def main():
    src = os.path.join(CACHE, "features_full.parquet")
    # Only the cohort keys and the numerics they modulate -- reading all 1,482 columns
    # here would cost ~1.8 GB for no reason.
    need = ["SK_ID_CURR", "TARGET"] + sorted({c for keys in COHORTS for c in keys} | set(COHORT_NUMERICS))
    df = pd.read_parquet(src, columns=need)
    print(f"loaded {df.shape}")

    # Reproduce the harness's train/test partition. train_test_split with `stratify`
    # partitions on y alone, so the same seed and the same y give the same split the
    # models see, regardless of which columns are loaded here.
    from sklearn.model_selection import train_test_split

    train_idx, _ = train_test_split(
        df.index, test_size=0.2, random_state=42, stratify=df["TARGET"]
    )
    fit_mask = df.index.isin(train_idx)
    print(f"cohort statistics fit on {fit_mask.sum():,} training rows only")

    extra = cohort_features(df, fit_mask)
    print(f"cohort features: {extra.shape[1]}")

    loans = installments_per_loan()
    print(f"per-loan installment features: {loans.shape[1]}")
    loans = loans.reindex(df["SK_ID_CURR"].values)  # align to df's row order
    loans.index = extra.index
    extra = pd.concat([extra, loans], axis=1)

    extra.insert(0, "SK_ID_CURR", df["SK_ID_CURR"].values)
    out = os.path.join(CACHE, "features_extra.parquet")
    extra.to_parquet(out, compression="zstd", index=False)
    print(f"wrote {out} ({os.path.getsize(out)/1e6:.0f} MB, {extra.shape[1]-1} features)")


if __name__ == "__main__":
    main()
