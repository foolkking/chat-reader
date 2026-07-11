import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "thinking"; label: string; text: string };

const THINKING_LABEL = "\u601d\u8003\u8fc7\u7a0b";
const LEADING_TIMESTAMP_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const THINKING_DURATION_RE =
  /^(?:(?:\u5df2\s*)?\u601d\u8003(?:\u4e86)?|thinking|reasoning)\s*[:\uff1a]?\s*((?:\d+\s*(?:h|hr|hour|\u5c0f\u65f6)\s*)?(?:\d+\s*(?:m|min|\u5206\u949f|\u5206)\s*)?\d+\s*(?:s|sec|\u79d2))$/i;
const THINKING_LABEL_RE = /^(?:\u601d\u8003|\u601d\u8003\u8fc7\u7a0b|thinking|reasoning)\s*[:\uff1a]?\s*$/i;
const ANSWER_START_RE =
  /^(?:#{1,6}\s+\S+|(?:\u7b54\u6848|\u56de\u7b54|\u7ed3\u8bba|\u6700\u7ec8\u56de\u7b54|\u6b63\u5f0f\u56de\u7b54|final answer|answer)\s*[:\uff1a])/i;
const MAX_THINKING_SCAN_LINES = 40;
const MAX_THINKING_SCAN_CHARS = 4000;

const TRACE_PREFIXES = [
  "\u8003\u8651",
  "\u5206\u6790",
  "\u6574\u7406",
  "\u641c\u7d22",
  "\u68c0\u7d22",
  "\u6d4f\u89c8",
  "\u67e5\u627e",
  "\u63d0\u70bc",
  "\u89c4\u5212",
  "\u603b\u7ed3",
];

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
        <div className={`my-4 rounded-xl border px-4 py-3 shadow-sm ${calloutClassName(callout.type)}`}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-normal">{callout.label}</div>
          <MarkdownBody text={callout.body} />
        </div>
      );
    }
    return (
      <blockquote className="my-4 border-l-4 border-[#cbd5e1] bg-[#f8fafc] py-1 pl-4 text-[#475569]">
        {children}
      </blockquote>
    );
  },
  code({ className, children }) {
    const raw = String(children).replace(/\n$/, "");
    const languageMatch = /language-([A-Za-z0-9_-]+)/.exec(className ?? "");
    const language = languageMatch?.[1] ?? "";
    const isBlock = Boolean(language) || raw.includes("\n");

    if (!isBlock) {
      return <code className="rounded bg-[#eef2f7] px-1.5 py-0.5 font-mono text-[0.9em] text-[#0f172a]">{children}</code>;
    }

    return (
      <figure className="my-4 max-w-full overflow-hidden rounded-xl border border-[#111827] bg-[#0f172a] shadow-sm">
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
    return <h1 className="mt-7 border-l-4 border-[#10a37f] pl-3 text-2xl font-semibold leading-9 text-[#111827] first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mt-6 border-l-4 border-[#a7f3d0] pl-3 text-xl font-semibold leading-8 text-[#111827] first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mt-5 text-lg font-semibold leading-7 text-[#111827] first:mt-0">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mt-4 text-base font-semibold leading-7 text-[#111827] first:mt-0">{children}</h4>;
  },
  hr() {
    return <hr className="my-6 border-[#e5e7eb]" />;
  },
  img({ alt }) {
    return (
      <span className="inline-flex max-w-full rounded-lg border border-dashed border-[#d1d5db] bg-[#f9fafb] px-2 py-1 text-xs text-[#6b7280]">
        Image omitted{alt ? `: ${alt}` : ""}
      </span>
    );
  },
  li({ children, className }) {
    return <li className={`my-1.5 pl-1 marker:text-[#94a3b8] ${className ?? ""}`}>{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-3 break-words leading-7 first:mt-0 last:mb-0">{children}</p>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-[#d8dee9] bg-white">
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
    return <th className="border-r border-[#d1d5db] bg-[#f8fafc] px-3 py-2 text-left font-semibold last:border-r-0">{children}</th>;
  },
  thead({ children }) {
    return <thead className="border-b border-[#d1d5db]">{children}</thead>;
  },
  ul({ children }) {
    return <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>;
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
    <details className="my-3 rounded-xl border border-[#d8dee9] bg-[#f8fafc] px-4 py-3 text-[#475569]">
      <summary className="min-h-8 cursor-pointer select-none text-sm font-medium text-[#334155]">
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
  const opening = findOpeningThinking(lines);
  if (opening) {
    const thinkingText = lines.slice(0, opening.index + 1).join("\n").trim();
    const answerText = lines.slice(opening.index + 1).join("\n").trim();
    return [
      { kind: "thinking", label: thinkingLabel(opening.duration), text: thinkingText },
      ...(answerText ? [{ kind: "markdown" as const, text: answerText }] : []),
    ];
  }
  return text.trim() ? [{ kind: "markdown", text }] : [];
}

function findOpeningThinking(lines: string[]): { index: number; duration: string | null } | null {
  let scannedChars = 0;
  for (let index = 0; index < Math.min(lines.length, MAX_THINKING_SCAN_LINES); index += 1) {
    const raw = lines[index] ?? "";
    const normalized = stripQuote(raw).trim();
    scannedChars += normalized.length;
    if (scannedChars > MAX_THINKING_SCAN_CHARS) {
      return null;
    }
    if (!normalized) {
      continue;
    }
    if (ANSWER_START_RE.test(normalized)) {
      return null;
    }
    const duration = normalized.match(THINKING_DURATION_RE);
    if (duration && prefixLooksLikeThinkingTrace(lines.slice(0, index))) {
      return { index, duration: duration[1] ?? null };
    }
    if (!lineLooksLikeThinkingTrace(raw, normalized)) {
      return null;
    }
  }
  return null;
}

function prefixLooksLikeThinkingTrace(lines: string[]): boolean {
  const meaningful = lines
    .map((line) => ({ raw: line.trim(), normalized: stripQuote(line).trim() }))
    .filter((line) => line.normalized.length > 0);
  if (meaningful.length === 0) {
    return true;
  }
  return meaningful.every((line) => lineLooksLikeThinkingTrace(line.raw, line.normalized));
}

function lineLooksLikeThinkingTrace(raw: string, normalized: string): boolean {
  if (LEADING_TIMESTAMP_RE.test(normalized) || THINKING_LABEL_RE.test(normalized)) {
    return true;
  }
  if (raw.trim().startsWith(">") && normalized.length <= 180) {
    return true;
  }
  if (TRACE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) && normalized.length <= 120) {
    return true;
  }
  if (normalized.startsWith("[") || normalized.startsWith("- ") || normalized.startsWith("* ") || /^\d+[.)]\s+/.test(normalized)) {
    return true;
  }
  if (normalized.includes("http://") || normalized.includes("https://") || normalized.includes("](")) {
    return true;
  }
  return false;
}

function thinkingLabel(duration: string | null): string {
  return duration ? `${THINKING_LABEL} · ${duration.replace(/\s+/g, " ")}` : THINKING_LABEL;
}

function stripQuote(line: string): string {
  let stripped = line.trim();
  while (stripped.startsWith(">")) {
    stripped = stripped.slice(1).trim();
  }
  return stripped;
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
