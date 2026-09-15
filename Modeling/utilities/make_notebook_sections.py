"""
Generate the written sections of the analysis notebook.

Idempotent: everything between each pair of sentinel cells is replaced on each run, so
this can be re-run after new results land without duplicating anything.

This manages Part 3 only: the runnable path that builds the deployed model and writes
its weights. Nothing else in the project saves a model, so the notebook is the one place
model creation happens.

Part 2's cells are left alone. They report rather than recompute, loading a saved artefact
from `utilities/results/` and rendering it, so they stay current as results change and only
their prose ever needs editing by hand.
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
NB = os.path.join(HERE, "..", "home_credit_default_risk.ipynb")
NB_LEGACY = os.path.join(HERE, "..", "home_credit_default_risk.ipynb")

PART3_START, PART3_END = "<!-- PART3-START -->", "<!-- PART3-END -->"

_n = [0]


def _cell_id():
    _n[0] += 1
    # Part 2's cells use "analysis-NNN", so Part 3 uses its own prefix. nbformat
    # requires ids to be unique across the whole notebook.
    return f"build-{_n[0]:03d}"


def md(text):
    return {"cell_type": "markdown", "id": _cell_id(), "metadata": {},
            "source": text.strip("\n").splitlines(keepends=True)}


def code(text):
    return {"cell_type": "code", "id": _cell_id(), "execution_count": None,
            "metadata": {}, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


# ==================================================================================
# Part 3 -- the runnable model build
# ==================================================================================
def build_cells():
    cells = [md(PART3_START)]

    cells.append(md("""
---

# Part 3: Building the model the site uses

Everything above reports on work that has already run. This part is different: these cells
are the real thing. Run them top to bottom and they rebuild the model the API serves, from
raw CSV to saved weights. Nothing else in the project writes a model file.

It takes about 25 minutes, most of that building features. The feature engineering itself
stays in `utilities/build_features.py`. It is 600 lines of table aggregation, and the API imports the
same functions, so a second copy here could drift out of step and quietly skew what gets
served. Everything about creating the model is in this notebook.
"""))

    cells.append(md("## 3.1 Build the features"))
    cells.append(code('''
import json, os, subprocess, sys
import numpy as np, pandas as pd

UTILS = "utilities"
CACHE, RESULTS = f"{UTILS}/cache", f"{UTILS}/results"
MODELS = "models"
sys.path.insert(0, UTILS)

# Skip the rebuild if the features are already cached. Delete them to force a fresh run.
need = [f"{CACHE}/features_full.parquet", f"{CACHE}/features_extra.parquet"]
if all(os.path.exists(p) for p in need):
    print("feature matrices already cached:")
    for p in need:
        print(f"  {p}  ({os.path.getsize(p)/1e6:.0f} MB)")
else:
    print("building features (about 15 minutes)...")
    subprocess.run([sys.executable, "build_features.py", "--level", "full"], cwd=UTILS, check=True)
    subprocess.run([sys.executable, "extra_features.py"], cwd=UTILS, check=True)
'''))

    cells.append(md("""
## 3.2 Load and split the data

Same split every experiment in Part 2 used: 80/20 stratified, seed 42. The features are the
top 600 by gain, picked on training folds only during the sweep in §2.5, plus the cohort
features.
"""))
    cells.append(code('''
from evaluation import load
from run_one import select_features

X_train, X_test, y_train, y_test = load("full_plus")
keep = select_features(f"{RESULTS}/features_top600.json", X_train, "full_plus")
X_train, X_test = X_train[keep], X_test[keep]

print(f"train {X_train.shape[0]:,} x {X_train.shape[1]}   test {X_test.shape[0]:,}")
print(f"positives: {int(y_train.sum()):,} train / {int(y_test.sum()):,} test "
      f"({y_train.mean():.2%} base rate)")
'''))

    cells.append(md("""
## 3.3 Train the model

The setting that won the Optuna search in §2.7, refit on the whole training split. The tree
count is whatever cross-validation actually needed, not another guess. The folds early-stop
on 80% of the data, so their average runs slightly short on 100%, which is the safer way to
be wrong.

