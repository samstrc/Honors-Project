# Project guide: RAG chatbot

A retrieval-augmented chatbot that acts as a guide to this honors research project. It
answers from the project's own artefacts and cites which one each claim came from.

## Running it

```bash
conda activate honorsproject

python ingest.py          # build the vector store (run once, and after any change)
python chat.py            # a terminal session
```

The chat interface lives in the website, not here. `Streamlit Website/guide_page.py`
imports `Guide` from this folder and renders it as the "About the research" page. One UI
instead of two means there is nothing to drift apart.

The OpenAI key is read from `OPENAI_API_KEY` in the environment, or from `Modeling/.env`.
Both are gitignored, so the key never reaches the repository.

## Adding the research paper

Drop it into `docs/` and re-run the ingest:

```bash
cp ~/path/to/paper.pdf docs/
python ingest.py
```

`.pdf`, `.md` and `.txt` are all picked up, and PDFs are split per page so a citation can
point at a page number. No code changes needed; that is what `docs/` is for.

## What it knows

| Source | What it contributes |
|---|---|
| `Modeling/home_credit_default_risk.ipynb` markdown cells | the written narrative of all three parts |
| `Modeling/utilities/results/ablation.json` | the ablation ladder, rendered as a results table |
| `Modeling/utilities/results/importances.csv` | the top features by gain |
| module docstrings in `Modeling/utilities/` and `Modeling/api/` | the reasoning behind each decision |
| a written project overview | framing that no single file states outright |
| `docs/` | drop-in documents, and where the research paper will go |

Currently 47 documents, 66 chunks.

Not indexed: code bodies, notebook outputs, and the raw CSVs. Notebook outputs are mostly
base64 PNGs and progress bars, which would dominate the corpus by volume while answering
nothing. Retrieval quality comes down to what goes in, so the corpus is built from prose
and rendered tables rather than raw files.

## Design notes

**Follow-up questions are condensed before retrieval.** "What about that?" embeds to
nothing useful, so a short model call rewrites the question into a standalone one from the
recent turns first. It is why "why did that happen?" resolves correctly here.

**The model refuses rather than guesses.** A guide that invents a plausible number about
someone's own research is worse than one that admits it doesn't know: the reader can't
tell the difference, and the number ends up in a paper.

**The system prompt asks for honesty about the negative results.** The 0.80 AUC target
wasn't reached (final: 0.7976), and ensembling, seed-bagging and XGBoost tuning added
almost nothing. The guide is told to say so rather than present the work as a clean win.

**Cosine distance, not L2.** OpenAI embeddings are normalised and trained against cosine
similarity. Chroma defaults to L2, which ranks differently.

**Ingest rebuilds by default.** An additive ingest duplicates every chunk, and the
duplicates then crowd out real variety in the top-k. `--keep` opts out.

## Files

```
corpus.py    turns project artefacts into well-sectioned documents with metadata
ingest.py    chunks, embeds, and persists the Chroma store
chat.py      retrieval + answer; a Guide class and a CLI
config.py    paths, model names, API-key resolution
docs/        drop-in documents (the research paper goes here)
db/chroma/   the persisted vector store (generated)
```

The UI is `Streamlit Website/guide_page.py`.
