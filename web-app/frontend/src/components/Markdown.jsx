/**
 * A small markdown renderer for the guide's answers: headings, paragraphs, bullet and
 * numbered lists, pipe tables, fenced code, and inline bold / italic / code / links.
 *
 * Hand-rolled rather than a dependency because the model's output uses a predictable
 * subset, and because the text arrives token by token: this renders whatever it has so
 * far without choking on an unclosed fence or a half-typed table, and `caret` places a
 * blinking cursor at the end of the last block while an answer is still streaming.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_]))/g;

function Inline({ text }) {
  const parts = text.split(INLINE).filter((p) => p !== "" && p !== undefined);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="rounded bg-[color-mix(in_srgb,var(--ink-muted)_14%,transparent)] px-1 py-px font-mono text-[0.86em]">
          {part.slice(1, -1)}
        </code>
      );
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline decoration-border underline-offset-2 hover:decoration-current">
          {link[1]}
        </a>
      );
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))
      if (part.length > 2) return <i key={i}>{part.slice(1, -1)}</i>;
    return <span key={i}>{part}</span>;
  });
}

const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
const bullet = (l) => l.match(/^\s*[-*•]\s+(.*)$/);
const numbered = (l) => l.match(/^\s*(\d+)[.)]\s+(.*)$/);
const heading = (l) => l.match(/^\s*(#{1,4})\s+(.*)$/);

function parse(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i += 1; // closing fence (or end of a still-streaming answer)
      blocks.push({ type: "code", lang, text: code.join("\n") });
      continue;
    }
    if (isTableLine(line)) {
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) {
        if (!isSeparator(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    const h = heading(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: h[2] });
      i += 1;
      continue;
    }
    if (bullet(line) || numbered(line)) {
      const ordered = Boolean(numbered(line));
      const items = [];
      while (i < lines.length) {
        const m = ordered ? numbered(lines[i]) : bullet(lines[i]);
        if (m) items.push(m[ordered ? 2 : 1]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += " " + lines[i].trim();
        else break;
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    // paragraph: run until a blank line or the start of another block
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isTableLine(lines[i]) && !heading(lines[i]) && !bullet(lines[i]) && !numbered(lines[i]) && !lines[i].trim().startsWith("```")) {
      para.push(lines[i++]);
    }
    blocks.push({ type: "para", text: para.join("\n") });
  }
  return blocks;
}

function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-caret bg-accent" />;
}

export default function Markdown({ text, caret = false, className = "" }) {
  const blocks = parse(text || "");
  if (!blocks.length) return caret ? <Caret /> : null;
  const last = blocks.length - 1;

  return (
    <div className={`space-y-2.5 ${className}`}>
      {blocks.map((b, i) => {
        const tail = caret && i === last ? <Caret /> : null;
        switch (b.type) {
          case "heading": {
            const Tag = b.level <= 2 ? "h3" : "h4";
            return (
              <Tag key={i} className={`font-semibold text-ink-primary ${b.level <= 2 ? "mt-1 text-[0.98rem]" : "text-[0.9rem]"}`}>
                <Inline text={b.text} />
                {tail}
              </Tag>
            );
          }
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`space-y-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-ink-muted`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                    {j === b.items.length - 1 ? tail : null}
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <div key={i}>
                <pre className="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[0.78rem] leading-relaxed text-ink-primary">
                  <code>{b.text}</code>
                </pre>
                {tail}
              </div>
            );
          case "table": {
            const [head, ...body] = b.rows;
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-left text-[0.82rem]">
                  <thead>
                    <tr>
                      {head?.map((h, j) => (
                        <th key={j} className="border-b border-border pb-1 pr-3 font-semibold text-ink-primary">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border-b border-border/50 py-1 pr-3 align-top tabular-nums">
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tail}
              </div>
            );
          }
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                <Inline text={b.text} />
                {tail}
              </p>
            );
        }
      })}
    </div>
  );
}
