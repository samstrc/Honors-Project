import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Markdown from "../components/Markdown.jsx";
import { Tooltip } from "../components/Tooltip.jsx";
import { askGuideStream } from "../lib/api.js";
import { CheckIcon, SpinnerIcon } from "../components/icons.jsx";
import { loadSession, saveSession } from "../lib/storage.js";

const STARTERS = [
  "Which parts of this project are AI?",
  "How does the tool decide to approve or decline?",
  "What kind of loans are these?",
  "How good is the model at catching missed payments?",
];

// Progress stages in the order Guide.answer_stream reports them. "condense" only happens
// on a follow-up (there is nothing to condense on the first question).
const STAGES = {
  condense: "Reading the conversation",
  retrieve: "Searching the project",
  write: "Writing",
};

// The conversation survives a hop to the preapproval tool and back, but not a new tab.
const STORAGE_KEY = "guide-chat";
const loadSaved = () => {
  const msgs = loadSession(STORAGE_KEY, []);
  return Array.isArray(msgs) ? msgs.filter((m) => !m.pending) : [];
};

/* ------------------------------------------------------------------ small parts */

/** The step list shown while an answer is being prepared, before any text arrives. */
function Progress({ stage, hasHistory }) {
  const order = (hasHistory ? ["condense"] : []).concat(["retrieve", "write"]);
  const idx = order.indexOf(stage);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem]">
      {order.map((key, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <span
            key={key}
            className={`flex items-center gap-1.5 transition-colors ${
              state === "active" ? "text-ink-primary" : "text-ink-muted"
            }`}
          >
            {state === "done" ? (
              <CheckIcon className="h-3 w-3 text-good-text" />
            ) : state === "active" ? (
              <SpinnerIcon className="h-3 w-3 text-accent" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full border border-current" />
            )}
            {STAGES[key]}
            {state === "active" ? "…" : ""}
          </span>
        );
      })}
    </div>
  );
}

