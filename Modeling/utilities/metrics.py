"""
Full evaluation of the deployed model on the held-out test set.

AUC is what this project optimised, but it isn't the vocabulary credit risk is discussed
in, and it says nothing about whether the predicted probabilities mean anything or what
happens at a given approval rate. So this script produces the numbers a credit-scoring
write-up is expected to carry:

  * Gini = 2*AUC - 1. The same information as AUC, but it's the number lenders quote, so
    a reader from that world expects to see it.
  * KS statistic, the largest gap between the cumulative distributions of defaulters and
    non-defaulters. The standard separation measure in scorecard work.
  * Lift over the base rate, rather than raw average precision. AP is bounded below by
    the positive rate, so it doesn't compare across datasets with different base rates:
    0.302 here against 0.319 on a 20%-default dataset would invert the ranking.
  * A calibration table, since the model carries no isotonic wrapper and the claim that
    it is calibrated anyway should be shown rather than asserted.
  * A gains table, which answers what a lender actually asks: if we decline the riskiest
    N%, what share of defaults do we avoid and how many good customers do we turn away?
"""

from __future__ import annotations

import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, brier_score_loss,
                             classification_report, confusion_matrix, roc_auc_score,
                             roc_curve)

from evaluation import RESULTS, load
from run_one import select_features

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
NAME = "lightgbm_tuned_v2"


def ks_statistic(y_true, y_score) -> tuple[float, float]:
    """Kolmogorov-Smirnov: max separation between the two cumulative distributions."""
    fpr, tpr, thr = roc_curve(y_true, y_score)
    i = int(np.argmax(tpr - fpr))
    return float(tpr[i] - fpr[i]), float(thr[i])


def main():
    model = joblib.load(os.path.join(MODEL_DIR, f"{NAME}.joblib"))
    threshold = json.load(open(os.path.join(MODEL_DIR, f"{NAME}_threshold.json")))["threshold"]

    X_train, X_test, y_train, y_test = load("full_plus")
    keep = select_features(os.path.join(RESULTS, "features_top600.json"), X_train, "full_plus")
    X_test = X_test[keep]
    del X_train

    p = model.predict_proba(X_test)[:, 1]
    y = y_test.to_numpy()
    base = y.mean()

    auc = roc_auc_score(y, p)
    ap = average_precision_score(y, p)
    ks, ks_thr = ks_statistic(y, p)

    print("=" * 68)
    print("DISCRIMINATION -- can the model tell defaulters from non-defaulters?")
    print("=" * 68)
    print(f"  ROC AUC                {auc:.4f}")
    print(f"  Gini (2*AUC-1)         {2*auc-1:.4f}")
    print(f"  KS statistic           {ks:.4f}   (at score {ks_thr:.4f})")
    print(f"  Average precision      {ap:.4f}")
    print(f"  Base rate              {base:.4f}")
    print(f"  AP lift over base      {ap/base:.2f}x   <- the comparable figure across datasets")

    print()
    print("=" * 68)
    print("CALIBRATION -- do the predicted probabilities mean what they say?")
    print("=" * 68)
    print(f"  Mean predicted         {p.mean():.4f}")
    print(f"  Actual default rate    {base:.4f}")
    print(f"  Brier score            {brier_score_loss(y, p):.5f}")
    print(f"  (no isotonic wrapper -- scale_pos_weight was removed instead)")
    print()
    df = pd.DataFrame({"p": p, "y": y})
    df["decile"] = pd.qcut(df["p"], 10, labels=False, duplicates="drop")
    cal = df.groupby("decile").agg(predicted=("p", "mean"), actual=("y", "mean"),
                                   n=("y", "size")).reset_index()
    cal["decile"] = cal["decile"] + 1
    cal["gap"] = cal["actual"] - cal["predicted"]
    print(cal.to_string(index=False, float_format=lambda v: f"{v:.4f}"))

    print()
    print("=" * 68)
    print(f"DECISION QUALITY at the deployed threshold ({threshold:.4f})")
    print("=" * 68)
    pred = (p >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    print(f"  approved {tn+fn:,} ({(tn+fn)/len(y):.1%}) | declined {tp+fp:,} ({(tp+fp)/len(y):.1%})")
    print(f"  of those approved, {fn:,} defaulted -- a bad rate of {fn/(tn+fn):.2%} "
          f"against {base:.2%} if everyone were approved")
    print(f"  of those declined, {fp:,} would actually have repaid ({fp/(tp+fp):.1%} of declines)")
    print()
    print(classification_report(y, pred, target_names=["repaid", "defaulted"], digits=3))

    print("=" * 68)
    print("GAINS -- decline the riskiest N%, and what happens?")
    print("=" * 68)
    order = np.argsort(-p)
    ys = y[order]
    rows = []
    for pct in (5, 10, 20, 30, 40, 50):
        n = int(len(ys) * pct / 100)
        caught = ys[:n].sum()
        rows.append({
            "decline riskiest %": pct,
            "defaults avoided": f"{caught/y.sum():.1%}",
            "bad rate in that slice": f"{caught/n:.1%}",
            "lift vs random": f"{(caught/n)/base:.2f}x",
            "good customers lost": f"{(n-caught):,}",
        })
    print(pd.DataFrame(rows).to_string(index=False))

    out = {"auc": float(auc), "gini": float(2*auc-1), "ks": float(ks), "ap": float(ap),
           "ap_lift": float(ap/base), "base_rate": float(base),
           "brier": float(brier_score_loss(y, p)), "mean_predicted": float(p.mean()),
           "threshold": float(threshold)}
    with open(os.path.join(RESULTS, "final_metrics.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nsaved -> {os.path.join(RESULTS, 'final_metrics.json')}")


if __name__ == "__main__":
    main()
