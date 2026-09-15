"""
Chunk the corpus, embed it, and persist a Chroma vector store.

Run this once to build the index, then again whenever the project changes or a new
document lands in `Chatbot/docs/`. Adding the research paper is just that: drop the PDF
in and re-run.

    python ingest.py

Two choices behind the settings below.

Chunks overlap. Splitting on a hard boundary with no overlap cuts sentences in half and
strands the context a chunk needs to stand on its own. 180 characters of overlap keeps a
retrieved chunk from starting mid-argument.

The rebuild is clean by default. An additive ingest against an existing collection
duplicates every chunk, and the duplicates then crowd out real variety in the top-k.
Wiping and rebuilding a 40k-character corpus takes a few seconds.
"""

from __future__ import annotations

import argparse
import os
import shutil

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import DB_DIR, EMBED_MODEL, get_api_key
from corpus import build_corpus

CHUNK_SIZE = 1400
CHUNK_OVERLAP = 180


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true",
                    help="append to the existing store instead of rebuilding it")
    args = ap.parse_args()

    print("Building corpus:")
    docs = build_corpus()
    if not docs:
        raise SystemExit("Corpus is empty -- nothing to index.")

    # Split on paragraph and sentence boundaries before falling back to characters, so a
    # chunk boundary lands between ideas rather than mid-word.
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n## ", "\n# ", "\n\n", "\n", ". ", " ", ""],
        length_function=len,
    )
    chunks = splitter.split_documents(docs)
    print(f"\n{len(docs)} documents -> {len(chunks)} chunks "
          f"(size {CHUNK_SIZE}, overlap {CHUNK_OVERLAP})")

    by_kind: dict[str, int] = {}
    for c in chunks:
        by_kind[c.metadata.get("kind", "?")] = by_kind.get(c.metadata.get("kind", "?"), 0) + 1
    for k, n in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<14} {n:>3} chunks")

    if os.path.isdir(DB_DIR) and not args.keep:
        print(f"\nremoving existing store at {DB_DIR}")
        shutil.rmtree(DB_DIR)
    os.makedirs(DB_DIR, exist_ok=True)

    print("embedding and persisting...")
    embeddings = OpenAIEmbeddings(model=EMBED_MODEL, api_key=get_api_key())
    Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=DB_DIR,
        # Cosine distance, since OpenAI embeddings are normalised and cosine is what the
        # model was trained against; Chroma defaults to L2, which is not the same ranking.
        collection_metadata={"hnsw:space": "cosine"},
    )
    print(f"done -- vector store at {DB_DIR}")


if __name__ == "__main__":
    main()
