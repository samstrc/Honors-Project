"""
Retrieval-augmented chat: a guide to this research project.

Two ways in: `python chat.py` for a terminal session, or `from chat import Guide` for
the Streamlit page in `Streamlit Website/guide_page.py`.

Three design choices, each of which matters more than the prompt wording.

Follow-up questions are condensed before retrieval. "What about that?" embeds to nothing
useful, so a multi-turn conversation degrades into retrieving noise. A short model call
rewrites each question into a standalone one from the recent turns first.

The model is told to refuse rather than guess. A guide that invents a plausible number
about someone's own research is worse than one that says it doesn't know: the user can't
tell the difference, and the number ends up in a paper.

Sources come back with the answer. The reason to use RAG over a fine-tune is that every
claim stays traceable, so the retrieved sections are returned alongside the text.
"""

from __future__ import annotations

import os
import sys
import textwrap

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from openai import OpenAI

from config import CHAT_MODEL, DB_DIR, EMBED_MODEL, TOP_K, get_api_key

SYSTEM_PROMPT = """\
You are the guide to Sam Strickler's undergraduate honors research project on the Home \
Credit Default Risk dataset. You help people understand what the project did, why each \
decision was made, and what the results actually show.

Who you are talking to: assume the reader has NO background in statistics, machine \
learning or lending. They might be a family member, a recruiter, or a student from a \
different field. Your default is the plain-language version; the technical version is \
available on request.

Ground rules:

1. Answer ONLY from the provided context. If the context does not contain the answer, \
say so plainly and suggest what part of the project might cover it. Never invent a \
number, a filename, or a result. If you are unsure whether a figure is in the context, \
do not state it.
2. Explain simply by default. Use everyday words and, where it helps, a short analogy. \
Avoid jargon; if a technical term is unavoidable, give it in plain words first and put \
the term in parentheses after, e.g. "how well the model tells risky applicants from \
safe ones (its AUC score)". Do not lead with method names, feature engineering, or \
tuning details unless asked.
3. Go deep only when asked. If the person asks for detail, uses technical terms \
themselves, or asks a follow-up like "how exactly" or "what's the math", match them: \
then give the full technical account the context supports: exact figures, method \
names, notebook sections. Otherwise keep the specifics to the one or two numbers that \
matter most.
4. Be accurate about the negative results. This project's value is its rigour, not its \
score. The 0.80 target was NOT reached; the final figure is 0.7976. Ensembling, \
seed-bagging and XGBoost tuning contributed almost nothing. Say so when relevant, in \
plain terms, rather than presenting the work as an unbroken success.
5. Use a number when it makes the point clearer, not to show precision. "About 8 in \
every 100 applicants missed an early payment" is better for most readers than "the \
positive rate is 8.07%"; give the exact figure if they ask or if precision matters.
6. Match the breadth of the question. Asked broadly what the project is, answer \
broadly (what it is, what it found, why it matters) in a couple of short paragraphs. \
Asked something specific, go straight to the specific answer.
7. Be direct and concise. No preamble, no flattery, no restating the question. One or \
two short paragraphs is usually right; use a short table only when comparing numbers \
side by side genuinely helps.
8. When a claim comes from a specific part of the project, you may name it (the \
notebook section, the module, or the results file), briefly, so it stays traceable.
9. Context passages are ranked by relevance, most relevant first. Weight them that way; \
a later passage is background, not the answer.
10. Write like a person talking, not like a model writing. Never use an em dash (the \
character "—") or a double hyphen as a dash; use a comma, a full stop or parentheses \
instead. No filler openers or closers ("Great question", "In summary", "It's worth \
noting"), no rhetorical questions, no "not just X but Y" framing, no stacking three \
adjectives where one will do, and no bullet lists unless the person asks for a list. \
Contractions are fine. If a sentence would sound odd said out loud, rewrite it.

You are a guide, not a salesperson. If someone asks whether the project is good, give \
them an honest assessment of both what it establishes and where it falls short.\
"""

CONDENSE_PROMPT = """\
Given the conversation so far and a follow-up question, rewrite the follow-up as a \
standalone question that makes sense without the conversation. Keep it short. If it is \
already standalone, return it unchanged. Return ONLY the rewritten question.\
"""


