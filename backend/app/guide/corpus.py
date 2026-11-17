"""
Build the knowledge corpus the guide answers from.

Retrieval quality is decided here rather than in the prompt. Embedding a pile of raw
files gives you chunks that are half base64 image data and half boilerplate, and the
retriever then returns confident nonsense. So every source is turned into prose with
section headings and metadata first, and anything that isn't text a person would read is
dropped before it reaches the splitter.

Sources, roughly in order of how often they answer a question:

  1. Markdown cells from the three notebooks in `modeling/` -- the written narrative, already prose and already sectioned by heading.
  2. `modeling/results/*.json|csv` -- the numbers, rendered as readable tables rather
     than raw JSON, so a retrieved chunk reads like a results section.
  3. Module docstrings from `modeling/features.py`, `modeling/history_features.py` and `backend/app/model/*.py` -- these carry the reasoning
     behind each decision, which is most of what the guide gets asked about.
  4. A hand-written project overview -- the framing no single file states outright.
  5. The research paper, `paper/main.pdf`, once `INDEX_PAPER` is switched on.
  6. Anything dropped in `documents/rag/` (.pdf, .md, .txt). Nothing else needs to change
     to pick it up; other file types are skipped, and the ingest says so.
"""

from __future__ import annotations

import ast
import json
import os
import re

from langchain_core.documents import Document

from ..paths import MODEL_NAME, MODELS_DIR, PAPER_PDF
from ..paths import MODELING_DIR as MODELING
from ..paths import RAG_DOCS_DIR as DOCS
from ..paths import RESULTS_DIR as RESULTS

HERE = os.path.dirname(os.path.abspath(__file__))


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

The work is in three notebooks. 01_eda explores the data. 02_research fits a first round
of models, which reached 0.7802 test AUC, then re-runs the problem as a controlled study,
one change at a time, and reaches 0.7976 with the applicant's full credit history. It ends
by asking what a preapproval form can honestly deliver. 03_train trains the model the site
serves on the form's fields alone, without sex or marital status, which a FastAPI backend
and a React site use to score an application, explain it, and place it against the
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
(point-of-sale) at 53.2% of applications with a recorded portfolio. Of the loans that
financed goods: mobile phones 31.2%, consumer electronics 16.9%, computers 14.7%,
audio/video 13.8%, furniture 7.5%. The originating retailers are consumer electronics shops
(48.9%) and phone shops (33.9%). Cash loans are for repairs
(34.1%), urgent needs (12.1%), a used car (4.1%), medicine (3.1%).

The median loan term is 12 months: 36 at the 90th percentile, 84 at the longest. A
mortgage runs 180-360 months.

Home Credit's business targets customers with thin or no credit files, which is why the
dataset ships three external bureau scores and five tables of alternative history. That
population is also where the model is weakest: on the 14.2% of test clients with no bureau
record at all it scores 0.780 AUC, against 0.799 on clients who have a record, even though
the thin-file group defaults more often (10.2% vs 7.7%). The people this lender exists to
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
median annuity of 24,903 against a median income of 147,150 is 16.9% of income if income
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
| first models, best (LightGBM) | 0.7802 |
| after the controlled study, final blend | 0.7976 |

The stated target was 0.80 and it was not reached. The shortfall of 0.0024 is smaller
than the test set's own standard error of 0.0039, so 0.7976 and 0.800 can't be told apart
on this data. The honest figure to report is still 0.7976.

Where the gain came from, as test-AUC deltas against the best rung so far: better
features (+0.0110), fixing early stopping (+0.0080), letting LightGBM handle missing
values natively (+0.0010), hyperparameter search (+0.0009), cohort features (+0.0005),
and ensembling (+0.0003). Those sum to +0.0217, the whole gain from the first-model
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
        body = re.sub(r"^\s*---\s*$", "", body, flags=re.MULTILINE).strip()
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
        src = re.sub(r"^\s*(<!--.*?-->\s*)+", "", src, flags=re.DOTALL).strip()
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
        "B0_notebook_reproduction": "first-model pipeline, reproduced exactly",
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
                     metadata={"source": "results/ablation.json", "kind": "results",
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
                     metadata={"source": "results/importances.csv", "kind": "results",
                               "section": "Most important features in the final model"})]


