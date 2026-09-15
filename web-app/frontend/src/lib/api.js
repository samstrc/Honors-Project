/**
 * All calls go to /api/*, which Vite proxies to the Express backend in dev (see
 * vite.config.js) and which should be reverse-proxied the same way in production. The
 * frontend never talks to the FastAPI model service or OpenAI directly.
 */

// Plain-English names for the model API's request fields, for the rare case a request
// gets past the form's own checks and FastAPI rejects it with a 422.
const API_FIELD_LABELS = {
  income: "Monthly income",
  credit_amount: "Amount to borrow",
  annuity: "Monthly payment",
  goods_price: "Price of the item",
  age_years: "Age",
  gender: "Gender",
  children: "Children",
  family_members: "People in household",
  family_status: "Family status",
  education: "Education",
  income_type: "Income source",
  organization_type: "Type of employer",
  occupation: "Occupation",
  years_employed: "Years at current job",
  ext_score_1: "Bureau score 1",
  ext_score_2: "Bureau score 2",
  ext_score_3: "Bureau score 3",
  cc_utilization: "Credit card utilization",
};

// FastAPI validation errors arrive as a list of {loc, msg} objects. Stringifying that
// directly gave the user "[object Object]", so turn it into "Field: what's wrong" lines.
function describeError(body, status) {
  const detail = body.detail ?? body.error;
  if (Array.isArray(detail)) {
    const lines = detail.map((d) => {
      const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
      const label = API_FIELD_LABELS[field] || field;
      return label ? `${label}: ${d.msg}` : d.msg;
    });
    return `The model API rejected the request. ${lines.join(" · ")}`;
  }
  if (typeof detail === "string" && detail) return detail;
  return `Request failed (${status}).`;
}

async function asJson(resp) {
  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text };
  }
  if (!resp.ok) throw new Error(describeError(body, resp.status));
  return body;
}

export async function predict(payload, signal) {
  const resp = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return asJson(resp);
}

export async function askGuide(message, history) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  return asJson(resp);
}

/**
 * Streaming variant of askGuide. Reads the server-sent events that guide-service emits
 * (see Guide.answer_stream in Chatbot/chat.py) and calls `on` for each one as it lands:
 *
 *   on({ type: "status",  stage })     retrieval progress, in order
 *   on({ type: "sources", sources })   the passages the answer will be grounded in
 *   on({ type: "delta",   text })      the next chunk of the answer
 *
 * Resolves with { text, sources } once the answer is complete. Pass an AbortSignal to
 * stop generation early; the text received so far is still returned.
 */
export async function askGuideStream(message, history, on, signal) {
  const resp = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal,
  });
  if (!resp.ok || !resp.body) return asJson(resp); // surfaces the error the same way

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sources = [];
  let done = false;

  const handle = (event) => {
    if (event.type === "delta") text += event.text;
    else if (event.type === "sources") sources = event.sources || [];
    else if (event.type === "done") {
      text = event.text || text;
      done = true;
    } else if (event.type === "error") throw new Error(event.detail || "The guide hit an error.");
    on?.(event);
  };

  try {
    for (;;) {
      const { value, done: closed } = await reader.read();
      if (closed) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; keep any partial frame in the buffer.
      const frames = buffer.split("\n\n");
      buffer = frames.pop();
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) handle(JSON.parse(data));
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return { text: text.trim(), sources, stopped: true };
    throw e;
  }
  if (!done && !text) throw new Error("The guide closed the connection before answering.");
  return { text: text.trim(), sources };
}

export async function loadFindings() {
  const resp = await fetch("/data/site_findings.json");
  if (!resp.ok) throw new Error("Findings data not found.");
  return resp.json();
}

export async function loadRiskDistribution() {
  const resp = await fetch("/data/risk_distribution.json");
  if (!resp.ok) throw new Error("Risk distribution data not found.");
  return resp.json();
}