No `scale_pos_weight`. §2.6 showed it bought no AUC and was the only reason Part 1 needed
isotonic regression to fix its probabilities.
"""))
    cells.append(code('''
from lightgbm import LGBMClassifier
from evaluation import LGB_BASE

params = dict(json.load(open(f"{RESULTS}/A7_trial26_wrapped.json"))["params"])
RUN = "A11_cohort_fixed"   # the cross-validated run on the current feature set
n_trees = int(np.mean(json.load(open(f"{RESULTS}/ablation.json"))[RUN]["best_iters"]))
params["n_estimators"] = n_trees

print(f"fitting {n_trees:,} trees on {len(X_train):,} rows...")
model = LGBMClassifier(**LGB_BASE, **params)
model.fit(X_train, y_train)
print("done")
pd.Series({k: v for k, v in params.items() if k != "n_estimators"}).to_frame("value")
'''))

    cells.append(md("## 3.4 Check the score, and that the probabilities are honest"))
    cells.append(code('''
from sklearn.metrics import average_precision_score, roc_auc_score

proba = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, proba)
ap = average_precision_score(y_test, proba)

print(f"test AUC              {auc:.4f}      (Gini {2*auc-1:.4f})")
print(f"test avg precision    {ap:.4f}      ({ap/y_test.mean():.2f}x the base rate)")
print(f"\\nmean predicted        {proba.mean():.4f}")
print(f"actual default rate   {y_test.mean():.4f}   <- no calibration wrapper applied")

cal = pd.DataFrame({"p": proba, "y": y_test.to_numpy()})
cal["decile"] = pd.qcut(cal["p"], 10, labels=False, duplicates="drop") + 1
display(cal.groupby("decile").agg(predicted=("p", "mean"), actual=("y", "mean"),
                                  n=("y", "size")).round(4))
'''))

    cells.append(md("""
## 3.5 Pick the cutoff

The API needs two more things besides the weights, and both have a catch.

**The threshold comes from out-of-fold predictions, not the test set.** Where to draw the
line is a decision, and taking it from the test split would turn the held-out set into a
tuning set.

**The percentile reference is built from form-only scores.** The site tells an applicant
they are riskier than N% of people. A preapproval form has no credit history, so most of
the 693 features arrive missing. Scoring the reference population the same way is what
makes that number mean anything. Compare a form-only score against a full-history
distribution and it is off by as much as 17 points.
"""))
    cells.append(code('''
from sklearn.metrics import precision_recall_curve

# Best F1 point on the out-of-fold predictions from the cross-validated run.
oof = np.load(f"{RESULTS}/oof_{RUN}.npy")
prec, rec, thr = precision_recall_curve(y_train, oof)
f1 = 2 * prec * rec / (prec + rec + 1e-12)
threshold = float(thr[int(f1[:-1].argmax())])
print(f"threshold {threshold:.4f}  (F1 {f1[:-1].max():.3f}, from out-of-fold predictions)")

# Score the held-out set the way the form scores, to compare applicants against.
AUX = ("BURO_", "BB_", "PREV_", "POS_", "INS_", "CC_", "INSL_", "COH_")
aux_cols = [c for c in X_test.columns if c.startswith(AUX)]
X_formonly = X_test.copy()
X_formonly[aux_cols] = np.nan
form_scores = model.predict_proba(X_formonly)[:, 1]
del X_formonly

print(f"form-only AUC {roc_auc_score(y_test, form_scores):.4f} "
      f"vs {auc:.4f} with full history  <- what the tool actually delivers")
print(f"  median {np.median(form_scores):.4f} vs {np.median(proba):.4f} with history")
'''))

    cells.append(md("## 3.6 Save the model"))
    cells.append(code('''
import joblib

NAME = "lightgbm_tuned_v2"
os.makedirs(MODELS, exist_ok=True)

joblib.dump(model, f"{MODELS}/{NAME}.joblib")

with open(f"{MODELS}/{NAME}_threshold.json", "w") as f:
    json.dump({"threshold": threshold, "source": "out-of-fold F1-optimal"}, f, indent=2)

with open(f"{MODELS}/{NAME}_percentiles.json", "w") as f:
    json.dump({"percentile_edges": [float(x) for x in np.percentile(form_scores, np.arange(1, 100))],
               "reference": "held-out test set scored form-only (auxiliary aggregates missing)",
               "n": int(len(form_scores))}, f)

# The API builds its frame from form fields, so it needs the exact column order and
# category levels. LightGBM matches categoricals by integer code, so a different order
# would quietly map "Married" onto whatever level took that slot.
with open(f"{MODELS}/{NAME}_schema.json", "w") as f:
    json.dump({"features": list(X_train.columns),
               "categoricals": {c: [str(v) for v in X_train[c].cat.categories]
                                for c in X_train.select_dtypes(include=["category"]).columns},
               "test_auc": float(auc), "test_avg_precision": float(ap),
               "n_estimators": n_trees}, f, indent=2)

# Feeds the "where this application falls" chart on the site.
CAP, BINS = 0.30, 30
counts, edges = np.histogram(np.clip(form_scores, 0, CAP), bins=BINS, range=(0, CAP))
with open(f"{RESULTS}/risk_distribution.json", "w") as f:
    json.dump({"counts": [int(c) for c in counts], "edges": [float(e) for e in edges],
               "cap": CAP, "n": int(len(form_scores)),
               "median": float(np.median(form_scores)),
               "share_in_range": float((form_scores < CAP).mean()),
               "tail_n": int((form_scores >= CAP).sum())}, f, indent=1)

for suffix in ("", "_threshold.json", "_percentiles.json", "_schema.json"):
    p = f"{MODELS}/{NAME}{suffix or '.joblib'}"
    print(f"  saved {p}  ({os.path.getsize(p)/1e6:.1f} MB)")
print(f"  saved {RESULTS}/risk_distribution.json")
'''))

    cells.append(md("""
