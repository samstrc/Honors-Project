"""The research guide as the backend serves it: one shared `Guide`, plus the request
shape and handler behind /api/chat/stream.

Nothing here answers questions itself; that is `chat.py`. This module only builds the
Guide once, remembers why it failed if it did, and turns its output into HTTP responses.

Requires the index to exist (`python -m app.guide.ingest` from backend/) and an
OPENAI_API_KEY in the environment or backend/.env.
"""

from __future__ import annotations

import json
import threading

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

_guide = None
_guide_error: str | None = None
_guide_lock = threading.Lock()


def get_guide():
    """Build the Guide once and remember why it failed if it did.

    A missing Chroma index or API key shouldn't crash the process, only the chat routes,
    which report the reason instead.

    Built under a lock: FastAPI runs sync handlers on a thread pool, and two first-time
    callers arriving together would otherwise both construct a Chroma client for the same
    directory, which chromadb's shared client cache does not tolerate.
    """
    global _guide, _guide_error
    if _guide is not None or _guide_error is not None:
        return _guide
    with _guide_lock:
        if _guide is not None or _guide_error is not None:
            return _guide
        try:
            from .chat import Guide

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
    message: str
    history: list[ChatMessage] = []


def health():
    guide = get_guide()
    return {"ready": guide is not None, "error": _guide_error}


def answer_stream(req: ChatRequest):
    """The guide's answer, delivered as server-sent events.

    Each event is one JSON object from `Guide.answer_stream` (status / sources / delta /
    done), so the browser can show retrieval progress and type the answer out as it is
    generated instead of waiting on a blank bubble. Errors mid-stream arrive as an
    {"type": "error"} event, since the 200 has already been sent by then.
    """
    guide = get_guide()
    if guide is None:
        raise HTTPException(status_code=503, detail=_guide_error or "Guide is not ready.")
    history = [m.model_dump() for m in req.history]

    def events():
        try:
            for event in guide.answer_stream(req.message, history):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:  # noqa: BLE001 -- report it to the client, don't 500
            yield f"data: {json.dumps({'type': 'error', 'detail': f'{type(e).__name__}: {e}'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
