"""
Build the knowledge corpus the guide answers from.

Retrieval quality is decided here rather than in the prompt. Embedding a pile of raw
files gives you chunks that are half base64 image data and half boilerplate, and the
retriever then returns confident nonsense. So every source is turned into prose with
section headings and metadata first, and anything that isn't text a person would read is
dropped before it reaches the splitter.

Sources, roughly in order of how often they answer a question:

  1. Markdown cells from `home_credit_default_risk.ipynb` -- the written narrative of all
     three parts, already prose and already sectioned by heading.
  2. `utilities/results/*.json|csv` -- the numbers, rendered as readable tables rather
     than raw JSON, so a retrieved chunk reads like a results section.
  3. Module docstrings from `utilities/*.py` and `api/*.py` -- these carry the reasoning
     behind each decision, which is most of what the guide gets asked about.
  4. A hand-written project overview -- the framing no single file states outright.
  5. Anything dropped in `Chatbot/docs/` (.pdf, .md, .txt), which is where the research
     paper goes once it exists. Nothing else needs to change to pick it up.
"""

from __future__ import annotations

import ast
import json
import os
import re

from langchain_core.documents import Document

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
MODELING = os.path.join(ROOT, "Modeling")
UTILS = os.path.join(MODELING, "utilities")
RESULTS = os.path.join(UTILS, "results")
DOCS = os.path.join(HERE, "docs")