## 3.7 Export the cohort tables

Eighty of the features compare an applicant to their own cohort, like a labourer's income
against other labourers'. Working that out needs a whole population, and the API only has
one applicant. Without help those features arrive missing and the deployed model drops
from 0.760 to 0.744 AUC.

Saving the group means and standard deviations lets the service rebuild them for a single
row. They come from the same training rows and the same function used at training time, so
a served value matches what the model learned on.
"""))
    cells.append(code('''
from sklearn.model_selection import train_test_split
from extra_features import COHORTS, COHORT_NUMERICS, export_cohort_tables

need = ["SK_ID_CURR", "TARGET"] + sorted({c for k in COHORTS for c in k} | set(COHORT_NUMERICS))
coh_src = pd.read_parquet(f"{CACHE}/features_full.parquet", columns=need)

# Same split the models use. train_test_split stratifies on y alone, so the same seed and
# the same y reproduce it whatever columns are loaded here.
tr_idx, _ = train_test_split(coh_src.index, test_size=0.2, random_state=42,
                             stratify=coh_src["TARGET"])
export_cohort_tables(coh_src, coh_src.index.isin(tr_idx), f"{MODELS}/{NAME}_cohorts.json")
del coh_src
'''))

    cells.append(md("""
> **Restart the API after running this.** It loads the model, threshold and percentile
> reference once at startup and never checks again, so a running server keeps serving the
> old files until you restart it:
>
> ```bash
> uvicorn api.main:app --port 8000
> streamlit run site.py
> ```
"""))

    cells.append(md(PART3_END))
    return cells


# ==================================================================================
def replace_block(nb, cells, start, end, label):
    src = ["".join(c["source"]) for c in nb["cells"]]
    if start in src and end in src:
        a, b = src.index(start), src.index(end)
        nb["cells"] = nb["cells"][:a] + cells + nb["cells"][b + 1:]
        print(f"  replaced {label} ({b - a + 1} cells -> {len(cells)})")
    else:
        nb["cells"].extend(cells)
        print(f"  appended {label} ({len(cells)} cells)")
    return nb


def main():
    path = NB if os.path.exists(NB) else NB_LEGACY
    with open(path) as f:
        nb = json.load(f)

    nb = replace_block(nb, build_cells(), PART3_START, PART3_END, "Part 3")

    with open(path, "w") as f:
        json.dump(nb, f, indent=1)
    print(f"wrote {os.path.basename(path)} -> {len(nb['cells'])} cells "
          f"({os.path.getsize(path)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