# ----------------------------------------------------------------------------------
def deployment_notes() -> list[Document]:
    """What the served system actually does.

    Added after a test question ("what threshold does the API use?") came back unanswered:
    the value lives in a model artefact and in function-level comments, neither of which
    the corpus reached. Every figure is read from a file the notebooks write (the model's
    schema and threshold, results/final_metrics.json, results/fairness_and_form.json,
    results/form_field_sensitivity.csv), so the guide cannot quote a number the deployed
    model no longer has.
    """
    def load(path):
        return json.load(open(path)) if os.path.exists(path) else None

    schema = load(os.path.join(MODELS_DIR, f"{MODEL_NAME}_schema.json"))
    thresh = load(os.path.join(MODELS_DIR, f"{MODEL_NAME}_threshold.json"))
    if not (schema and thresh):
        return []
    final = load(os.path.join(RESULTS, "final_metrics.json")) or {}
    fair = load(os.path.join(RESULTS, "fairness_and_form.json"))
    hiding_table = "\n".join(
        f"| {r['hidden share']:.0%} | {r['CV AUC']:.4f} | {r['CV AUC, scores blank']:.4f} |"
        for r in load(os.path.join(RESULTS, "score_hiding.json")) or [])
    n_cohort = sum(c.startswith("COH_") for c in schema["features"])

    text = f"""
# The deployed system

The API (`backend/app/model/service.py`, FastAPI) serves **{MODEL_NAME}**: a LightGBM model
over {len(schema['features'])} features, every one of them something a preapproval form can
supply, built by 03_train.ipynb. Test AUC {schema.get('test_auc', float('nan')):.4f}, average
precision {schema.get('test_avg_precision', float('nan')):.4f}, {schema.get('n_estimators', 0):,}
trees fitted on the full training split. It is trained without sex or marital status
({', '.join(schema.get('excluded', []))}).

That AUC assumes the applicant enters the three bureau scores. When they are left blank,
test AUC is {schema.get('test_auc_scores_blank', float('nan')):.4f} (03_train.ipynb, section 7).
Most people filling in the form won't know their scores, so that lower figure is the
realistic one for the website.

## Trained for blank bureau scores

Almost every applicant in the data had a bureau score (only 0.06% had none), so a model
trained on them as they are leans on the scores and has never learned to score without
them. 03_train.ipynb (section 4) therefore hides the scores, and every feature built from
them, on a random share of the training rows, so the model learns both cases. A blank form
reaches the model as missing scores, exactly like those hidden rows. The share was chosen by
cross-validation with a rule set in advance: the best blank-score AUC among shares costing
the scores-given AUC no more than 0.002. It came out at
{schema.get('scores_hidden_share', float('nan')):.0%}. Before this change, the model was
trained on every row's real scores and blank forms were given the training applicants'
median scores; it scored 0.668 test AUC with the scores blank.

| share of training rows with scores hidden | CV AUC, scores given | CV AUC, scores blank |
|---|---|---|
{hiding_table}

This is not the 0.7976 model of the research study. That one reads the applicant's whole
credit history, which a preapproval form cannot supply; the served model is trained on the
form's fields alone, which is what makes it honest about what a form can deliver.

## The decision threshold

The cutoff is **{thresh['threshold']:.4f}** -- above it an application is declined, below it
preapproved. It is the F1-optimal point computed on **out-of-fold predictions**, not on
the test set: a deployment threshold is a decision, and the test split had already been
spent on reporting. Using the test set to pick it would quietly turn the held-out set
into a tuning set. The default 0.5 the first models started with is arbitrary at an 8.07% base
rate.

## Rules on top of the model

Two behaviours of the raw model made no sense for a lending tool, so the API handles them
outside the model:

- **Affordability.** An application whose monthly payment is more than 40% of monthly
  income is declined whatever its score. The model cannot enforce this itself: applicants
  paying 40-50% of income missed early payments at 8.6%, barely above the 8.1% average,
  because Home Credit had already turned away those who could not pay. 40% is a policy
  line, not something learned. For scale, about 2.6% of the real applicants in the data
  paid more than 40% of their income, and Home Credit had approved all of them.
- **Unemployed applicants and students.** The form leaves their job length blank, and in
  training a blank job length almost always meant a pensioner (55,352 of 55,374), a
  low-risk group. So the model scores them as safer than employed applicants, although
  the 22 unemployed applicants in the data missed payments 36% of the time. With 22
  unemployed applicants and 18 students there is too little data to correct for, so the
  score is shown with a warning that it is unreliable.

## Better bureau scores can only lower the risk

The model is trained with LightGBM monotone constraints on every feature that rises with the
bureau scores (the scores, their mean, minimum, maximum, weighted sum and product, the
score-by-age and score-by-employment interactions, and the applicant's score relative to
their cohort), so raising any score can never raise the prediction. The spread between the
three scores was dropped from the model because it moves both ways as one score changes: left
in, three identical scores (a spread of exactly zero, rare in the data but easy on a slider)
raised the risk by up to 2 points. The constraint cost nothing measurable in AUC
(03_train.ipynb, section 3).

## No calibration wrapper

The first models needed `CalibratedClassifierCV` with isotonic regression because `scale_pos_weight`
inflated raw probabilities roughly threefold. The ablation showed that reweighting bought
no AUC at all -- it only distorted the probability scale -- so it was dropped. The served
model predicts {final.get('mean_predicted', float('nan')):.2%} on average against a true base
rate of {final.get('base_rate', float('nan')):.2%}, straight out of the model.
"""
    if fair:
        m = fair["models"]
        full, form = m["baseline"], m["form-only, without sex and marital status"]["true form"]
        prot = m["without sex and marital status"]["full history"]
        text += f"""
## Why the site serves a form-only model

Measured in 02_research.ipynb, section 3. The full-history model scores
{full['full history']['auc']:.4f} with everything in front of it. Fed only what a fully
answered preapproval form supplies, it drops to {full['true form']['auc']:.4f}, and its
probabilities run too high: {full['true form']['mean_predicted']:.1%} predicted on average
against {full['true form']['base_rate']:.1%} actual. (An earlier estimate of
{full['history blanked']['auc']:.3f} blanked only the credit-history tables, and so still
scored application columns no form asks for.) A
model trained on the form's fields alone scores {form['auc']:.4f} on the same inputs, with
{form['mean_predicted']:.1%} predicted on average: better ranking and honest probabilities.

## Sex and marital status

The US Equal Credit Opportunity Act and its Regulation B bar sex and marital status from
credit decisions, so the served model is trained without them, and without the cohort
features built on sex. On the full-history model, leaving them out cost
{full['full history']['auc'] - prot['auc']:.4f} AUC, about half the test set's standard
error, and changed {fair['decisions_changed_by_dropping_protected']:.1%} of approve/decline
decisions. It does not erase the difference in outcomes: without either input the model
still approved men at {prot['approval_by_gender']['ratio_M_to_F']:.2f} times the rate of
women, because other features carry some of the same signal. 03_train.ipynb, section 9,
reports the same check for the served model.
"""
    sens_p = os.path.join(RESULTS, "form_field_sensitivity.csv")
    levers = ""
    if os.path.exists(sens_p):
        import csv
        rows = list(csv.DictReader(open(sens_p)))
        top = [f"{r['form field']} ({float(r['largest move (points)']):.1f})" for r in rows[:7]]
        levers = ("The fields that move a typical applicant's predicted risk most, in percentage "
                  "points (03_train.ipynb, section 11): " + ", ".join(top) + ".")
    text += f"""
## The form

The form collects amounts in US dollars and converts them before scoring. The dataset's
currency is anonymised, so there is no exchange rate to look up; the constant is set so the
dataset's median applicant income (147,150 a month) maps onto $4,300 a month, which places
someone entering dollars where an equivalent Home Credit applicant sits in the population.
It is a calibration constant, not an exchange rate, and the page says so. The conversion is
necessary because {n_cohort} of the model's features compare an applicant against their
cohort's average, which only means anything if the applicant is on the same scale as the
training data. Income is asked for as gross, monthly, before tax; the dataset states neither.

It asks nothing the model cannot use, and nothing a lender may not use: no sex, no marital
status, and no living situation, contract type, car or realty ownership, none of which the
model reads. {levers}
"""
    return [Document(page_content=text.strip(),
                     metadata={"source": "backend/app/model/service.py + model artefacts",
                               "kind": "deployment", "section": "The deployed system"})]


