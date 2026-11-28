# Home Credit Default Risk: honors research project

Sam Strickler. Predicting whether a consumer loan applicant will miss an early payment,
and serving that prediction through an interactive preapproval site.

The best model reached 0.7976 test AUC, up from 0.7802 with the first models. AUC is the
chance the model rates a random applicant who missed a payment as riskier than one who
didn't: 0.5 is a coin flip, 1.0 is perfect, and credit models usually land between 0.70 and
0.80. The target was 0.80, and it wasn't reached. The shortfall (0.0024) is smaller than the
test set's standard error (0.0039), so the two can't really be told apart, but 0.7976 is the
number to report.

That model sees the applicant's whole credit history. The preapproval site serves a
different one. It only uses what a form can ask, and it leaves out sex and marital status,
which US lenders may not discriminate on. On form answers it scores 0.7669, where the
full-history model managed 0.749 (02_research.ipynb, section 3). That is with the bureau
scores filled in, the three outside credit scores in the data (`EXT_SOURCE_1` to `_3`). With
them left blank it scores 0.706 (03_train.ipynb, section 7). It can still score a blank form
because it was trained with the scores hidden on 75% of its training rows.

## Running it

The quickest way is Docker. It builds the frontend and runs everything in one container:

```bash
cp backend/.env.example backend/.env     # once; add OPENAI_API_KEY for the research guide
docker compose up --build
```

Then open http://localhost:8000. The first build takes a few minutes; after that it starts
in seconds. Stop it with Ctrl+C, or `docker compose down`.

### For development

To edit the code with live reloading, run the backend and frontend separately, in two
terminal tabs.

```bash
# tab 1: the backend, at 127.0.0.1:8000
cd backend
conda activate honorsproject          # or: pip install -r requirements.txt
cp .env.example .env                  # once; add OPENAI_API_KEY for the research guide
uvicorn app.main:app --reload --port 8000

# tab 2: the frontend, at localhost:5173
cd frontend
npm install                           # once
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend. Without an
`OPENAI_API_KEY` the preapproval tool and findings still work and the guide page says
what's missing.

The form takes amounts in US dollars and converts them to the dataset's own units before
scoring. The dataset's currency is anonymized, so the rate is a calibration constant, set
so the median applicant's income maps onto $4,300 a month rather than being a real exchange
rate. The site states this where amounts are entered.

### Deploying

The root `Dockerfile` builds the frontend, then runs the backend, which serves both the API
and the built site on one port. `render.yaml` deploys it to Render as a free web service:
New → Blueprint → pick this repo, and set `OPENAI_API_KEY` when asked. Pushing to `main`
redeploys.

## What's here

```
frontend/                 React + Vite + Tailwind site (no secrets, no model logic)
  src/pages/                        Findings, Preapproval, Guide, About
  public/data/                      precomputed JSON for the charts, written by the notebooks

backend/                  one FastAPI app: the API, and the built site in production
  app/main.py                       routes: /api/predict, /api/chat/stream, /api/health
  app/model/                        scores an application and explains the score
  app/guide/                        the research-guide chatbot (retrieval over the project write-up)
    db/chroma/                        the vector index, built by ingest.py
  requirements.txt

modeling/                 the model and everything that produces it
  01_eda.ipynb                      the data, the numbers on the findings page, and the full research table
  02_research.ipynb                 first models, and what actually improved them
  03_train.ipynb                    search, train, evaluate, save the weights
  features.py                       the features a form can supply, shared by the notebooks and the backend
  requirements.txt                  the notebooks' packages, pinned
  figures/                          every chart the write-up uses, saved by the notebooks
  models/                           the served model, plus its cutoff, score percentiles, feature
                                    list and peer-group averages (one file each)
  results/                          saved experiment results the notebooks read
  cache/                            the research tables 01_eda builds (not in git)

data/                     the raw Kaggle competition files (10 CSVs, 2.5 GB, not in git)
documents/                local only, not in git
  rag/                              extra notes the research guide indexes
  sources/                          copies of the sources the paper cites
