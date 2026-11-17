import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Markdown from "../components/Markdown.jsx";
import { Tooltip } from "../components/Tooltip.jsx";
import { askGuideStream } from "../lib/api.js";
import { CheckIcon } from "../components/icons.jsx";
import { loadSession, saveSession } from "../lib/storage.js";

const STARTERS = [
  "Which parts of this project are AI?",
  "How does the tool decide to approve or decline?",
  "What kind of loans are these?",
  "How good is the model at catching missed payments?",
];

// The conversation survives a hop to the preapproval tool and back, but not a new tab.
const STORAGE_KEY = "guide-chat";
const loadSaved = () => {
  const msgs = loadSession(STORAGE_KEY, []);
  return Array.isArray(msgs) ? msgs.filter((m) => !m.pending) : [];
};

/* ------------------------------------------------------------------ small parts */

/** "02_research.ipynb · 1.5 Calibration" for a retrieved passage, deduplicated by label. */
function sourceItems(sources) {
  // The same section can be retrieved as several chunks; show it once, keep the best score.
  // Section names come from notebook headings, so drop any markdown backticks.
  const byLabel = new Map();
  for (const raw of sources || []) {
    const s = { ...raw, section: (raw.section || "").replace(/`/g, "") };
    const label = s.section && s.section !== s.source ? `${s.source} · ${s.section}` : s.source;
    const prev = byLabel.get(label);
    if (!prev || (s.similarity ?? 0) > (prev.similarity ?? 0)) byLabel.set(label, { ...s, label });
  }
  return [...byLabel.values()];
}

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/**
 * What the guide is doing while an answer is being prepared, one line at a time: reading
 * the conversation, what it searched for, which sections it is reading, then writing.
 * The backend's steps land within a second or so, usually before the first words of the
 * answer, so each line stays up for a moment before the next fades in, and the line keeps
 * running above the answer as it streams in. The answer is never held back for it.
 */
function Thinking({ stage, query, sources, hasHistory }) {
  const lines = [];
  if (hasHistory) lines.push("Reading the conversation so far");
  if (stage !== "condense") lines.push(query ? `Searching the project for “${clip(query, 70)}”` : "Searching the project");
  for (const s of sourceItems(sources).slice(0, 3)) lines.push(`Looking in ${clip(s.label, 60)}`);
  if (stage === "write") lines.push("Writing the answer");

  const [shown, setShown] = useState(0);
  const last = Math.max(lines.length - 1, 0);
  useEffect(() => {
    if (shown >= last) return undefined;
    const t = setTimeout(() => setShown((n) => n + 1), 800);
    return () => clearTimeout(t);
  }, [shown, last]);
  const line = lines[Math.min(shown, last)] || "Thinking";

  return (
    <div className="flex items-center gap-2.5 py-1" role="status" aria-live="polite">
      <span aria-hidden className="guide-orb h-3.5 w-3.5 shrink-0 rounded-full" />
      <span key={line} className="guide-shimmer truncate text-[0.875rem]">
        {line}…
      </span>
    </div>
  );
}

/** The passages an answer was grounded in, folded into one small button until asked for. */
function Sources({ sources }) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(null);
  const items = sourceItems(sources);
  if (!items.length) return null;
  const top = Math.max(...items.map((s) => s.similarity ?? 0), 0.001);
  const current = open !== null ? items[open] : null;

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          setOpen(null);
        }}
        aria-expanded={expanded}
        className="guide-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] text-ink-secondary transition-colors hover:text-ink-primary"
      >
        <span aria-hidden className="flex -space-x-1">
          {items.slice(0, 3).map((s) => (
            <span key={s.label} className="h-2 w-2 rounded-full border border-[var(--card)] bg-[var(--cat-1)]" style={{ opacity: 0.45 + 0.55 * ((s.similarity ?? 0) / top) }} />
          ))}
        </span>
        {items.length} {items.length === 1 ? "source" : "sources"}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden>
          <path d="m5 8 5 5 5-5" />
        </svg>
      </button>

      {expanded ? (
        <ul className="mt-1.5 animate-fade-in space-y-0.5">
          {items.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.75rem] transition-colors ${
                  open === i ? "bg-[color-mix(in_srgb,var(--ink-primary)_6%,transparent)] text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{s.source}</span>
                  {s.section && s.section !== s.source ? <span className="text-ink-muted"> · {s.section}</span> : null}
                </span>
                {typeof s.similarity === "number" ? (
                  <Tooltip content={`Relevance ${(s.similarity * 100).toFixed(0)}% (cosine similarity to the question)`}>
                    <span className="relative h-1 w-6 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-muted)_25%,transparent)]">
                      <span className="absolute left-0 top-0 h-full rounded-full bg-[var(--cat-1)]" style={{ width: `${(s.similarity / top) * 100}%` }} />
                    </span>
                  </Tooltip>
                ) : null}
              </button>
              {open === i && current?.snippet ? (
                <div className="mb-1 ml-2 mt-1 max-h-52 animate-fade-in overflow-y-auto border-l-2 border-[var(--rule)] py-0.5 pl-3 text-[0.8125rem] leading-relaxed text-ink-secondary">
                  {/* the corpus is markdown (notebook cells, docs), so render it as such */}
                  <Markdown text={current.snippet.replace(/\n{3,}/g, "\n\n")} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
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
    <p className="guide-bubble ml-auto w-fit max-w-[85%] animate-fade-up whitespace-pre-wrap rounded-[20px] rounded-br-md px-4 py-2.5 text-[0.9375rem] leading-snug">
      {content}
    </p>
  );
}

/**
 * The answer as it should appear on screen: it arrives from the model in uneven bursts,
 * so this lets the visible text catch up at a steady pace instead of jumping. It reveals
 * faster the further behind it is (about a third of a second behind at most), so a long
 * answer is never held back, and an answer that was already finished shows at once.
 */
function useSmoothText(text, live) {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(live && !reduce ? 0 : text.length);
  const shownRef = useRef(shown);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (reduce) {
      setShown(text.length);
      return undefined;
    }
    if (shownRef.current >= text.length) return undefined;
    let frame;
    let prev = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - prev, 64) / 1000;
      prev = now;
      const target = textRef.current.length;
      const behind = target - shownRef.current;
      if (behind <= 0) return;
      const perSecond = Math.max(55, behind * 3);
      shownRef.current = Math.min(target, shownRef.current + Math.max(1, perSecond * dt));
      setShown(Math.floor(shownRef.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, reduce]);

  return text.slice(0, Math.max(shown, 0));
}

function AssistantMessage({ m, hasHistory }) {
  const visible = useSmoothText(m.content, m.pending);
  const typing = Boolean(m.content) && (m.pending || visible.length < m.content.length);
  return (
    <div className="group animate-fade-up [animation-delay:80ms]">
      {m.pending ? <Thinking stage={m.stage} query={m.query} sources={m.sources} hasHistory={hasHistory} /> : null}

      {m.content ? (
        <div
          className={`text-[0.9375rem] leading-relaxed ${m.error ? "text-critical-text" : "text-ink-primary"}`}
        >
          <Markdown text={visible} caret={typing} className="guide-answer" />
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
          if (ev.type === "status") patchLast(ev.query ? { stage: ev.stage, query: ev.query } : { stage: ev.stage });
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
          Ask how the model was built or what the study found. Anything about the project
          comes from its own notebooks, results and code, with sources, and the guide says so
          when they don't cover something. It can also explain the ideas behind it.
        </p>
        <h2 className="t-h3 mt-8">Try asking</h2>
        <ul className="mt-3 flex flex-col items-start gap-2">
          {STARTERS.map((q) => (
            <li key={q} className="max-w-full">
              <button type="button" onClick={() => send(q)} disabled={sending} className="guide-pill rounded-[18px] px-4 py-2 text-left text-[0.875rem] leading-snug text-ink-primary transition-transform hover:-translate-y-px disabled:opacity-50">
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="guide-shell relative flex h-[min(76vh,780px)] min-h-[460px] flex-col">
        {/* drifting pools of colour for the glass to refract */}
        <div aria-hidden className="guide-aurora">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="relative flex items-center justify-between gap-3 px-4 pb-2.5 pt-2">
          <p className="text-[0.875rem] text-ink-muted" aria-live="polite">
            {sending ? "Answering…" : asked ? `${asked} ${asked === 1 ? "question" : "questions"} so far` : "No questions yet"}
          </p>
          {messages.length ? (
            <button type="button" onClick={reset} className="guide-pill rounded-full px-3 py-1 text-[0.8125rem] text-ink-primary">
              Start over
            </button>
          ) : null}
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="guide-glass relative min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6">
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
          className="relative px-1 pb-1 pt-2"
        >
          <label htmlFor="guide-input" className="sr-only">
            Your question
          </label>
          <div className="guide-composer flex items-end gap-2 rounded-[26px] p-1.5">
            <textarea
              id="guide-input"
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={2000}
              placeholder="Ask about the project"
              className="!h-auto max-h-[168px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 leading-relaxed text-ink-primary outline-none placeholder:text-ink-muted"
            />
            {sending ? (
              <button type="button" onClick={stop} aria-label="Stop" className="guide-pill inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-primary">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
                  <rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} aria-label="Ask" className="guide-send inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40">
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
