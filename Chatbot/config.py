"""Shared configuration: where things live, and how the API key is found."""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DB_DIR = os.path.join(HERE, "db", "chroma")
DOCS_DIR = os.path.join(HERE, "docs")

EMBED_MODEL = "text-embedding-3-small"
CHAT_MODEL = "gpt-4.1-mini"

# k is larger than the usual 3. The corpus is small and its documents are short and
# narrow, so a question like "what did tuning achieve" needs the ablation table, the
# tuning docstring and the notebook section together. A smaller k returns partial
# answers that still sound complete.
TOP_K = 6


def get_api_key() -> str:
    """Resolve the OpenAI key without ever putting it in a source file.

    Order: the environment, then `Modeling/.env`, then `Chatbot/.env`. Both env files are
    gitignored, so the key never reaches the repository.
    """
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]

    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(ROOT, "Modeling", ".env"))
        load_dotenv(os.path.join(HERE, ".env"))
    except ImportError:
        pass
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]

    raise SystemExit(
        "No OpenAI API key found.\n"
        "  Set OPENAI_API_KEY in your environment, or add a line to Modeling/.env:\n"
        "      OPENAI_API_KEY=sk-...\n"
    )