paper/                    the write-up (LaTeX), local only until it is submitted
Dockerfile, render.yaml   deployment (Render)
docker-compose.yml        the same container, run locally with one command
```

The backend reads the served model from `modeling/models/` and imports
`modeling/features.py`, so serving and training share one definition of every feature.

## The research guide (`backend/app/guide/`)

A chatbot that answers from the project's own material and says where each claim came
from. It searches the notebooks' text, the controlled study's results, the feature
importances, the served model's settings, the code's docstrings, and anything in
`documents/rag/` (.pdf, .md or .txt).

Rebuild the index after the write-up changes or a document lands in `documents/rag/`:

```bash
cd backend
python -m app.guide.ingest      # wipes and rebuilds db/chroma/
python -m app.guide.chat        # a terminal session, for testing
```

A few design choices. Follow-up questions are rewritten as standalone ones before the
search. Facts about the project come only from the retrieved passages, and the guide says
when they don't cover a question, though it may answer general questions about machine
learning and lending from what it knows. It is told to be plain about the negative results.

## The About page

Everything personal on `/about` lives in one `PROFILE` object at the top of
`frontend/src/pages/AboutPage.jsx`. The photo is `frontend/public/me.jpg`.

## The notebooks

Three, in `modeling/`, run in order. `modeling/requirements.txt` lists the packages they
need, at the versions the saved results came from.

1. `01_eda.ipynb` explores the data. It shows what the applications look like, sums up the
   six credit-history tables to one row per applicant, and writes the numbers for the
   site's findings page into `frontend/public/data/`. Section 6 then builds the full table
   the later models use, about 1,570 features, one history table at a time. That takes a
   minute or two, and the result is saved to `cache/`.
2. `02_research.ipynb` covers the models. First come logistic regression, XGBoost,
   LightGBM, CatBoost and a small neural network, tuned and compared (0.7802). Then the
   controlled study of what actually improved them (0.7976), and last, fairness and what a
   form can see (section 3). The study took hours to run, so its cells load saved results
   from `results/`. Every chart the paper uses is saved to `figures/` by the cell that
   draws it.
3. `03_train.ipynb` builds the model the site uses, top to bottom: form-only features
   without sex or marital status, a rule that better bureau scores can only lower the
   predicted risk, the search, training, evaluation, a check of approval rates by group, and
   the saved model. It runs in a few minutes on an M5 MacBook Pro. The hyperparameter search
   is off by default and reuses `results/best_params.json`; set `RUN_SEARCH = True` to run it
   again (about ten minutes). This is the only place that writes a model file: run it,
   restart the backend, and the site serves the new model.

All of the analysis and modeling happens in these notebooks. The only code outside them is
`features.py`, because the site's backend has to compute the same features the model was
trained on. Everything else outside `modeling/` is the website.

## What the project found

Two changes did about 88% of the work. One fixed a bug where early stopping ended training
at a quarter of the trees the model needed (+0.0080). The other built better features
(+0.0110). Together that is +0.0190 of the +0.0217 total. Hyperparameter search, peer-group
features and blending added only 0.0017 between them, while using most of the computing
time.

A few other things came out of it:

- About 300 features are enough. Going from 300 to 1,480 changed the cross-validated AUC by
  less than it varies from one fold to the next.
- Class weighting didn't help. The setting (`scale_pos_weight`) counts each missed payment
  as several, which added no AUC and made the first models' probabilities about three times
  too high. Dropping it also removed the calibration step that had been fixing them.
- Blending stopped helping at about 0.7976. All the models make much the same mistakes, so
  averaging them cancels little, and a single tuned LightGBM is within 0.0003 of the best
  blend.
- The full-history model can't be served as it is. Given only what a form supplies, it
  scores 0.749 and predicts a 9.8% average risk against a real 8.1%. (An earlier estimate
  of 0.760 had accidentally left in fields no form asks for.) A model trained on the form's
  fields alone scores 0.7669 and its probabilities are right, so that is what the site
  serves.
- Sex and marital status aren't needed. Leaving them out cost 0.002 AUC, about half the
  test set's standard error. It doesn't remove group differences, though: men are still
  approved somewhat less often, through other features that carry some of the same signal.

## Notes on the data

These are consumer loans, not mortgages. Home Credit is the lender's name. It sells
point-of-sale credit, small cash loans and revolving credit, and the median loan runs 12
months.

`AMT_INCOME_TOTAL` is monthly income and `AMT_ANNUITY` is a monthly payment. The dataset
doesn't say so, but the numbers only make sense that way. Amounts are in an unnamed
currency, which doesn't affect the model.

`TARGET` marks a payment more than a few days late on one of the first installments. It is an
early missed payment, not a written-off loan, and it happened to 8.07% of applicants.
