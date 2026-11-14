# Home Credit Default Risk: honors research project

Sam Strickler. Predicting whether a consumer loan applicant will miss an early payment,
and serving that prediction through an interactive preapproval site.

**Result: 0.7976 test AUC**, up from 0.7786 in the original notebook. The target was 0.80
and it wasn't reached. The shortfall of 0.0024 is smaller than the test set's own standard
error of 0.0039, so the two can't be told apart on this data, but the honest figure to
report is still 0.7976.

That model reads the applicant's whole credit history. **The preapproval site serves a
different one**: trained only on what a form can ask, and without sex or marital status,
which US lenders may not use. It scores 0.7669 test AUC on form answers, where the
full-history model managed 0.749 (02_research.ipynb, section 3). That assumes the applicant
enters bureau scores. With those left blank it scores 0.668 (03_train.ipynb, section 7).

## Running it

Two processes, so two terminal tabs.

```bash
# tab 1: the backend, at localhost:8000
cd backend
conda activate honorsproject          # or: pip install -r requirements.txt
cp .env.example .env                  # once; add OPENAI_API_KEY for the research guide
uvicorn app.main:app --reload --port 8000

# tab 2: the frontend, at localhost:5173
cd frontend
npm install                           # once
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the backend. Without an
`OPENAI_API_KEY` the preapproval tool and findings still work and the guide page says
what's missing.

The form takes amounts in US dollars and converts them to the dataset's own units before
scoring. The dataset's currency is anonymised, so the rate is a calibration constant, set
so the median applicant's income maps onto $4,300 a month rather than being a real exchange
rate. The site states this where amounts are entered.

### Deploying

The root `Dockerfile` builds the frontend, then runs the backend, which serves both the API
and the built site on one port. `render.yaml` deploys it to Render as a free web service:
New → Blueprint → pick this repo, and set `OPENAI_API_KEY` when asked. Pushing to `main`
redeploys.

### The iPhone app (`ios/`)

A native SwiftUI front end for the same backend: the preapproval form with a live estimate,
the full result (risk meter, policy reasons, the factors that moved the score), the research
guide chat, and a Server tab. It holds no model or API key of its own; everything is scored
on the backend, so it always matches the website. It uses Liquid Glass on iOS 26 and later,
and a frosted fallback on iOS 17-25.

1. Open `ios/Preapproval.xcodeproj` in Xcode.
2. Pick an iPhone simulator (or your phone) in the toolbar and press Run (⌘R).

It talks to the deployed site, `https://preapproval.onrender.com`, by default, so nothing else
needs to be running. Render's free plan sleeps when idle, so the first score after a quiet
spell can take up to a minute (the app says "Waking the server"); after that it's about 2 s.

To use your local backend instead, start it as in tab 1 above, then in the app's **Server**
tab pick **This Mac** (`localhost:8000`, about 0.1 s a score). That works in the simulator.
A real iPhone can't see your Mac's `localhost`: choose **Custom** and enter your Mac's Wi-Fi
address with port 8000, e.g. `http://192.168.1.20:8000`, and start uvicorn with
`--host 0.0.0.0` so it accepts connections from the network.

The form's limits, presets and dollar conversion mirror `frontend/src/lib/constants.js` and
`application.js`; if those change, update `ios/Preapproval/Application.swift` to match. The
app icon is drawn by `ios/Tools/RenderAppIcon/main.swift` (instructions at the top of it).

## What's here

```
frontend/                 React + Vite + Tailwind site (no secrets, no model logic)
  src/pages/                        Findings, Preapproval, Guide, About
  public/data/                      precomputed JSON for the charts, written by the notebooks

ios/                      native iPhone app (SwiftUI) for the same API; see "The iPhone app" above
backend/                  one FastAPI app: the API, and the built site in production
  app/main.py                       routes: /api/predict, /api/chat/stream, /api/health
  app/model/                        scores an application and explains the score
  app/guide/                        the research-guide chatbot (retrieval over the project write-up)
    db/chroma/                        the vector index, built by ingest.py
  requirements.txt

modeling/                 the model and everything that produces it
  01_eda.ipynb                      the data, and the numbers on the findings page
  02_research.ipynb                 first models, and what actually improved them
  03_train.ipynb                    search, train, evaluate, save the weights
  features.py                       feature engineering, shared by 03_train and the backend
  models/                           the served model and its four sidecar files
  results/                          saved experiment results the notebooks read
  cache/                            built feature matrices (not in git, rebuilt by 03_train)

data/                     the raw Kaggle competition files (10 CSVs, 2.5 GB, not in git)
documents/                local only, not in git
  rag/                              extra notes the research guide indexes, beside paper/main.pdf
  other/                            personal paperwork, unrelated to the site
Dockerfile, render.yaml   deployment
```

