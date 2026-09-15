"""
Precompute the dataset findings the Findings page renders.

The page must not read 2.5 GB of CSV on every load, so everything is reduced to a small
JSON here and the page just draws it. Re-run after any change to the data.

Each block answers one question a reader would actually ask, rather than dumping every
column's distribution.
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "Data")
OUT = os.path.join(HERE, "results", "site_findings.json")


def rate_by_band(df, col, bands, labels):
    """Miss rate within each band of a numeric column."""
    b = pd.cut(df[col], bins=bands, labels=labels, include_lowest=True)
    g = df.groupby(b, observed=True)["TARGET"].agg(["mean", "size"])
    return [{"band": str(i), "rate": float(r["mean"]), "n": int(r["size"])}
            for i, r in g.iterrows()]


def main():
    app = pd.read_csv(os.path.join(DATA, "application_train.csv"), usecols=[
        "TARGET", "EXT_SOURCE_1", "EXT_SOURCE_2", "EXT_SOURCE_3", "DAYS_BIRTH",
        "NAME_EDUCATION_TYPE", "NAME_INCOME_TYPE", "AMT_INCOME_TOTAL", "AMT_ANNUITY",
        "AMT_CREDIT", "CODE_GENDER", "NAME_CONTRACT_TYPE", "DAYS_EMPLOYED",
    ])
    out: dict = {}
    out["n"] = int(len(app))
    out["miss_rate"] = float(app["TARGET"].mean())

    # --- the dominant signal: the three external bureau scores ---
    app["ext_mean"] = app[["EXT_SOURCE_1", "EXT_SOURCE_2", "EXT_SOURCE_3"]].mean(axis=1)
    q = pd.qcut(app["ext_mean"], 5, labels=["lowest 20%", "2nd", "middle", "4th", "highest 20%"])
    g = app.groupby(q, observed=True)["TARGET"].agg(["mean", "size"])
    out["by_ext_score"] = [{"band": str(i), "rate": float(r["mean"]), "n": int(r["size"])}
                           for i, r in g.iterrows()]
    out["ext_missing_rate"] = float(app["ext_mean"].isna().mean())

    # --- age ---
    app["age"] = -app["DAYS_BIRTH"] / 365.25
    out["by_age"] = rate_by_band(app, "age", [0, 25, 30, 40, 50, 60, 100],
                                 ["under 25", "25-29", "30-39", "40-49", "50-59", "60+"])

    # --- affordability: the monthly payment as a share of monthly income ---
    app["dsr"] = app["AMT_ANNUITY"] / app["AMT_INCOME_TOTAL"]
    out["by_dsr"] = rate_by_band(app, "dsr", [0, .10, .15, .20, .25, .30, 10],
                                 ["under 10%", "10-15%", "15-20%", "20-25%", "25-30%", "over 30%"])

    # --- education ---
    g = app.groupby("NAME_EDUCATION_TYPE", observed=True)["TARGET"].agg(["mean", "size"])
    g = g[g["size"] > 500].sort_values("mean")
    out["by_education"] = [{"band": str(i).replace(" / secondary special", ""),
                            "rate": float(r["mean"]), "n": int(r["size"])}
                           for i, r in g.iterrows()]

    # --- employment length ---
    emp = app[app["DAYS_EMPLOYED"] != 365243].copy()
    emp["yrs"] = -emp["DAYS_EMPLOYED"] / 365.25
    out["by_employment"] = rate_by_band(emp, "yrs", [0, 1, 3, 6, 11, 100],
                                        ["under 1yr", "1-3", "3-6", "6-11", "11+"])

    out["by_contract"] = [
        {"band": str(i), "rate": float(r["mean"]), "n": int(r["size"])}
        for i, r in app.groupby("NAME_CONTRACT_TYPE", observed=True)["TARGET"]
                       .agg(["mean", "size"]).iterrows()]

    # --- what the money was actually for (prior applications) ---
    prev = pd.read_csv(os.path.join(DATA, "previous_application.csv"),
                       usecols=["NAME_GOODS_CATEGORY", "CNT_PAYMENT"])
    goods = prev["NAME_GOODS_CATEGORY"]
    goods = goods[~goods.isin(["XNA", "XAP"])]
    vc = (goods.value_counts(normalize=True) * 100).head(8)
    out["goods"] = [{"band": str(i), "pct": float(v)} for i, v in vc.items()]
    term = prev["CNT_PAYMENT"].dropna()
    term = term[term > 0]
    out["term"] = {"median": float(term.median()), "p90": float(term.quantile(.9)),
                   "max": float(term.max())}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)

    print(f"wrote {OUT}")
    print(f"  {out['n']:,} applications, {out['miss_rate']:.2%} missed an early payment")
    lo = out["by_ext_score"][0]["rate"]
    hi = out["by_ext_score"][-1]["rate"]
    print(f"  external score: lowest fifth {lo:.1%} vs highest fifth {hi:.1%} "
          f"({lo/hi:.1f}x)")
    print(f"  age: {out['by_age'][0]['band']} {out['by_age'][0]['rate']:.1%} vs "
          f"{out['by_age'][-1]['band']} {out['by_age'][-1]['rate']:.1%}")
    print(f"  median term {out['term']['median']:.0f} months")


if __name__ == "__main__":
    main()
