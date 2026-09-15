"""One process for the Hugging Face Space: the model API, the research guide, and the
built site, all behind the same routes the browser already uses.

Locally the site is four processes (see docker-compose.yml). A free Space runs one
container on one port, so this file plays the part the Express proxy plays at home: it
answers /api/predict, /api/chat, /api/chat/stream and /api/health, then serves the
frontend. The difference is that here the model and the guide are imported and called
in-process rather than reached over HTTP. Nothing about them is reimplemented: the
FastAPI apps in Modeling/api/main.py and web-app/guide-service/main.py are mounted as-is
and their route functions are called directly.
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

HERE = os.path.dirname(os.path.abspath(__file__))

# Same folder layout as the repo, so each service's own relative paths keep working.
sys.path.insert(0, os.path.join(HERE, "Modeling"))
sys.path.insert(0, os.path.join(HERE, "web-app", "guide-service"))

from api import main as model_main  # noqa: E402  Modeling/api/main.py
import main as guide_main  # noqa: E402  web-app/guide-service/main.py

DIST = os.path.join(HERE, "web-app", "frontend", "dist")


@asynccontextmanager
async def lifespan(_app):
    # Mounted sub-apps don't get their own startup hooks, so warm both here: the model
    # (a 10 MB joblib) and the guide (the Chroma index). Neither failing is fatal; the
    # health route reports what's missing and the pages degrade the same way they do
    # locally.
    try:
        model_main.get_model()
    except Exception:  # noqa: BLE001
        pass
    guide_main.get_guide()
    yield


app = FastAPI(title="Consumer loan preapproval", lifespan=lifespan)

# --- the routes the browser calls (the Express backend's job, done in-process) -----


@app.get("/api/health")
def api_health():
    def probe(fn):
        try:
            return {"reachable": True, **fn()}
        except Exception as e:  # noqa: BLE001
            return {"reachable": False, "error": f"{type(e).__name__}: {e}"}

    return {"status": "ok", "modelApi": probe(model_main.health), "guideApi": probe(guide_main.health)}


@app.post("/api/predict", response_model=model_main.PreapprovalResponse)
def api_predict(application: model_main.LoanApplication):
    return model_main.predict(application)


def _chat_request(body: dict) -> guide_main.ChatRequest:
    # the page sends {message, history}; the guide service speaks {question, history}
    return guide_main.ChatRequest(
        question=str(body.get("message") or ""),
        history=[guide_main.ChatMessage(**m) for m in (body.get("history") or [])],
    )


@app.post("/api/chat")
def api_chat(body: dict):
    return guide_main.answer(_chat_request(body))


@app.post("/api/chat/stream")
def api_chat_stream(body: dict):
    return guide_main.answer_stream(_chat_request(body))


# The two services are also reachable directly, for curiosity or debugging.
app.mount("/model", model_main.app)
app.mount("/guide", guide_main.app)

# --- the site ------------------------------------------------------------------------

app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa(path: str):
    """Static file if one exists, otherwise the app shell: the page does its own routing."""
    candidate = os.path.normpath(os.path.join(DIST, path))
    if path and candidate.startswith(DIST + os.sep) and os.path.isfile(candidate):
        return FileResponse(candidate)
    return FileResponse(os.path.join(DIST, "index.html"), headers={"Cache-Control": "no-cache"})