The backend reads the served model from `modeling/models/` and imports
`modeling/features.py`, so serving and training share one definition of every feature.

## The research guide (`backend/app/guide/`)

A retrieval-augmented chatbot that answers from the project's own artefacts and cites
which one each claim came from: the notebook's markdown, the ablation results, feature
importances, the served model's settings, module docstrings, and anything in `documents/rag/` (.pdf, .md, .txt).

Rebuild the index after the write-up changes or a document lands in `documents/rag/`:

```bash
cd backend
python -m app.guide.ingest      # wipes and rebuilds db/chroma/
python -m app.guide.chat        # a terminal session, for testing
```

Design choices: follow-up questions are condensed into standalone ones before retrieval;
the model is told to refuse rather than guess; it is told to be plain about the negative
results; Chroma uses cosine distance to match OpenAI embeddings.

## The About page

Everything personal on `/about` lives in one `PROFILE` object at the top of
`frontend/src/pages/AboutPage.jsx`. The photo is `frontend/public/me.jpg`.

## The notebooks

Three, in `modeling/`, run in order.

1. **`01_eda.ipynb`: exploring the data.** What the applications look like, the five
   auxiliary tables aggregated to one row per applicant, and the numbers on the site's
   findings page (written straight to `frontend/public/data/`).
2. **`02_research.ipynb`: the models.** The first models (logistic regression, XGBoost,
   LightGBM, CatBoost and an MLP, with Optuna, SHAP, threshold tuning and calibration;
   0.7786), then the controlled study of what actually improved them (0.7976), then
   fairness and what a form can see (section 3). The study's cells load saved results from
   `results/`, since running those experiments end to end is hours of fitting; each has a
   flag to rerun it.
3. **`03_train.ipynb`: the model the site uses.** Form-only features without sex or
   marital status, a constraint so better bureau scores can only lower the predicted risk,
   cross-validation, hyperparameter search, training, evaluation, a check of approval rates
   by group, and the saved weights, top to bottom. A few minutes on an M5
   MacBook Pro. The search is switched off by default and reuses the setting saved in
   `results/best_params.json`; set `RUN_SEARCH = True` to rerun it (about an hour). This is
   the only place in the project that writes a model file: run it, restart the backend, and
   the site serves the new model.

All of the analysis and modelling happens in these notebooks. `features.py` is the one
piece of code outside them, because the site's backend has to compute the same features the
model was trained on; everything else outside `modeling/` is the website.

## What the project found

About 88% of the improvement came from two changes: fixing a bug where early stopping cut
training off at a quarter of the trees the model needed (+0.0080), and building better
features (+0.0110). That is +0.0190 of the +0.0217 total. Hyperparameter search, cohort
features and ensembling added 0.0017 between them while using most of the compute, and
seed-bagging came out slightly negative.

The rest of what came out of it:

- Feature count saturates around 300. Going from 300 to 1,480 features moved CV AUC less
  than the fold-to-fold noise did.
- `scale_pos_weight` bought no AUC, and it was the only reason the first models needed isotonic
  regression to fix its calibration. Dropping it removes the wrapper too.
- Ensembling saturated around 0.7976. Correlated members, a stronger second member and
  seed-bagging each failed for their own reason, and a single tuned LightGBM lands within
  0.0003 of the best blend.
- The full-history model can't be served honestly. Fed only what a preapproval form
  supplies, it scores 0.749 (an earlier estimate of 0.760 left in application fields no
  form asks for) and predicts a 9.8% average risk against a real 8.1%. Trained on the form's
  fields alone, a model scores 0.7669 and is calibrated, so that is what the site serves.
- Sex and marital status aren't needed. Leaving them out cost 0.002 AUC, half the test
  set's standard error. It doesn't erase group differences in outcomes: men are still
  approved somewhat less often, through features that carry some of the same signal.

## Notes on the data

The full evidence for these is in `documents/rag/data-notes.md`.

These are consumer loans, not mortgages. "Home Credit" is the lender's name. The products
are point-of-sale credit, small cash loans and revolving credit, with a median term of 12
months.

`AMT_INCOME_TOTAL` is monthly income and `AMT_ANNUITY` is a monthly payment. Neither is
documented, but the arithmetic settles it. Amounts are in an anonymised currency unit,
which the model is invariant to.

`TARGET` records a payment more than a few days late on one of the first instalments: an
early missed payment, not a written-off loan. It happened to 8.07% of applicants.
