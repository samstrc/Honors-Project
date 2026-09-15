"""
Shared evaluation harness.

Protocol (fixed for every experiment so the ablation ladder is comparable):

  * 80/20 stratified train/test split, random_state=42 -- the same split the original
    notebook used. The test set is touched exactly once per experiment, for the final
    number; nothing is selected on it.
  * Model selection metric = 5-fold stratified CV AUC computed inside the 80%
    training portion, reported as out-of-fold AUC plus the across-fold std.
  * Test predictions are the mean of the 5 fold models' predictions. Each fold model
    saw only its own 4/5 of the training data, so this leaks nothing.

Why CV AUC and not test AUC drives decisions: with ~4,960 positives in the test set the
standard error of a single test AUC is roughly 0.006, so test-set differences smaller
than ~0.012 are not distinguishable. The 5-fold OOF estimate over 246k rows is far
tighter and is what any change gets judged on.
"""

from __future__ import annotations

import gc
import os
import warnings

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
RESULTS = os.path.join(HERE, "results")

SEED = 42
N_FOLDS = 5
TARGET = "TARGET"
DROP = ["SK_ID_CURR", TARGET]

# `metric="auc"` is load-bearing here. LightGBM's sklearn wrapper adds the objective's
# default metric (binary_logloss) to the evaluation list, and the early_stopping callback
# fires as soon as any tracked metric stalls. Under scale_pos_weight the model is
# miscalibrated by design, so validation logloss starts degrading within about 20
# iterations while AUC is still climbing for another 2,000, which cuts training short.
# Pinning the metric to auc and passing first_metric_only=True (see lgb_es) makes early
# stopping watch the thing we care about.
LGB_BASE = dict(objective="binary", metric="auc", verbosity=-1, n_jobs=-1, random_state=SEED)


def lgb_es(rounds: int = 200):
    """fit_kwargs_fn for LightGBM early stopping against the fold's validation set."""
    from lightgbm import early_stopping, log_evaluation

    def fn(model, Xtr, ytr, Xva, yva):
        return dict(
            eval_set=[(Xva, yva)],
            eval_metric="auc",
            callbacks=[early_stopping(rounds, first_metric_only=True, verbose=False), log_evaluation(0)],
        )

    return fn


def sanitize(names) -> list[str]:
    """LightGBM rejects non-alphanumeric characters in feature names; make them safe and unique."""
    import re

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


def load(level: str = "full"):
    """
    Load a cached feature set and return the fixed train/test split.

    `level="full_plus"` joins the round-two features from `extra_features.py` onto the
    full matrix. Both are written in the same row order from the same source, and the
    join is on SK_ID_CURR, so alignment is checked rather than assumed.
    """
    if level == "full_plus":
        df = pd.read_parquet(os.path.join(CACHE, "features_full.parquet"))
        add = pd.read_parquet(os.path.join(CACHE, "features_extra.parquet"))
        assert (df["SK_ID_CURR"].values == add["SK_ID_CURR"].values).all(), "row order mismatch"
        add = add.drop(columns=["SK_ID_CURR"])
        add.index = df.index
        df = pd.concat([df, add], axis=1)
        del add
        gc.collect()
    else:
        df = pd.read_parquet(os.path.join(CACHE, f"features_{level}.parquet"))
    df.columns = sanitize(df.columns)
    y = df[TARGET].astype("int8")
    X = df.drop(columns=[c for c in DROP if c in df.columns])
    del df
    gc.collect()

    # Object columns -> pandas `category` so LightGBM/XGBoost can use native
    # categorical splits. Categories are assigned before the split, so train and test
    # share one encoding.
    for c in X.select_dtypes(include=["object"]).columns:
        X[c] = X[c].astype("category")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=SEED, stratify=y
    )
    del X, y
    gc.collect()
    return X_train, X_test, y_train, y_test


def cat_cols(X: pd.DataFrame) -> list[str]:
    return list(X.select_dtypes(include=["category"]).columns)


def auc_se(y_true, auc: float) -> float:
    """Hanley-McNeil standard error of an AUC estimate -- used to say whether a gap is real."""
    n1 = int(np.sum(y_true == 1))
    n0 = int(np.sum(y_true == 0))
    q1 = auc / (2 - auc)
    q2 = 2 * auc**2 / (1 + auc)
    var = (auc * (1 - auc) + (n1 - 1) * (q1 - auc**2) + (n0 - 1) * (q2 - auc**2)) / (n1 * n0)
    return float(np.sqrt(var))


def run_cv(
    X_train,
    y_train,
    X_test,
    y_test,
    make_model,
    fit_kwargs_fn=None,
    n_folds: int = N_FOLDS,
    name: str = "model",
    return_models: bool = False,
    verbose: bool = True,
):
    """
    Fit `make_model()` on each of `n_folds` stratified folds of the training data.

    `make_model(fold)` returns a fresh estimator. `fit_kwargs_fn(model, Xtr, ytr, Xva, yva)`
    returns the kwargs for `.fit()` (used for early stopping, which needs the fold's
    validation set). Returns a dict of metrics plus OOF and test predictions.
    """
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=SEED)
    oof = np.zeros(len(X_train))
    test_pred = np.zeros(len(X_test))
    fold_aucs, best_iters, models = [], [], []

    for fold, (tr, va) in enumerate(skf.split(X_train, y_train)):
        Xtr, ytr = X_train.iloc[tr], y_train.iloc[tr]
        Xva, yva = X_train.iloc[va], y_train.iloc[va]

        model = make_model(fold)
        kw = fit_kwargs_fn(model, Xtr, ytr, Xva, yva) if fit_kwargs_fn else {}
        model.fit(Xtr, ytr, **kw)

        oof[va] = model.predict_proba(Xva)[:, 1]
        test_pred += model.predict_proba(X_test)[:, 1] / n_folds

        fold_auc = roc_auc_score(yva, oof[va])
        fold_aucs.append(fold_auc)
        bi = getattr(model, "best_iteration_", None) or getattr(model, "best_iteration", None)
        if bi:
            best_iters.append(int(bi))
        if return_models:
            models.append(model)
        else:
            del model
        del Xtr, ytr, Xva, yva
        gc.collect()
        if verbose:
            print(f"    fold {fold + 1}/{n_folds}  auc={fold_auc:.5f}" + (f"  iters={bi}" if bi else ""))

    cv_auc = roc_auc_score(y_train, oof)
    test_auc = roc_auc_score(y_test, test_pred)
    out = {
        "name": name,
        "cv_auc": float(cv_auc),
        "cv_fold_mean": float(np.mean(fold_aucs)),
        "cv_fold_std": float(np.std(fold_aucs)),
        "test_auc": float(test_auc),
        "test_auc_se": auc_se(np.asarray(y_test), test_auc),
        "fold_aucs": [float(a) for a in fold_aucs],
        "best_iters": best_iters,
        "oof": oof,
        "test_pred": test_pred,
    }
    if return_models:
        out["models"] = models
    if verbose:
        print(
            f"  [{name}] CV AUC={cv_auc:.5f} (fold sd {np.std(fold_aucs):.5f})   "
            f"TEST AUC={test_auc:.5f} (+/- {out['test_auc_se']:.5f})"
        )
    return out


def save_result(res: dict, path: str):
    """Persist a result dict as JSON, dropping the big prediction arrays."""
    import json

    slim = {k: v for k, v in res.items() if k not in ("oof", "test_pred", "models")}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing = {}
    if os.path.exists(path):
        with open(path) as f:
            existing = json.load(f)
    existing[res["name"]] = slim
    with open(path, "w") as f:
        json.dump(existing, f, indent=2)