# ----------------------------------------------------------------------------------
def project_overview() -> list[Document]:
    """The framing no single file states outright.

    Deliberately several short documents rather than one long one. A 2,400-character
    overview gets cut in half by the splitter, so a broad question like "what is this
    project" retrieves half the framing plus whatever else scored nearby -- which is how
    a general question ends up answered with feature-engineering detail. Each piece below
    stands on its own and stays under the chunk size, so it is retrieved whole.
    """
    parts = [
        ("What this project is", """
This is an undergraduate honors research project by Sam Strickler on the Home Credit
Default Risk dataset from Kaggle.

It does two things: builds a model that predicts whether a loan applicant will fail to
repay, and serves that prediction through a preapproval tool someone can actually use.

The work has three parts. Part 1 is the original modelling notebook, which reached 0.7786
test AUC. Part 2 re-runs the problem as a controlled ablation and reaches 0.7976. Part 3
is the runnable build that produces the deployed model, which a FastAPI service and a
Streamlit site use to score an application, explain it, and place it against the
population of real applicants.

The main finding is not the score. Two changes account for about 88% of the improvement,
fixing a bug in early stopping and building better features, while hyperparameter search,
cohort features and ensembling contributed 0.0017 between them despite using most of the
compute. Seed-bagging came out slightly negative.
"""),
        ("What kind of loans these are", """
"Home Credit" is the lender's name, not the product. Home Credit is a consumer finance
company founded in 1997 (part of PPF Group), operating across Central/Eastern Europe and
Asia. These are not mortgages or home loans. Its three products are point-of-sale loans,
multipurpose cash loans, and revolving credit, and the data bears that out.

Contract types in `application_train` are Cash loans 90.5% and Revolving loans 9.5%; there
is no mortgage category. The largest product portfolio in `previous_application` is POS
(point-of-sale) at 41.4%. What was financed: mobile phones 13.5%, consumer electronics
7.3%, computers 6.3%, audio/video 6.0%, furniture 3.2%. The originating retailers are
consumer electronics shops (23.8%) and phone shops (16.5%). Cash loans are for repairs
(34.1%), urgent needs (12.1%), a used car (4.1%), medicine (3.1%).

The median loan term is 12 months: 36 at the 90th percentile, 84 at the longest. A
mortgage runs 180-360 months.

Home Credit's business targets customers with thin or no credit files, which is why the
dataset ships three external bureau scores and five tables of alternative history. That
population is also where the model is weakest: on the 14.2% of test clients with no bureau
record at all it scores 0.780 AUC, against 0.799 on clients who have a record, even though
the thin-file group defaults more often (10.2% vs 8.1%). The people this lender exists to
serve are the ones it predicts least well.
"""),
        ("What TARGET actually means", """
The dataset defines the target as: "client with payment difficulties: he/she had late
payment more than X days on at least one of the first Y installments of the loan in our
sample".

So "default" throughout this project means an early missed payment, not that the loan was
written off or charged off. That is a lower bar than the everyday sense of the word. The
positive rate is 8.07%, or 24,825 of 307,511 applicants.

Home Credit redacted the X and Y, but the payment data narrows X down. Across the 13.6
million scheduled payments on prior loans, 68.4% arrive early and 23.1% on the due date;
only 8.4% are late at all, and most of that is 1 to 5 days. Fewer than 0.2% of first
installments are more than 30 days late, far too few to produce an 8.07% target rate, so X
is a matter of days rather than months.

Most clients with TARGET = 1 repay in full. Someone ten days late on their second
installment who then clears the whole balance counts as a 1. The model is therefore an
early warning model, not a loss model: nothing in the dataset supports an estimate of
money lost.
"""),
        ("The dataset", """
307,511 historical loan applications in `application_train.csv`, plus five auxiliary
tables describing each client's credit history: `bureau.csv` and `bureau_balance.csv`
(loans held at other institutions), `previous_application.csv` (prior applications to
Home Credit), `POS_CASH_balance.csv`, `installments_payments.csv`, and
`credit_card_balance.csv`. About 2.5 GB of CSV in total.

The default rate is 8.07%, so the problem is heavily imbalanced: a model that predicts
"will repay" for everyone is right 92% of the time and useless.

`AMT_INCOME_TOTAL` is monthly income, and `AMT_ANNUITY` is a monthly payment.
Neither is documented, but the arithmetic settles both. Annuity times the payment count
comes to about 1.26x the principal, which only works if the annuity is per-month. And the
median annuity of 24,903 against a median income of 146,997 is 16.9% of income if income
is monthly, versus an impossible 203% of monthly income if it is annual. So the median
applicant borrows about 3.3 months of income over roughly 20 payments: ordinary
consumer credit, not the enormous loan the raw figure suggests.

Monetary amounts are in an anonymised currency unit. `bureau.csv` carries a
CREDIT_CURRENCY column whose values are literally "currency 1" through "currency 4", and
no file names a real currency.

The names were withheld, not the values converted. Currency 1 covers 99.918% of the 1.7
million prior loans with a median amount of 125,224, while currency 2 covers 0.071% with a
median of 2,595,258, about 21 times larger. Had everything been normalised onto a common
unit those medians would be comparable. This also shows the dataset is one market in one
currency rather than consumers pooled from several economies: `bureau.csv` is the only
table with a currency column at all, and no table names a country. That matters for the
cohort features, which compare an applicant's income against their cohort's average.

The unit does not affect the model: gradient-boosted trees split on comparisons, so
rescaling every amount by a constant produces the same tree, and the strongest engineered
features are dimensionless ratios in which the unit cancels.
"""),
        ("Headline results", """
| stage | test AUC |
|---|---|
| Part 1, best model (CatBoost) | 0.7786 |
| Part 2, final blend | 0.7976 |

The stated target was 0.80 and it was not reached. The shortfall of 0.0024 is smaller
than the test set's own standard error of 0.0039, so 0.7976 and 0.800 can't be told apart
on this data. The honest figure to report is still 0.7976.

Where the gain came from, as test-AUC deltas against the best rung so far: better
features (+0.0110), fixing early stopping (+0.0080), letting LightGBM handle missing
values natively (+0.0010), hyperparameter search (+0.0009), cohort features (+0.0005),
and ensembling (+0.0003). Those sum to +0.0217, the whole gain from the Part 1
reproduction to the final blend.
"""),
    ]
    return [Document(page_content=f"# {title}\n{body.strip()}",
                     metadata={"source": "project overview", "kind": "overview",
                               "section": title})
            for title, body in parts]


