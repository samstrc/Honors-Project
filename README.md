# Home Credit Default Risk: honors research project

Sam Strickler. Predicting whether a consumer loan applicant will miss an early payment,
and serving that prediction through an interactive preapproval site.

**Result: 0.7976 test AUC**, up from 0.7786 in the original notebook. The target was 0.80
and it wasn't reached. The shortfall of 0.0024 is smaller than the test set's own standard
error of 0.0039, so the two can't be told apart on this data, but the honest figure to
report is still 0.7976.

## Running it

Two processes, so two terminal tabs.

```bash
# tab 1: the model service
cd "Modeling"
conda activate honorsproject
uvicorn api.main:app --port 8000

# tab 2: the website, at localhost:8501
cd "Streamlit Website"
conda activate honorsproject
streamlit run site.py
```

The site needs the API running. Without it, the form returns a connection error. Both
load saved files, so they start in seconds.

The form takes amounts in US dollars and converts them to the dataset's own units before
scoring. The dataset's currency is anonymised, so the rate is a calibration constant, set
so the median applicant's income maps onto $4,300 a month rather than being a real exchange
rate. The site states this where amounts are entered.

## What's here

```
Data/                     the raw Kaggle competition files (10 CSVs, 2.5 GB)
Documents/                proposal and paperwork

Modeling/                 the model and everything that produces it
  home_credit_default_risk.ipynb    THE notebook: analysis, findings, and the model build
  api/                              FastAPI service that serves the model
  models/                           the served model and its four sidecar files
    superseded/                       Part 1's six compared models, nothing loads them
  utilities/                         feature engineering and experiments (see below)
  ARCHIVED/                         superseded Lending Club work, nothing imports it

Streamlit Website/        the front end
  site.py                           entry point, run this
    streamlit_app.py                  page 1: the preapproval tool
    findings_page.py                  page 2: what the data says
    guide_page.py                     page 3: the research chatbot
  theme.py                          shared palette and chart styling

Chatbot/                  the retrieval engine behind page 3
  corpus.py ingest.py chat.py       build the index, then answer from it
  docs/                             drop the research paper here and re-run ingest.py

```

## The notebook

`Modeling/home_credit_default_risk.ipynb` is the centre of the project, in three parts.

**Part 1: Exploring the data and first models.** EDA, aggregating the five auxiliary
tables, and comparing logistic regression, XGBoost, LightGBM, CatBoost and an MLP, with
Optuna tuning, SHAP, calibration and threshold tuning. Reached 0.7786.

**Part 2: Finding what actually improved it.** The same problem rebuilt as a controlled
ablation, one change at a time, so every gain is attributable to something. These cells
report rather than recompute: they load saved results and render them, since running the
experiments end to end is about ten hours of fitting. Reached 0.7976.

**Part 3: Building the model the site uses.** The runnable build: raw CSV to saved
weights, top to bottom. It is the only place in the project that writes a model file.

## The utilities folder (`Modeling/utilities/`)

Eight files. Four are wired into the notebook or the API; the rest regenerate outputs
that other parts of the project read.

**Live, imported by the notebook or the API:**

| | |
|---|---|
| `build_features.py` | builds the features, 164 → 1,480. Also imported by the API, so serving and training share one definition |
| `evaluation.py` | the fixed train/test split and the 5-fold cross-validation protocol every experiment uses |
| `extra_features.py` | how an applicant compares to others like them, plus per-prior-loan statistics |
| `run_one.py` | runs one configuration through that protocol |
| `make_notebook_sections.py` | regenerates Part 3 of the notebook |

**Rerunnable checks. Not experiments; these regenerate live outputs:**

| | |
|---|---|
| `metrics.py` | Gini, KS, calibration and gains for the deployed model |
| `api_limits.py` | what the deployed model can and cannot see from a form |
| `site_findings.py` | rebuilds the numbers on the site's findings page |

The scripts that ran the Part 2 experiments were deleted once they had run. Their output
lives in `results/`, which is what the notebook reads.

| | |
|---|---|
| `results/` | the stored numbers each script produced |
| `cache/` | the built feature matrices (regenerate with `build_features.py`) |

## What the project found

About 88% of the improvement came from two changes: fixing a bug where early stopping cut
training off at a quarter of the trees the model needed (+0.0080), and building better
features (+0.0110). That is +0.0190 of the +0.0217 total. Hyperparameter search, cohort
features and ensembling added 0.0017 between them while using most of the compute, and
seed-bagging came out slightly negative.

The rest of what came out of it:

- Feature count saturates around 300. Going from 300 to 1,480 features moved CV AUC less
  than the fold-to-fold noise did.
- `scale_pos_weight` bought no AUC, and it was the only reason Part 1 needed isotonic
  regression to fix its calibration. Dropping it removes the wrapper too.
- Ensembling saturated around 0.7976. Correlated members, a stronger second member and
  seed-bagging each failed for their own reason, and a single tuned LightGBM lands within
  0.0003 of the best blend.
- The deployed tool runs near 0.760, not 0.797, because a preapproval form carries no
  credit history and about 600 of the 693 features arrive missing.

## Notes on the data

These are consumer loans, not mortgages. "Home Credit" is the lender's name. The products
are point-of-sale credit, small cash loans and revolving credit, with a median term of 12
months.

`AMT_INCOME_TOTAL` is monthly income and `AMT_ANNUITY` is a monthly payment. Neither is
documented, but the arithmetic settles it. Amounts are in an anonymised currency unit,
which the model is invariant to.

`TARGET` records a payment more than a few days late on one of the first instalments: an
early missed payment, not a written-off loan. It happened to 8.07% of applicants.