class Guide:
    def __init__(self, k: int = TOP_K, rel_floor: float = 0.62):
        if not os.path.isdir(DB_DIR):
            raise SystemExit(
                f"No vector store at {DB_DIR}.\nRun `python ingest.py` first."
            )
        key = get_api_key()
        self.client = OpenAI(api_key=key)
        self.db = Chroma(
            persist_directory=DB_DIR,
            embedding_function=OpenAIEmbeddings(model=EMBED_MODEL, api_key=key),
            collection_metadata={"hnsw:space": "cosine"},
        )
        self.k = k
        self.rel_floor = rel_floor

    # ------------------------------------------------------------------
    def _standalone(self, question: str, history: list[dict]) -> str:
        """Rewrite a follow-up into a self-contained question for retrieval."""
        if not history:
            return question
        convo = "\n".join(f"{m['role']}: {m['content']}" for m in history[-4:])
        r = self.client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": CONDENSE_PROMPT},
                {"role": "user", "content": f"Conversation:\n{convo}\n\nFollow-up: {question}"},
            ],
            temperature=0,
        )
        return (r.choices[0].message.content or question).strip()

    def retrieve(self, query: str):
        """Top-k, then drop hits far weaker than the best one.

        A broad query ("tell me about this project") matches its best chunk only weakly,
        and a fixed k then pads the context with four near-misses. The model treats all
        of them as equally relevant and answers with whatever detail happened to rank
        third. Cutting at a fraction of the top score keeps k as a ceiling rather than a
        quota, so a narrow question still gets its full context while a broad one is not
        buried. Two hits are always kept, so a valid query never returns nothing.
        """
        hits = self.db.similarity_search_with_score(query, k=self.k)
        if not hits:
            return hits
        sims = [1.0 - float(score) for _, score in hits]
        floor = max(sims[0] * self.rel_floor, 0.08)
        kept = [h for h, sim in zip(hits, sims) if sim >= floor]
        return kept if len(kept) >= 2 else hits[:2]

    # ------------------------------------------------------------------
    def _compose(self, question: str, history: list[dict], hits):
        """Turn retrieved hits into the chat messages and the sources list.

        Shared by `answer` and `answer_stream` so the prompt, the context layout and the
        source records are built in exactly one place.
        """
        blocks, sources = [], []
        for rank, (doc, score) in enumerate(hits, 1):
            src = doc.metadata.get("source", "?")
            sec = doc.metadata.get("section", "")
            blocks.append(f"[#{rank} most relevant | {src} -- {sec}]\n{doc.page_content}")
            sources.append({"source": src, "section": sec,
                            # Chroma returns cosine distance, so similarity is 1 - d.
                            "similarity": round(1.0 - float(score), 3),
                            # The passage itself, so a UI can show what the answer was
                            # grounded in rather than just naming the section.
                            "snippet": doc.page_content})

        context = "\n\n---\n\n".join(blocks)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages += history[-6:]
        messages.append({
            "role": "user",
            "content": f"Context from the project:\n\n{context}\n\n"
                       f"---\n\nQuestion: {question}",
        })
        return messages, sources

    def answer(self, question: str, history: list[dict] | None = None):
        """Return (answer_text, sources). `history` is a list of {role, content}."""
        history = history or []
        search_query = self._standalone(question, history)
        hits = self.retrieve(search_query)
        messages, sources = self._compose(question, history, hits)

        r = self.client.chat.completions.create(
            model=CHAT_MODEL, messages=messages, temperature=0.2,
        )
        return (r.choices[0].message.content or "").strip(), sources

    def answer_stream(self, question: str, history: list[dict] | None = None):
        """Same pipeline as `answer`, as a generator of progress events.

        Yields dicts a UI can render as they happen, so the wait is not a blank one:

            {"type": "status",  "stage": "condense" | "retrieve" | "write"}
            {"type": "sources", "sources": [...]}      # same records `answer` returns
            {"type": "delta",   "text": "..."}         # a chunk of the answer
            {"type": "done",    "text": "..."}         # the full answer, once

        The condense call, the retrieval and the prompt are the exact same code paths as
        `answer`; only the final completion is streamed.
        """
        history = history or []
        if history:
            yield {"type": "status", "stage": "condense"}
        search_query = self._standalone(question, history)

        yield {"type": "status", "stage": "retrieve"}
        hits = self.retrieve(search_query)
        messages, sources = self._compose(question, history, hits)
        yield {"type": "sources", "sources": sources}

        yield {"type": "status", "stage": "write"}
        stream = self.client.chat.completions.create(
            model=CHAT_MODEL, messages=messages, temperature=0.2, stream=True,
        )
        parts = []
        for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                parts.append(delta)
                yield {"type": "delta", "text": delta}
        yield {"type": "done", "text": "".join(parts).strip()}


# ----------------------------------------------------------------------------------
def main():
    guide = Guide()
    print("Project guide. Ask about the methodology, the results, or the deployment.")
    print("Ctrl-C or an empty line to quit.\n")
    history: list[dict] = []
    while True:
        try:
            q = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not q:
            break
        try:
            text, sources = guide.answer(q, history)
        except Exception as e:
            print(f"  ! {type(e).__name__}: {e}\n")
            continue
        print()
        for line in text.split("\n"):
            print(textwrap.fill(line, 88) if line.strip() else "")
        seen, shown = set(), []
        for s in sources:
            label = f"{s['source']} -- {s['section']}"
            if label not in seen:
                seen.add(label)
                shown.append(label)
        print("\n  sources: " + "; ".join(shown[:4]) + "\n")
        history += [{"role": "user", "content": q}, {"role": "assistant", "content": text}]


if __name__ == "__main__":
    main()