# ----------------------------------------------------------------------------------
def notebook_sections(path: str) -> list[Document]:
    """Markdown cells from the notebook, grouped under their nearest heading.

    Headings are detected line-by-line rather than only at the start of a cell. A cell
    that opens with a `---` rule or a paragraph before its heading is common, and
    matching only at position 0 files that whole cell under the previous
    heading -- which mislabels the chunk and makes the citation point at the wrong
    section. That is worse than no citation, so the scan looks at every line.

    Code cells and outputs are skipped: outputs are mostly base64 PNGs and progress
    bars, which would dominate the corpus by volume while answering nothing.
    """
    if not os.path.exists(path):
        return []
    with open(path) as f:
        nb = json.load(f)

    docs, heading, buf = [], "Introduction", []

    def flush():
        body = "\n\n".join(buf).strip()
        # Drop rules and stray whitespace left behind after splitting on headings.
        body = re.sub(r"^\s*---\s*$", "", body, flags=re.M).strip()
        if len(body) > 120:                     # skip one-line transition cells
            docs.append(Document(
                page_content=f"# {heading}\n\n{body}",
                metadata={"source": os.path.basename(path), "kind": "notebook",
                          "section": heading},
            ))

    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "markdown":
            continue
        src = "".join(cell.get("source", "")).strip()
        # Strip the HTML comments used as section sentinels, then skip the cell only if
        # nothing is left. Testing `startswith("<!--")` instead would drop any cell that
        # opens with a marker but carries real content after it.
        src = re.sub(r"^\s*(<!--.*?-->\s*)+", "", src, flags=re.S).strip()
        if not src:
            continue
        for line in src.split("\n"):
            m = re.match(r"^(#{1,3})\s+(.+)", line)
            if m:
                flush()
                heading, buf = m.group(2).strip(), []
            else:
                buf.append(line)
    flush()
    return docs


