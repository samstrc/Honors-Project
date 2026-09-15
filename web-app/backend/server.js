import "dotenv/config";
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 8787);
const PREAPPROVAL_API_URL = process.env.PREAPPROVAL_API_URL || "http://localhost:8000";
const GUIDE_API_URL = process.env.GUIDE_API_URL || "http://localhost:8001";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Both routes below are thin proxies, on purpose. This server holds no model weights, no
// feature-engineering code, no scoring logic, and no chatbot logic of its own -- those all
// live exactly once, in the project's existing Python services (Modeling/api/main.py and,
// via guide-service/main.py, Chatbot/chat.py). If either of those change, this file needs
// no changes at all.

// --- health -------------------------------------------------------------------------
async function probe(url) {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? { reachable: true, ...(await r.json()) } : { reachable: false };
  } catch {
    return { reachable: false };
  }
}

app.get("/api/health", async (_req, res) => {
  const [modelApi, guideApi] = await Promise.all([
    probe(PREAPPROVAL_API_URL),
    probe(GUIDE_API_URL),
  ]);
  res.json({ status: "ok", modelApi, guideApi });
});

// --- preapproval model proxy ---------------------------------------------------------
// Forwards the request body verbatim to Modeling/api/main.py's /predict and returns its
// response verbatim. All scoring, feature-building and SHAP explanation happens there.
app.post("/api/predict", async (req, res) => {
  try {
    const upstream = await fetch(`${PREAPPROVAL_API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(15000),
    });
    const body = await upstream.text();
    res.status(upstream.status).type("application/json").send(body);
  } catch (e) {
    res.status(502).json({
      detail:
        `Can't reach the model API at ${PREAPPROVAL_API_URL}. Is it running? ` +
        `(cd Modeling && uvicorn api.main:app --port 8000) -- ${e.message}`,
    });
  }
});

// --- research-guide chatbot proxy -----------------------------------------------------
// Forwards to guide-service/main.py, which wraps the project's own Chatbot/chat.py Guide
// class. None of the chatbot's source material or answering logic lives in this file --
// see guide-service/main.py's module docstring for why that service exists at all.
app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in request body." });
  }
  try {
    const upstream = await fetch(`${GUIDE_API_URL}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        history: Array.isArray(history) ? history : [],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await upstream.text();
    res.status(upstream.status).type("application/json").send(body);
  } catch (e) {
    res.status(502).json({
      error:
        `Can't reach the research-guide service at ${GUIDE_API_URL}. Is it running? ` +
        `(cd web-app/guide-service && uvicorn main:app --port 8001) -- ${e.message}`,
    });
  }
});

// Streaming variant of /api/chat: forwards to guide-service's /answer/stream and pipes
// the server-sent events back untouched. Still no logic here -- the events are produced
// by Chatbot/chat.py's Guide.answer_stream and consumed by the browser.
app.post("/api/chat/stream", async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in request body." });
  }
  // Cancel the upstream generation if the browser goes away mid-answer. This has to hang
  // off `res`, not `req`: Node fires the request's "close" as soon as its body has been
  // read, which would abort the fetch before it started.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    const upstream = await fetch(`${GUIDE_API_URL}/answer/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        history: Array.isArray(history) ? history : [],
      }),
      signal: abort.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const body = await upstream.text();
      return res.status(upstream.status).type("application/json").send(body);
    }
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const body = Readable.fromWeb(upstream.body);
    // When the browser disconnects, the abort above makes this stream emit an error.
    // An 'error' with no listener is an uncaught exception and would take the whole
    // server down, so swallow it: the client is gone and there is no one to tell.
    body.on("error", () => res.end());
    body.pipe(res);
  } catch (e) {
    if (abort.signal.aborted) return; // the browser went away; nothing to report
    res.status(502).json({
      error:
        `Can't reach the research-guide service at ${GUIDE_API_URL}. Is it running? ` +
        `(cd web-app/guide-service && uvicorn main:app --port 8001) -- ${e.message}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] proxying predictions to ${PREAPPROVAL_API_URL}, chat to ${GUIDE_API_URL}`);
});