# ----------------------------------------------------------------------------------
def module_docstrings() -> list[Document]:
    """Module-level docstrings from the feature code and the served model.

    These carry the reasoning behind each methodological choice -- which is what a guide
    gets asked about far more often than the code itself.
    """
    model_dir = os.path.join(HERE, "..", "model")
    sources = [("modeling", os.path.join(MODELING, fn)) for fn in ("features.py", "history_features.py")] + [
        ("model", os.path.join(model_dir, fn)) for fn in sorted(os.listdir(model_dir))
        if fn.endswith(".py") and not fn.startswith("_")]
    docs = []
    for label, path in sources:
        doc = ast.get_docstring(ast.parse(open(path).read()))
        if not doc or len(doc) < 150:
            continue
        name = f"{label}/{os.path.basename(path)}"
        docs.append(Document(page_content=f"# {name}\n\n{doc.strip()}",
                             metadata={"source": name, "kind": "code-doc", "section": name}))
    return docs


# ----------------------------------------------------------------------------------
def _read_document(path: str) -> list[Document]:
    """One file as Documents: a PDF page by page, so a citation can name the page."""
    fn = os.path.basename(path)
    if fn.lower().endswith(".pdf"):
        from langchain_community.document_loaders import PyPDFLoader
        pages = PyPDFLoader(path).load()
        for p in pages:
            p.metadata.update(source=fn, kind="paper",
                              section=f"{fn} p.{p.metadata.get('page', 0) + 1}")
        return pages
    if fn.lower().endswith((".txt", ".md")):
        return [Document(page_content=open(path).read(),
                         metadata={"source": fn, "kind": "paper", "section": fn})]
    print(f"  ! skipped {fn}: only .pdf, .md and .txt are read")
    return []


