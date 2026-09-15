"""Thin FastAPI wrapper around the project's own research-guide chatbot.

This process does not reimplement how the chatbot answers questions. It imports `Guide`
straight from `../../Chatbot/chat.py` -- the same class `Streamlit Website/guide_page.py`
calls directly in-process -- and exposes its `.answer()` method over HTTP. The chatbot's
source material and search index are exactly what `python Chatbot/ingest.py` built from the
notebook and results files; nothing here re-derives, condenses, or approximates them. If
that source material changes, re-running `ingest.py` is the only thing that needs to
happen -- this wrapper has no copy of its own to fall out of sync.

Exists because `Chatbot/chat.py` is a plain Python class with no HTTP interface of its own
(unlike the model, which `Modeling/api/main.py` already serves over HTTP). The Node/Express
backend in `web-app/backend/` proxies to this service exactly the way it proxies to the
model API in `Modeling/api/main.py` -- POST in, JSON back, no logic in between.

Run in the same conda env the rest of the project uses (it already has the langchain /
openai packages `Chatbot/chat.py` needs):

    cd web-app/guide-service
    conda activate honorsproject
    uvicorn main:app --port 8001

Requires the index to already exist (`cd Chatbot && python ingest.py`) and an
OPENAI_API_KEY resolvable the same way `Chatbot/config.py` resolves it -- the environment,
then Modeling/.env, then Chatbot/.env. Nothing new to configure beyond what the original
Chatbot/ package already required.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

HERE = os.path.dirname(os.path.abspath(__file__))
CHATBOT_DIR = os.path.join(HERE, "..", "..", "Chatbot")
if CHATBOT_DIR not in sys.path:
    sys.path.insert(0, CHATBOT_DIR)

@asynccontextmanager
async def lifespan(_app):
    """Build the guide before the first request, so the index is loaded once, up front,
    rather than on whichever request happens to arrive first."""
    get_guide()
    yield


app = FastAPI(title="Research Guide API", lifespan=lifespan)

_guide = None
_guide_error: str | None = None
_guide_lock = threading.Lock()


def get_guide():
    """Build the Guide once and remember why it failed if it did.

    Mirrors `guide_page.py`'s own `@st.cache_resource` + `except SystemExit` pattern:
    a missing Chroma index or API key shouldn't crash the process, only the /answer route,
    with the same message the Streamlit page would have shown.

    Built under a lock: FastAPI runs these sync handlers on a thread pool, and two
    first-time callers arriving together (a container healthcheck and the backend's
    probe, say) would otherwise both construct a Chroma client for the same directory,
    which chromadb's shared client cache does not tolerate.
    """
    global _guide, _guide_error
    if _guide is not None or _guide_error is not None:
        return _guide
    with _guide_lock:
        if _guide is not None or _guide_error is not None:
            return _guide
        try:
            from chat import Guide  # Chatbot/chat.py -- the real, only implementation

            _guide = Guide()
        except SystemExit as e:
            _guide_error = str(e)
        except Exception as e:  # missing deps, bad key, etc. -- report, don't crash
            _guide_error = f"{type(e).__name__}: {e}"
    return _guide



class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    history: list[ChatMessage] = []


@app.get("/health")
def health():
    guide = get_guide()
    return {"status": "ok", "ready": guide is not None, "error": _guide_error}


@app.post("/answer")
def answer(req: ChatRequest):
    guide = get_guide()
    if guide is None:
        raise HTTPException(
            status_code=503,
            detail=_guide_error or "Guide is not ready.",
        )
    try:
        history = [{"role": m.role, "content": m.content} for m in req.history]
        text, sources = guide.answer(req.question, history)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")
    return {"text": text, "sources": sources}


@app.post("/answer/stream")
def answer_stream(req: ChatRequest):
    """The same answer as /answer, delivered as server-sent events.

    Each event is one JSON object from `Guide.answer_stream` (status / sources / delta /
    done), so the browser can show retrieval progress and type the answer out as it is
    generated instead of waiting on a blank bubble. Errors mid-stream arrive as an
    {"type": "error"} event, since the 200 has already been sent by then.
    """
    guide = get_guide()
    if guide is None:
        raise HTTPException(status_code=503, detail=_guide_error or "Guide is not ready.")
    history = [{"role": m.role, "content": m.content} for m in req.history]

    def events():
        try:
            for event in guide.answer_stream(req.question, history):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:  # noqa: BLE001 -- report it to the client, don't 500
            yield f"data: {json.dumps({'type': 'error', 'detail': f'{type(e).__name__}: {e}'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