/** The passages an answer was grounded in: compact cards, click one to read it. */
function Sources({ sources }) {
  const [open, setOpen] = useState(null);
  if (!sources?.length) return null;

  // Same section can be retrieved as several chunks; show it once, keep the best score.
  // Section names come from notebook headings, so drop any markdown backticks.
  const byLabel = new Map();
  for (const raw of sources) {
    const s = { ...raw, section: (raw.section || "").replace(/`/g, "") };
    const label = s.section && s.section !== s.source ? `${s.source} · ${s.section}` : s.source;
    const prev = byLabel.get(label);
    if (!prev || (s.similarity ?? 0) > (prev.similarity ?? 0)) byLabel.set(label, { ...s, label });
  }
  const items = [...byLabel.values()];
  const top = Math.max(...items.map((s) => s.similarity ?? 0), 0.001);
  const current = open !== null ? items[open] : null;

  return (
    <div className="mt-3">
      <p className="t-small mb-1.5">
        Sources
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s, i) => {
          const active = open === i;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setOpen(active ? null : i)}
              aria-expanded={active}
              className={`group flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-left text-[0.8125rem] transition-colors ${
                active ? "border-ink-muted bg-[var(--tray)] text-ink-primary" : "border-[var(--rule)] text-ink-secondary hover:text-ink-primary"
              }`}
            >
              <span className="truncate">
                <span className="font-medium">{s.source}</span>
                {s.section && s.section !== s.source ? <span className="text-ink-muted"> · {s.section}</span> : null}
              </span>
              {typeof s.similarity === "number" ? (
                <Tooltip content={`Relevance ${(s.similarity * 100).toFixed(0)}% (cosine similarity to the question)`}>
                  <span className="relative h-1 w-8 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-muted)_25%,transparent)]">
                    <span className="absolute left-0 top-0 h-full rounded-full bg-accent" style={{ width: `${(s.similarity / top) * 100}%` }} />
                  </span>
                </Tooltip>
              ) : null}
            </button>
          );
        })}
      </div>
      {current?.snippet ? (
        <div className="mt-2 animate-fade-in border-l-2 border-[var(--rule)] py-1 pl-4">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.8125rem] text-ink-muted">
            <span className="truncate">{current.label}</span>
            <button type="button" onClick={() => setOpen(null)} className="shrink-0 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-primary">
              Close
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto text-[0.875rem] leading-relaxed text-ink-secondary">
            {/* the corpus is markdown (notebook cells, docs), so render it as such */}
            <Markdown text={current.snippet.replace(/\n{3,}/g, "\n\n")} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink-primary"
    >
      {copied ? <CheckIcon className="h-3 w-3 text-good-text" /> : (
        <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
          <rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Your question sits in a dark bubble on the right; the answer is plain text under it,
// since it can run long and carry tables and lists.
function UserMessage({ content }) {
  return (
    <p className="ink-card ml-auto w-fit max-w-[85%] animate-fade-up whitespace-pre-wrap !rounded-[20px] !rounded-br-md px-4 py-2.5 text-[0.9375rem] leading-snug">
      {content}
    </p>
  );
}

function AssistantMessage({ m, hasHistory }) {
  const streaming = m.pending && m.content;
  const preparing = m.pending && !m.content;
  return (
    <div className="group animate-fade-up [animation-delay:80ms]">
      {preparing ? <Progress stage={m.stage} hasHistory={hasHistory} /> : null}

      {m.content ? (
        <div
          className={`text-[0.9375rem] leading-relaxed ${m.error ? "text-critical-text" : "text-ink-primary"}`}
        >
          <Markdown text={m.content} caret={Boolean(streaming)} />
        </div>
      ) : null}

      {m.stopped ? <p className="t-small mt-1.5">Stopped.</p> : null}

      {m.sources?.length ? <Sources sources={m.sources} /> : null}

      {!m.pending && m.content && !m.error ? (
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={m.content} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function GuidePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState(loadSaved);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // follow new text unless the reader has scrolled up
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => saveSession(STORAGE_KEY, messages.filter((m) => !m.pending)), [messages]);

  // Leaving the page mid-answer cancels the request; an answer nobody is looking at
  // would otherwise keep streaming into an unmounted component and then be lost.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Arrived from the preapproval result with a question about that score: put it in the
  // box (not sent -- the person can still edit it) and clear the router state so a
  // refresh doesn't re-fill it.
  useEffect(() => {
    const prefill = location.state?.prefill;
    if (prefill) {
      setInput(prefill);
      navigate(location.pathname, { replace: true, state: null });
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [location, navigate]);

  // Auto-grow the composer with its content, up to a few lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patchLast = (patch) =>
    setMessages((ms) => {
      // "New conversation" mid-answer empties the list while the request is still
      // winding down; there is then nothing to patch.
      if (!ms.length || !ms[ms.length - 1].pending) return ms;
      const next = ms.slice();
      const last = next.length - 1;
      next[last] = { ...next[last], ...(typeof patch === "function" ? patch(next[last]) : patch) };
      return next;
    });

  async function send(text) {
    const prompt = (text ?? input).trim();
    if (!prompt || sending) return;
    setInput("");
    setError(null);
    stickRef.current = true;
    // the backend only reads the last few turns
    const history = messages.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [
      ...m,
      { role: "user", content: prompt },
      { role: "assistant", content: "", sources: [], pending: true, stage: history.length ? "condense" : "retrieve" },
    ]);
    setSending(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const result = await askGuideStream(
        prompt,
        history,
        (ev) => {
          if (ev.type === "status") patchLast({ stage: ev.stage });
          else if (ev.type === "sources") patchLast({ sources: ev.sources });
          else if (ev.type === "delta") patchLast((last) => ({ content: last.content + ev.text }));
        },
        abort.signal
      );
      patchLast({ content: result.text, sources: result.sources, pending: false, stopped: Boolean(result.stopped) });
    } catch (e) {
      setError(e.message);
      patchLast({ content: `Something went wrong: ${e.message}`, pending: false, error: true, sources: [] });
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    if (sending) stop();
    setMessages([]);
    setError(null);
    setInput("");
    textareaRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const asked = messages.filter((m) => m.role === "user").length;

  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div>
        <h1 className="t-h1">Research guide</h1>
        <p className="t-body mt-3">
          Ask how the model was built or what the study found. Answers come only from the
          project's own notebooks, results and code, with sources. If the project doesn't cover
          something, the guide says so.
        </p>
        <h2 className="t-h3 mt-8">Try asking</h2>
        <ul className="mt-3 flex flex-col items-start gap-2">
          {STARTERS.map((q) => (
            <li key={q} className="max-w-full">
              <button type="button" onClick={() => send(q)} disabled={sending} className="chip rounded-[18px] px-4 py-2 text-left leading-snug disabled:opacity-50">
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tray flex h-[min(76vh,780px)] min-h-[460px] flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-2">
          <p className="text-[0.875rem] text-ink-muted" aria-live="polite">
            {sending ? "Answering…" : asked ? `${asked} ${asked === 1 ? "question" : "questions"} so far` : "No questions yet"}
          </p>
          {messages.length ? (
            <button type="button" onClick={reset} className="chip px-3 py-1 text-[0.8125rem]">
              Start over
            </button>
          ) : null}
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="raised min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6">
          {messages.length === 0 ? (
            <p className="t-body max-w-[46ch]">
              Ask a question, or pick one to start.
            </p>
          ) : null}
          {messages.map((m, i) =>
            m.role === "user" ? <UserMessage key={i} content={m.content} /> : <AssistantMessage key={i} m={m} hasHistory={i > 1} />
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="px-1 pb-1 pt-2"
        >
          <label htmlFor="guide-input" className="sr-only">
            Your question
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="guide-input"
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about the project"
              className="field-input !h-auto max-h-[168px] min-h-[44px] flex-1 resize-none rounded-[22px] px-4 py-2.5 leading-relaxed placeholder:text-ink-muted"
            />
            {sending ? (
              <button type="button" onClick={stop} aria-label="Stop" className="btn btn-secondary h-11 w-11 shrink-0 justify-center !p-0">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
                  <rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} aria-label="Ask" className="btn btn-primary h-11 w-11 shrink-0 justify-center !p-0 disabled:opacity-40">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <path d="M10 16V4M5 9l5-5 5 5" />
                </svg>
              </button>
            )}
          </div>
          <p className="t-small mt-2 pl-4">Enter to send, Shift+Enter for a new line</p>
        </form>
      </div>

      {error ? (
        <p className="text-[0.875rem] text-critical-text lg:col-start-2">
          If this keeps happening, check that the backend is running (
          <code>cd backend && uvicorn app.main:app --port 8000</code>).
        </p>
      ) : null}
    </div>
  );
}