# The paper stays out of the index until it has been submitted. The index is committed to a
# public repository and the guide quotes what it retrieves, so anything indexed is public.
# Set this to True, then rebuild the index, once the paper can be shared.
INDEX_PAPER = False


def research_paper() -> list[Document]:
    if not INDEX_PAPER or not os.path.exists(PAPER_PDF):
        return []
    return _read_document(PAPER_PDF)


def dropped_in_docs() -> list[Document]:
    """Whatever the user puts in documents/rag/."""
    if not os.path.isdir(DOCS):
        return []
    out = []
    for fn in sorted(os.listdir(DOCS)):
        if fn.startswith("."):
            continue
        try:
            out.extend(_read_document(os.path.join(DOCS, fn)))
        except Exception as e:  # a malformed drop-in should not kill the whole ingest
            print(f"  ! could not read {fn}: {type(e).__name__}: {e}")
    return out


# ----------------------------------------------------------------------------------
def build_corpus(verbose: bool = True) -> list[Document]:
    groups = {
        "overview": project_overview(),
        "notebooks": [d for name in ("01_eda", "02_research", "03_train")
                      for d in notebook_sections(os.path.join(MODELING, f"{name}.ipynb"))],
        "ablation results": ablation_results(),
        "feature importances": feature_importances(),
        "deployment": deployment_notes(),
        "module docstrings": module_docstrings(),
        "paper": research_paper(),
        "documents/rag": dropped_in_docs(),
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
