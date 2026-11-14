"""Where the backend finds what it serves. Everything is relative to the repository root,
so the same paths hold locally and inside the Docker image, which keeps the repo's layout."""

import os

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
MODELING_DIR = os.path.join(REPO_ROOT, "modeling")
MODELS_DIR = os.path.join(MODELING_DIR, "models")
# The served model's files are models/<MODEL_NAME>*, written by modeling/03_train.ipynb.
MODEL_NAME = os.environ.get("PREAPPROVAL_MODEL", "lightgbm_form_v3")
RESULTS_DIR = os.path.join(MODELING_DIR, "results")
# Extra files the research guide indexes (notes). Local only, like all of documents/.
RAG_DOCS_DIR = os.path.join(REPO_ROOT, "documents", "rag")
# The research paper, which the guide also indexes, built from paper/main.tex.
PAPER_PDF = os.path.join(REPO_ROOT, "paper", "main.pdf")
FRONTEND_DIST = os.path.join(REPO_ROOT, "frontend", "dist")
