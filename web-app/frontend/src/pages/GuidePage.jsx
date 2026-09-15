import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Kicker, PageTitle, PageSubtitle } from "../components/PageHeader.jsx";
import Markdown from "../components/Markdown.jsx";
import { Tooltip } from "../components/Tooltip.jsx";
import { askGuideStream } from "../lib/api.js";
import { Seedling } from "../components/icons.jsx";

const STARTERS = [
  "What did this project actually find?",
  "How does the tool decide to approve or decline?",
  "What kind of loans is this trained on?",
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
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const msgs = raw ? JSON.parse(raw) : [];
    return Array.isArray(msgs) ? msgs.filter((m) => !m.pending) : [];
  } catch {
    return [];
  }
};
const save = (messages) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter((m) => !m.pending)));
  } catch {
    /* private mode etc. -- the chat just won't persist */
  }
};

/* ------------------------------------------------------------------ small parts */

function Mark({ className = "h-7 w-7", icon = "h-5 w-5" }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-sm ${className}`}>
      <Seedling className={icon} />
    </div>
  );
}

function Spinner({ className = "h-3 w-3" }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Check({ className = "h-3 w-3" }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none">
      <path d="M4 10.5 8 14.5 16 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The step list shown while an answer is being prepared, before any text arrives. */
function Progress({ stage, hasHistory }) {
  const order = (hasHistory ? ["condense"] : []).concat(["retrieve", "write"]);
  const idx = order.indexOf(stage);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.78rem]">
      {order.map((key, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <span
            key={key}
            className={`flex items-center gap-1.5 transition-colors ${
              state === "active" ? "text-ink-primary" : state === "done" ? "text-ink-muted" : "text-ink-muted/50"
            }`}
          >
            {state === "done" ? (
              <Check className="h-3 w-3 text-[var(--good)]" />
            ) : state === "active" ? (
              <Spinner className="h-3 w-3 text-accent" />
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
      <div className="mb-1.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
        Grounded in {items.length} {items.length === 1 ? "passage" : "passages"}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s, i) => {
          const active = open === i;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setOpen(active ? null : i)}
              aria-expanded={active}
              className={`focus-ring group flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[0.74rem] transition-all hover:-translate-y-px hover:shadow-card ${
                active ? "border-accent bg-card text-ink-primary" : "border-border bg-surface text-ink-secondary hover:text-ink-primary"
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
        <div className="mt-2 animate-fade-in rounded-lg border border-border bg-surface px-3.5 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.7rem] text-ink-muted">
            <span className="truncate">{current.label}</span>
            <button type="button" onClick={() => setOpen(null)} className="focus-ring shrink-0 hover:text-ink-primary">
              close
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto text-[0.8rem] leading-relaxed text-ink-secondary">
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
      className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.72rem] text-ink-muted transition-colors hover:bg-surface hover:text-ink-primary"
    >
      {copied ? <Check className="h-3 w-3 text-[var(--good)]" /> : (
        <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
          <rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function UserMessage({ content }) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[0.88rem] leading-relaxed text-[var(--card)] sm:max-w-[75%]">
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({ m, hasHistory }) {
  const streaming = m.pending && m.content;
  const preparing = m.pending && !m.content;
  return (
    <div className="group flex gap-3 animate-fade-up">
      <Mark />
      <div className="min-w-0 flex-1 pt-0.5">
        {preparing ? <Progress stage={m.stage} hasHistory={hasHistory} /> : null}

        {m.sources?.length ? <Sources sources={m.sources} /> : null}

        {m.content ? (
          <div
            className={`text-[0.88rem] leading-relaxed text-ink-primary ${m.sources?.length || preparing ? "mt-3" : ""} ${
              m.error ? "rounded-lg border px-3.5 py-2.5 text-[var(--critical)]" : ""
            }`}
            style={m.error ? { borderColor: "var(--critical)" } : undefined}
          >
            <Markdown text={m.content} caret={Boolean(streaming)} />
          </div>
        ) : null}

        {m.stopped ? <div className="mt-1.5 text-[0.72rem] italic text-ink-muted">Stopped.</div> : null}

        {!m.pending && m.content && !m.error ? (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={m.content} />
          </div>
        ) : null}
      </div>
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

  useEffect(() => save(messages), [messages]);

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
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
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

  return (
    <div>
      <Kicker>Honors research project</Kicker>
      <PageTitle>About the research</PageTitle>
      <PageSubtitle>
        Ask how the model was built, what the study found, or how the tool reaches a
        decision. Answers come from the project's notebook, results and pipeline source,
        and each one shows the passages it was grounded in. If something isn't in the
        project, the guide says so rather than guessing.
      </PageSubtitle>

      <div className="mt-7 flex h-[min(72vh,760px)] min-h-[440px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card [animation-delay:180ms]">
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Mark />
            <div className="leading-tight">
              <div className="text-[0.85rem] font-semibold text-ink-primary">Research guide</div>
              <div className="text-[0.72rem] text-ink-muted">
                {sending ? "Answering…" : "Retrieval-augmented · cites its sources"}
              </div>
            </div>
          </div>
          {messages.length ? (
            <button
              type="button"
              onClick={reset}
              className="focus-ring rounded-full border border-border px-3 py-1.5 text-[0.76rem] font-medium text-ink-secondary transition-colors hover:border-accent hover:text-ink-primary"
            >
              New conversation
            </button>
          ) : null}
        </div>

        {/* transcript */}
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center animate-fade-in">
              <Mark className="h-11 w-11" icon="h-8 w-8" />
              <div className="mt-3 text-[1.02rem] font-semibold text-ink-primary">Ask about the research</div>
              <p className="mt-1 max-w-sm text-center text-[0.82rem] leading-relaxed text-ink-muted">
                The methodology, the numbers, the negative results, what the preapproval
                tool can and can't tell you.
              </p>
              <div className="mt-5 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="focus-ring rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-[0.82rem] text-ink-secondary transition-all hover:-translate-y-0.5 hover:border-accent hover:text-ink-primary hover:shadow-card"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={i} content={m.content} />
            ) : (
              <AssistantMessage key={i} m={m} hasHistory={i > 1} />
            )
          )}
        </div>

        {/* composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="border-t border-border p-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about the project…"
              className="max-h-[168px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[0.88rem] leading-relaxed text-ink-primary outline-none placeholder:text-ink-muted"
            />
            {sending ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop"
                className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-secondary transition-all hover:border-accent hover:text-ink-primary active:scale-95"
              >
                <span className="h-3 w-3 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[var(--card)] transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                  <path d="M10 16V4M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          <div className="mt-1.5 px-1 text-[0.7rem] text-ink-muted">
            Enter to send · Shift+Enter for a new line
          </div>
        </form>
      </div>

      {error ? (
        <p className="mt-3 text-[0.78rem] text-[var(--critical)]">
          If this keeps happening, check that the research-guide service is running (
          <code>cd web-app/guide-service && uvicorn main:app --port 8001</code>).
        </p>
      ) : null}
    </div>
  );
}
