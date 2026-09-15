"""
Run one configuration through the standard harness.

A thin wrapper so variants can be evaluated without editing the ablation ladder:

    python run_one.py --name A5_no_reweight --level full --features results/features_top600.json \
                   --no-scale-pos-weight
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from lightgbm import LGBMClassifier

from evaluation import CACHE, LGB_BASE, RESULTS, lgb_es, load, run_cv, sanitize, save_result

RESULT_FILE = os.path.join(RESULTS, "ablation.json")


def extra_columns() -> list[str]:
    """Names of the round-two features, read from the parquet schema (no data load)."""
    import pyarrow.parquet as pq

    names = pq.ParquetFile(os.path.join(CACHE, "features_extra.parquet")).schema_arrow.names
    return [c for c in sanitize(names) if c != "SK_ID_CURR"]


def select_features(path: str, X, level: str) -> list[str]:
    """
    Restrict to a saved feature list.

    The top-K lists are selected on the `full` matrix, so applying one at `full_plus`
    would drop every round-two feature -- exactly what such a rung is meant to test.
    Union the round-two columns back in whenever the level includes them.
    """
    with open(path) as f:
        keep = [c for c in json.load(f) if c in X.columns]
    if level == "full_plus":
        seen = set(keep)
        keep += [c for c in extra_columns() if c in X.columns and c not in seen]
    return keep

NOTEBOOK_LGBM = dict(
    num_leaves=37,
    max_depth=10,
    learning_rate=0.01158774243708483,
    min_child_samples=52,
    subsample=0.7000347085097536,
    subsample_freq=1,
    colsample_bytree=0.7390223118936016,
    reg_alpha=0.4633992503362058,
    reg_lambda=0.036337126717267146,
    scale_pos_weight=3.9518352551878237,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--level", default="full", choices=["base", "full", "full_plus"])
    ap.add_argument("--features", default=None, help="JSON list of feature names to keep")
    ap.add_argument("--params", default=None, help="JSON file with a 'params' key")
    ap.add_argument("--no-scale-pos-weight", action="store_true")
    ap.add_argument("--es-rounds", type=int, default=200)
    args = ap.parse_args()

    X_train, X_test, y_train, y_test = load(args.level)
    if args.features:
        keep = select_features(args.features, X_train, args.level)
        X_train, X_test = X_train[keep], X_test[keep]

    if args.params:
        with open(args.params) as f:
            p = dict(json.load(f)["params"])
    else:
        p = dict(NOTEBOOK_LGBM)
    if args.no_scale_pos_weight:
        p.pop("scale_pos_weight", None)
    p["n_estimators"] = 20000

    print(f"{args.name}: level={args.level} features={X_train.shape[1]}")
    res = run_cv(
        X_train, y_train, X_test, y_test,
        make_model=lambda f: LGBMClassifier(**LGB_BASE, **p),
        fit_kwargs_fn=lgb_es(args.es_rounds),
        name=args.name,
    )
    res["params"] = p
    save_result(res, RESULT_FILE)
    np.save(os.path.join(RESULTS, f"oof_{args.name}.npy"), res["oof"])
    np.save(os.path.join(RESULTS, f"test_{args.name}.npy"), res["test_pred"])


if __name__ == "__main__":
    main()
