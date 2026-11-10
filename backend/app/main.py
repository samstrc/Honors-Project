"""The backend: one FastAPI app that scores applications, answers the research guide, and
(once the frontend is built) serves the site.

    cd backend && uvicorn app.main:app --reload --port 8000

In development the Vite dev server proxies /api here and serves the site itself. In
production (the Dockerfile at the repo root) the built frontend sits in frontend/dist and
this app serves it, so the whole site is one process on one port.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .guide import service as guide
from .model import service as model
from .model.schema import LoanApplication, PreapprovalResponse
from .paths import FRONTEND_DIST


@asynccontextmanager
async def lifespan(_app):
    # Warm both up front: the model (a 10 MB joblib) and the guide (the Chroma index).
    # Neither failing is fatal; /api/health reports what's missing and the pages degrade.
    try:
        model.warm()
    except Exception:  # noqa: BLE001
        pass
    guide.get_guide()
    yield


app = FastAPI(title="Consumer loan preapproval", lifespan=lifespan)


@app.get("/api/health")
def api_health():
    def probe(fn):
        try:
            return {"reachable": True, **fn()}
        except Exception as e:  # noqa: BLE001
            return {"reachable": False, "error": f"{type(e).__name__}: {e}"}

    return {"status": "ok", "model": probe(model.health), "guide": probe(guide.health)}


@app.post("/api/predict", response_model=PreapprovalResponse)
def api_predict(application: LoanApplication):
    return model.predict(application)


@app.post("/api/chat/stream")
def api_chat_stream(req: guide.ChatRequest):
    return guide.answer_stream(req)


# --- the built site (production only) -------------------------------------------------

if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str):
        """Static file if one exists, otherwise the app shell: the page does its own routing."""
        candidate = os.path.normpath(os.path.join(FRONTEND_DIST, path))
        if path and candidate.startswith(FRONTEND_DIST + os.sep) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"), headers={"Cache-Control": "no-cache"})
