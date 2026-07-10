import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "thinking"; label: string; text: string };

const LEADING_TIMESTAMP_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const THINKING_DURATION_RE =
  /^(?:已?思考|思考了)\s*((?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))\s*$/i;
const THINKING_LABEL_RE = /^(?:思考|思考过程|Thinking|Reasoning)\s*[:：]\s*$/i;
const ANSWER_START_RE = /^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|Final answer|Answer)\s*[:：])/i;
const MAX_THINKING_SCAN_LINES = 40;
const MAX_THINKING_SCAN_CHARS = 4000;

const markdownComponents: Components = {
  a({ href, children }) {
    const safeHref = typeof href === "string" && isSafeHref(href) ? href : undefined;
    if (!safeHref) {
      return <span className="text-[#374151]">{children}</span>;
    }
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-[#0f766e] underline decoration-[#99f6e4] underline-offset-2 hover:text-[#0f5f59]"
      >
        {children}
      </a>
    );
  },
  blockquote({ node, children }) {
    const rawText = collectNodeText(node);
    const callout = parseCallout(rawText);
    if (callout) {
      return (
        <div className={`rounded-xl border px-4 py-3 ${calloutClassName(callout.type)}`}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-normal">{callout.label}</div>
          <MarkdownBody text={callout.body} />
        </div>
      );
    }
    return <blockquote className="border-l-4 border-[#d1d5db] pl-4 text-[#4b5563]">{children}</blockquote>;
  },
  code({ className, children }) {
    const raw = String(children).replace(/\n$/, "");
    const languageMatch = /language-([A-Za-z0-9_-]+)/.exec(className ?? "");
    const language = languageMatch?.[1] ?? "";
    const isBlock = Boolean(language) || raw.includes("\n");

    if (!isBlock) {
      return <code className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[0.9em] text-[#0f172a]">{children}</code>;
    }

    return (
      <figure className="my-3 max-w-full overflow-hidden rounded-xl border border-[#111827] bg-[#0f172a] shadow-sm">
        <figcaption className="border-b border-white/10 px-3 py-2 text-xs text-slate-400">
          {language || "code"}
        </figcaption>
        <pre className="max-w-full overflow-x-auto p-4 text-sm leading-6 text-slate-100">
          <code>{raw}</code>
        </pre>
      </figure>
    );
  },
  h1({ children }) {
    return <h1 className="mt-6 text-2xl font-semibold leading-9 text-[#111827] first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mt-5 text-xl font-semibold leading-8 text-[#111827] first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mt-4 text-lg font-semibold leading-7 text-[#111827] first:mt-0">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mt-4 text-base font-semibold leading-7 text-[#111827] first:mt-0">{children}</h4>;
  },
  hr() {
    return <hr className="my-5 border-[#e5e7eb]" />;
  },
  img({ alt }) {
    return (
      <span className="inline-flex max-w-full rounded-lg border border-dashed border-[#d1d5db] bg-[#f9fafb] px-2 py-1 text-xs text-[#6b7280]">
        Image omitted{alt ? `: ${alt}` : ""}
      </span>
    );
  },
  li({ children, className }) {
    return <li className={`my-1 pl-1 ${className ?? ""}`}>{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-3 break-words leading-7 first:mt-0 last:mb-0">{children}</p>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-[#e5e7eb]">
        <table className="w-full min-w-max border-collapse text-sm">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-[#e5e7eb]">{children}</tbody>;
  },
  td({ children }) {
    return <td className="border-r border-[#e5e7eb] px-3 py-2 align-top last:border-r-0">{children}</td>;
  },
  th({ children }) {
    return <th className="border-r border-[#d1d5db] bg-[#f9fafb] px-3 py-2 text-left font-semibold last:border-r-0">{children}</th>;
  },
  thead({ children }) {
    return <thead className="border-b border-[#d1d5db]">{children}</thead>;
  },
  ul({ children }) {
    return <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>;
  },
};

export function MarkdownRenderer({ text, className = "" }: { text: string; className?: string }) {
  const segments = splitThinkingSegments(stripLeadingTimestamp(text));
  return (
    <div className={`markdown-body max-w-full break-words text-[15px] leading-7 text-[#1f2937] ${className}`}>
      {segments.map((segment, index) =>
        segment.kind === "thinking" ? (
          <ThinkingDisclosure key={index} label={segment.label} text={segment.text} />
        ) : (
          <MarkdownBody key={index} text={segment.text} />
        ),
      )}
    </div>
  );
}

export function ThinkingDisclosure({ label, text }: { label: string; text: string }) {
  return (
    <details className="my-3 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[#4b5563]">
      <summary className="min-h-8 cursor-pointer select-none text-sm font-medium text-[#374151]">
        {label}
      </summary>
      {text.trim() ? <MarkdownBody text={text} className="mt-3 text-sm" /> : null}
    </details>
  );
}

export function stripLeadingTimestamp(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor]?.trim()) {
    cursor += 1;
  }
  if (cursor < lines.length && LEADING_TIMESTAMP_RE.test(stripQuote(lines[cursor] ?? "").trim())) {
    lines.splice(cursor, 1);
  }
  return lines.join("\n").replace(/^\n+/, "");
}

function MarkdownBody({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) {
    return null;
  }
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={markdownComponents}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function splitThinkingSegments(text: string): MarkdownSegment[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const early = findAssistantOpeningThinking(lines);
  if (early) {
    const thinkingText = lines.slice(0, early.index + 1).join("\n").trim();
    const answerText = lines.slice(early.index + 1).join("\n").trim();
    return [
      { kind: "thinking", label: thinkingLabel(early.duration), text: thinkingText },
      ...(answerText ? [{ kind: "markdown" as const, text: answerText }] : []),
    ];
  }

  const markerOnly = findMarkerFirstThinking(lines);
  if (markerOnly) {
    const before = lines.slice(0, markerOnly.start).join("\n").trim();
    const thinking = lines.slice(markerOnly.start, markerOnly.end + 1).join("\n").trim();
    const after = lines.slice(markerOnly.end + 1).join("\n").trim();
    return [
      ...(before ? [{ kind: "markdown" as const, text: before }] : []),
      { kind: "thinking", label: thinkingLabel(markerOnly.duration), text: thinking },
      ...(after ? [{ kind: "markdown" as const, text: after }] : []),
    ];
  }

  return text.trim() ? [{ kind: "markdown", text }] : [];
}

function findAssistantOpeningThinking(lines: string[]): { index: number; duration: string | null } | null {
  let scannedChars = 0;
  const scanLimit = Math.min(lines.length, MAX_THINKING_SCAN_LINES);
  for (let index = 0; index < scanLimit; index += 1) {
    const stripped = stripQuote(lines[index] ?? "").trim();
    scannedChars += stripped.length;
    if (scannedChars > MAX_THINKING_SCAN_CHARS) {
      return null;
    }
    const match = stripped.match(THINKING_DURATION_RE);
    if (match) {
      return { index, duration: match[1] ?? null };
    }
    if (index > 0 && ANSWER_START_RE.test(stripped)) {
      return null;
    }
  }
  return null;
}

function findMarkerFirstThinking(lines: string[]): { start: number; end: number; duration: string | null } | null {
  for (let index = 0; index < Math.min(lines.length, 8); index += 1) {
    const marker = parseThinkingMarker(lines[index] ?? "");
    if (!marker) {
      if (stripQuote(lines[index] ?? "").trim()) {
        return null;
      }
      continue;
    }
    let end = index;
    while (end + 1 < lines.length) {
      const next = stripQuote(lines[end + 1] ?? "").trim();
      if (!next || ANSWER_START_RE.test(next)) {
        break;
      }
      end += 1;
    }
    return { start: index, end, duration: marker.duration };
  }
  return null;
}

function parseThinkingMarker(line: string): { duration: string | null } | null {
  const normalized = stripQuote(line).trim();
  const duration = normalized.match(THINKING_DURATION_RE);
  if (duration) {
    return { duration: duration[1] ?? null };
  }
  if (THINKING_LABEL_RE.test(normalized)) {
    return { duration: null };
  }
  return null;
}

function thinkingLabel(duration: string | null): string {
  return duration ? `思考过程 · ${duration.replace(/\s+/g, " ")}` : "思考过程";
}

function stripQuote(line: string): string {
  return line.replace(/^\s*>\s?/, "");
}

function parseCallout(text: string): { type: string; label: string; body: string } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const marker = lines[0]?.trim().match(/^\[!(NOTE|TIP|INFO|WARNING|IMPORTANT|CAUTION|DANGER|QUESTION|TODO)\]\s*(.*)$/i);
  if (!marker) {
    return null;
  }
  const type = marker[1]?.toLowerCase() ?? "note";
  const customTitle = marker[2]?.trim();
  return {
    type,
    label: customTitle || calloutLabel(type),
    body: lines.slice(1).join("\n").trim(),
  };
}

function calloutLabel(type: string): string {
  const labels: Record<string, string> = {
    caution: "Caution",
    danger: "Danger",
    important: "Important",
    info: "Info",
    note: "Note",
    question: "Question",
    tip: "Tip",
    todo: "Todo",
    warning: "Warning",
  };
  return labels[type] ?? "Note";
}

function calloutClassName(type: string): string {
  if (type === "warning" || type === "caution" || type === "danger") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (type === "tip" || type === "todo") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (type === "important") {
    return "border-purple-200 bg-purple-50 text-purple-950";
  }
  return "border-sky-200 bg-sky-50 text-sky-950";
}

function collectNodeText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const value = "value" in node ? (node as { value?: unknown }).value : undefined;
  if (typeof value === "string") {
    return value;
  }
  const children = "children" in node ? (node as { children?: unknown }).children : undefined;
  if (!Array.isArray(children)) {
    return "";
  }
  return children.map((child) => collectNodeText(child)).join("");
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|#|\/(?!\/))/i.test(href);
}