# ----------------------------------------------------------------------------------
def ablation_results() -> list[Document]:
    """Render the stored metrics as a results section rather than raw JSON."""
    path = os.path.join(RESULTS, "ablation.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        res = json.load(f)

    labels = {
        "B0_notebook_reproduction": "Part 1 pipeline, reproduced exactly",
        "A1_native_nan": "dropped median imputation and StandardScaler; LightGBM routes NaN natively",
        "A2_native_categorical": "native categorical splits instead of one-hot encoding",
        "A3_early_stopping": "sized n_estimators by early stopping instead of a fixed 362",
        "A4_full_features": "full engineered feature set, 1,480 features",
        "A4k300_top300_features": "top 300 features by gain",
        "A4k600_top600_features": "top 600 features by gain",
        "A5_no_reweight": "removed scale_pos_weight entirely",
        "A6_cohort_features": "added cohort z-scores and per-prior-loan installment statistics",
        "A7_trial26_bestCV": "Optuna search at full data size, scored on AUC",
        "A8xgb_tuned_rank1": "XGBoost, tuned with Optuna",
        "ENS_xgb": "XGBoost with hand-picked parameters",
        "ENS_cat": "CatBoost with hand-picked parameters",
        "A9bag_BAG": "four-seed bag of the tuned LightGBM",
        "thinfile_app_only": "model trained only on the 98 application-level features",
    }

    lines = ["# Ablation ladder: measured results",
             "",
             "Every row is 5-fold cross-validated inside the 80% training split. The held-out",
             "test set (61,502 rows, 4,965 defaults) is read once per configuration. Its AUC",
             "standard error is 0.0039, so test differences below roughly 0.008 are not",
             "resolvable and all decisions were made on cross-validation.",
             "",
             "| run | what changed | CV AUC | test AUC | mean trees |",
             "|---|---|---|---|---|"]
    for k, v in sorted(res.items(), key=lambda kv: kv[1].get("cv_auc") or 0):
        cv = v.get("cv_auc")
        if cv is None or cv != cv:
            continue
        it = v.get("best_iters") or []
        trees = str(int(sum(it) / len(it))) if it else "n/a"
        lines.append(f"| {k} | {labels.get(k, '')} | {cv:.5f} | {v['test_auc']:.5f} | {trees} |")

    blend = os.path.join(RESULTS, "blend_existing.json")
    if os.path.exists(blend):
        b = json.load(open(blend))
        lines += ["", f"Final rank-averaged blend: out-of-fold AUC {b['oof_auc']:.5f}, "
                      f"test AUC {b['test_auc']:.5f}.",
                  f"Best single model was {b['best_single']} at test AUC "
                  f"{b['best_single_test']:.5f}, so the blend was worth only "
                  f"{b['test_auc'] - b['best_single_test']:+.5f}."]

    return [Document(page_content="\n".join(lines),
                     metadata={"source": "utilities/results/ablation.json", "kind": "results",
                               "section": "Ablation ladder: measured results"})]


def feature_importances(top_n: int = 40) -> list[Document]:
    path = os.path.join(RESULTS, "importances.csv")
    if not os.path.exists(path):
        return []
    import csv

    with open(path) as f:
        rows = list(csv.DictReader(f))[:top_n]
    lines = ["# Most important features in the final model",
             "",
             "Ranked by mean gain across the five fold models. Of 1,480 features, 161 were",
             "never split on by any fold model.",
             "",
             "| rank | feature | gain |", "|---|---|---|"]
    for i, r in enumerate(rows, 1):
        lines.append(f"| {i} | {r['feature']} | {float(r['gain']):,.0f} |")
    lines += ["",
              "EXT_SOURCES_MEAN -- the average of the three external credit bureau scores --",
              "is the single most important feature by a factor of two over anything else. The",
              "three raw EXT_SOURCE columns individually rank well below their own summary",
              "statistics: averaging three noisy, partially-missing scores produces a cleaner",
              "signal than any one of them."]
    return [Document(page_content="\n".join(lines),
                     metadata={"source": "utilities/results/importances.csv", "kind": "results",
                               "section": "Most important features in the final model"})]


# ----------------------------------------------------------------------------------
def deployment_notes() -> list[Document]:
    """What the served system actually does.

    Added after a test question ("what threshold does the API use?") came back unanswered:
    the value lives in a model artefact and in function-level comments, neither of which
    the corpus reached. Read from the saved JSON so the figures cannot drift away from
    what is actually deployed.
    """
    models = os.path.join(MODELING, "models")
    schema_p = os.path.join(models, "lightgbm_tuned_v2_schema.json")
    thresh_p = os.path.join(models, "lightgbm_tuned_v2_threshold.json")
    if not (os.path.exists(schema_p) and os.path.exists(thresh_p)):
        return []
    schema = json.load(open(schema_p))
    thresh = json.load(open(thresh_p))

    text = f"""
# The deployed system

The API (`api/main.py`, FastAPI) serves **{os.path.basename(schema_p).replace('_schema.json','')}**:
a LightGBM model over {len(schema['features'])} features, test AUC
{schema.get('test_auc', float('nan')):.4f} and average precision
{schema.get('test_avg_precision', float('nan')):.4f}, fitted with
{schema.get('n_estimators', 0):,} trees on the full training split.

## The decision threshold

The cutoff is **{thresh['threshold']:.4f}** -- above it an application is declined, below it
preapproved. It is the F1-optimal point computed on **out-of-fold predictions**, not on
the test set: a deployment threshold is a decision, and the test split had already been
spent on reporting. Using the test set to pick it would quietly turn the held-out set
into a tuning set. The default 0.5 that Part 1 started with is arbitrary at an 8.07% base
rate.

## No calibration wrapper

Part 1 needed `CalibratedClassifierCV` with isotonic regression because `scale_pos_weight`
inflated raw probabilities roughly threefold. The ablation showed that reweighting bought
no AUC at all -- it only distorted the probability scale -- so the tuned configuration
drops it. Mean predicted probability is 7.95% against a true base rate of 8.07%, straight
out of the model, with nothing applied afterwards.

## What the API can and cannot see

The model was trained on application data joined to aggregates of each client's credit
history. A prospective applicant has no such history to join, so about 600 of the 693
features arrive missing. LightGBM routes missing values natively and saw plenty of them in
training, but the measured cost is real:

| scenario | test AUC |
|---|---|
| everything available, as trained | 0.79695 |
| auxiliary aggregates blanked, which is what the API sees today | 0.75989 |
| aggregates and cohort features both blanked | 0.74399 |

The 693 features split into 98 application-level, 515 auxiliary-table and 80 cohort. The
API rebuilds the 80 cohort features from lookup tables exported alongside the model, which
lifts the deployed figure from 0.744 to 0.760. The credit-history aggregates stay missing,
since no lookup can supply a history the applicant has not got.

Asking the applicant to self-report that history was measured too, and it does not pay.
Revealing the three most important history features buys +0.0076, fifteen of them +0.0154,
and it takes 100 before the score reaches 0.791. Only 4 of the top 25 aggregates are
things a person could answer at all; the rest are statistical summaries over loan-level
records nobody can report from memory.

The model is also weakest exactly where the lender operates. On the 8,755 test clients
with no bureau record (14.2%) it scores 0.780, against 0.799 on clients who have one,
while that group defaults more often (10.2% vs 8.1%).

## The form

The form collects amounts in US dollars and converts them before scoring. The dataset's
currency is anonymised, so there is no exchange rate to look up; the constant is set so the
dataset's median applicant income (147,150 a month) maps onto $4,300 a month, which places
someone entering dollars where an equivalent Home Credit applicant sits in the population.
It is a calibration constant, not an exchange rate, and the page says so. The conversion is
necessary because 80 of the model's features compare an applicant's income against their
cohort's average, which only means anything if the applicant is on the same scale as the
training data. The exact anchor is not load-bearing: moving it from $3,000 to $6,670 a month
shifts a typical applicant by 0.26 percentage points. Entering dollars unconverted, off by a
factor of 34, shifts them by 2.2 points. Income is asked for as gross, monthly, before tax;
the dataset states neither, and entering net instead moves a typical result by about 0.2
percentage points.

Living situation, contract type, car ownership and realty ownership were removed from the
form after a sensitivity sweep (`utilities/api_limits.py`) showed each changed none of
the model's inputs. The strongest levers are the three external bureau scores, worth up to
5.0, 4.4 and 3.3 percentage points of predicted risk on their own, then the monthly payment
(2.8), family status (2.6), the amount borrowed (1.9) and the price of the item financed
(1.5). Stated income moves the prediction by only 0.22 percentage points: what matters is
the loan relative to income, not its absolute size.
"""
    return [Document(page_content=text.strip(),
                     metadata={"source": "api/main.py + model artefacts",
                               "kind": "deployment", "section": "The deployed system"})]


# ----------------------------------------------------------------------------------
def module_docstrings() -> list[Document]:
    """Module-level docstrings from the pipeline and the API.

    These carry the reasoning behind each methodological choice -- which is what a guide
    gets asked about far more often than the code itself.
    """
    docs = []
    targets = [(UTILS, "utilities"), (os.path.join(MODELING, "api"), "api")]
    for folder, label in targets:
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            if not fn.endswith(".py") or fn.startswith("_"):
                continue
            path = os.path.join(folder, fn)
            try:
                mod = ast.parse(open(path).read())
            except SyntaxError:
                continue
            doc = ast.get_docstring(mod)
            if not doc or len(doc) < 150:
                continue
            docs.append(Document(
                page_content=f"# {label}/{fn}\n\n{doc.strip()}",
                metadata={"source": f"{label}/{fn}", "kind": "code-doc",
                          "section": f"{label}/{fn}"},
            ))
    return docs


# ----------------------------------------------------------------------------------
def dropped_in_docs() -> list[Document]:
    """Whatever the user puts in Chatbot/docs/ -- the research paper's future home."""
    if not os.path.isdir(DOCS):
        return []
    out = []
    for fn in sorted(os.listdir(DOCS)):
        path = os.path.join(DOCS, fn)
        if fn.startswith("."):
            continue
        try:
            if fn.lower().endswith(".pdf"):
                from langchain_community.document_loaders import PyPDFLoader
                pages = PyPDFLoader(path).load()
                for p in pages:
                    p.metadata.update(source=fn, kind="paper",
                                      section=f"{fn} p.{p.metadata.get('page', 0) + 1}")
                out.extend(pages)
            elif fn.lower().endswith((".txt", ".md")):
                out.append(Document(page_content=open(path).read(),
                                    metadata={"source": fn, "kind": "paper", "section": fn}))
        except Exception as e:  # a malformed drop-in should not kill the whole ingest
            print(f"  ! could not read {fn}: {type(e).__name__}: {e}")
    return out


# ----------------------------------------------------------------------------------
def build_corpus(verbose: bool = True) -> list[Document]:
    groups = {
        "overview": project_overview(),
        "notebook": notebook_sections(os.path.join(MODELING, "home_credit_default_risk.ipynb")),
        "ablation results": ablation_results(),
        "feature importances": feature_importances(),
        "deployment": deployment_notes(),
        "module docstrings": module_docstrings(),
        "docs/ drop-ins": dropped_in_docs(),
    }
    docs = []
    for name, group in groups.items():
        if verbose:
            chars = sum(len(d.page_content) for d in group)
            print(f"  {name:<20} {len(group):>3} docs  {chars:>7,} chars")
        docs.extend(group)
    return docs


if __name__ == "__main__":
    print("Corpus sources:")
    d = build_corpus()
    print(f"\ntotal: {len(d)} documents, {sum(len(x.page_content) for x in d):,} characters")
