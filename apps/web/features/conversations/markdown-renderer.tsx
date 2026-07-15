"use client";

import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";
import { useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { BundledLanguage, ThemedToken } from "shiki";

const SHIKI_LANGUAGES: BundledLanguage[] = [
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "powershell",
  "python",
  "sql",
  "tsx",
  "typescript",
  "yaml",
];
const shikiTokenCache = new Map<string, ThemedToken[][]>();
let shikiHighlighterPromise: ReturnType<typeof createCachedHighlighter> | null = null;

type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "thinking"; label: string; text: string };

type CanonicalTextPart = {
  type: "text";
  text: string;
};

type CanonicalReasoningPart = {
  type: "reasoning";
  label: string;
  text: string;
};

export type CanonicalSourcePart = {
  type: "source";
  title: string;
  url?: string;
  snippet?: string;
};

export type CanonicalToolPart = {
  type: "tool";
  name: string;
  status?: string;
  result?: unknown;
};

export type CanonicalFilePart = {
  type: "file";
  name: string;
  url?: string;
  mimeType?: string;
};

export type CanonicalImagePart = {
  type: "image";
  alt?: string;
  url?: string;
};

export type CanonicalMessagePart =
  | CanonicalTextPart
  | CanonicalReasoningPart
  | CanonicalSourcePart
  | CanonicalToolPart
  | CanonicalFilePart
  | CanonicalImagePart;

const THINKING_LABEL = "思考过程";
const LEADING_TIMESTAMP_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const LEADING_TIMESTAMP_PREFIX_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s+/;
const THINKING_DURATION_RE =
  /^(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*((?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))$/i;
const THINKING_LABEL_RE = /^(?:思考|思考过程|thinking|reasoning)\s*[:：]?\s*$/i;
const ANSWER_START_RE = /^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|正式回答|final answer|answer)\s*[:：])/i;
const MAX_THINKING_SCAN_LINES = 40;
const MAX_THINKING_SCAN_CHARS = 4000;

const TRACE_PREFIXES = [
  "考虑",
  "分析",
  "整理",
  "搜索",
  "检索",
  "浏览",
  "查找",
  "提炼",
  "规划",
  "总结",
];

const markdownComponents: Components & {
  CodeHeader?: React.ComponentType<CodeHeaderProps>;
  SyntaxHighlighter?: React.ComponentType<SyntaxHighlighterProps>;
} = {
  a({ href, children }) {
    const safeHref = typeof href === "string" && isSafeHref(href) ? href : undefined;
    if (!safeHref) {
      return <span className="text-[#374151]">{children}</span>;
    }
    return (
      <a
        href={safeHref}
        target={safeHref.startsWith("#") || safeHref.startsWith("/") ? undefined : "_blank"}
        rel={safeHref.startsWith("#") || safeHref.startsWith("/") ? undefined : "noreferrer"}
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
          <AssistantMarkdownPart text={callout.body} className="text-sm" />
        </div>
      );
    }
    return (
      <blockquote className="my-4 border-l-4 border-[#cbd5e1] bg-[#f8fafc] py-1 pl-4 text-[#475569]">
        {children}
      </blockquote>
    );
  },
  CodeHeader: CodeHeader,
  SyntaxHighlighter: CodeOrMermaidBlock,
  code({ children }) {
    return <code className="rounded bg-[#eef2f7] px-1.5 py-0.5 font-mono text-[0.9em] text-[#0f172a]">{children}</code>;
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
  img({ alt, src }) {
    const safeSrc = typeof src === "string" && isSafeHref(src) ? src : undefined;
    return (
      <span className="my-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed border-[#d1d5db] bg-[#f9fafb] px-2 py-1 text-xs text-[#6b7280]">
        图片附件
        {alt ? <span className="truncate">{alt}</span> : null}
        {safeSrc ? (
          <a href={safeSrc} target="_blank" rel="noreferrer" className="text-[#0f766e] underline">
            打开
          </a>
        ) : null}
      </span>
    );
  },
  input({ checked, type }) {
    if (type !== "checkbox") {
      return <input type={type} checked={checked} readOnly />;
    }
    return (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        className="mr-2 h-4 w-4 rounded border-[#cbd5e1] align-[-2px] accent-[#10a37f]"
      />
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
    return <pre className="max-w-full overflow-x-auto rounded-b-xl border border-t-0 border-[#111827] bg-[#0f172a] p-4 text-sm leading-6 text-slate-100">{children}</pre>;
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

export function MarkdownRenderer({
  text,
  className = "",
  isAssistant = true,
}: {
  text: string;
  className?: string;
  isAssistant?: boolean;
}) {
  const parts = useMemo(() => canonicalMessagePartsFromText(text, isAssistant), [isAssistant, text]);
  return (
    <div className={`aui-chat-markdown max-w-full break-words text-[15px] leading-7 text-[#1f2937] ${className}`}>
      {parts.map((part, index) => (
        <CanonicalPartRenderer key={`${part.type}-${index}`} part={part} />
      ))}
    </div>
  );
}

export function ThinkingDisclosure({ label, text }: { label: string; text: string }) {
  return (
    <details className="my-3 rounded-xl border border-[#d8dee9] bg-[#f8fafc] px-4 py-3 text-[#475569]">
      <summary className="min-h-8 cursor-pointer select-none text-sm font-medium text-[#334155]">
        {label}
      </summary>
      {text.trim() ? <AssistantMarkdownPart text={text} className="mt-3 text-sm" /> : null}
    </details>
  );
}

export function AssistantMarkdownPart({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) {
    return null;
  }
  return (
    <TextMessagePartProvider text={text}>
      <MarkdownTextPrimitive
        className={className}
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={markdownComponents}
        componentsByLanguage={{ mermaid: { SyntaxHighlighter: MermaidDiagram, CodeHeader: MermaidCodeHeader } }}
        skipHtml
      />
    </TextMessagePartProvider>
  );
}

export function stripLeadingTimestamp(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor]?.trim()) {
    cursor += 1;
  }
  if (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    const strippedLine = stripQuote(line).trim();
    if (LEADING_TIMESTAMP_RE.test(strippedLine)) {
      lines.splice(cursor, 1);
    } else {
      const nextLine = strippedLine.replace(LEADING_TIMESTAMP_PREFIX_RE, "").trimStart();
      if (nextLine !== strippedLine) {
        lines[cursor] = nextLine;
      }
    }
  }
  return lines.join("\n").replace(/^\n+/, "");
}

export function canonicalMessagePartsFromText(text: string, isAssistant = true): CanonicalMessagePart[] {
  const cleanText = stripLeadingTimestamp(text);
  const segments = isAssistant ? splitThinkingSegments(cleanText) : cleanText.trim() ? [{ kind: "markdown" as const, text: cleanText }] : [];
  return segments.map((segment) =>
    segment.kind === "thinking"
      ? { type: "reasoning", label: segment.label, text: segment.text }
      : { type: "text", text: segment.text },
  );
}

function CanonicalPartRenderer({ part }: { part: CanonicalMessagePart }) {
  if (part.type === "reasoning") {
    return <ThinkingDisclosure label={part.label} text={part.text} />;
  }
  if (part.type === "text") {
    return <AssistantMarkdownPart text={part.text} />;
  }
  if (part.type === "source") {
    return <CitationPart part={part} />;
  }
  if (part.type === "tool") {
    return <ToolPart part={part} />;
  }
  if (part.type === "file") {
    return <AttachmentPart name={part.name} detail={part.mimeType} url={part.url} />;
  }
  return <AttachmentPart name={part.alt ?? "图片附件"} detail="image" url={part.url} />;
}

function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-t-xl border border-[#111827] border-b-white/10 bg-[#0f172a] px-3 py-2 text-xs text-slate-400 first:mt-0">
      <span className="min-w-0 truncate">{language || "text"}</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded-md border border-white/10 px-2 py-1 text-slate-200 transition hover:bg-white/10"
      >
        {copied ? "已复制" : "复制代码"}
      </button>
    </div>
  );
}

function MermaidCodeHeader({ code }: CodeHeaderProps) {
  return <CodeHeader language="mermaid" code={code} />;
}

function CodeOrMermaidBlock(props: SyntaxHighlighterProps) {
  if (props.language.toLowerCase() === "mermaid") {
    return <MermaidDiagram {...props} />;
  }
  return <ShikiCodeBlock {...props} />;
}

function ShikiCodeBlock({ language, code }: SyntaxHighlighterProps) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function highlight() {
      try {
        const lang = normalizeLanguage(language);
        if (!lang) {
          setTokens(null);
          setFailed(true);
          return;
        }
        const result = await getShikiTokens(lang, code);
        if (!cancelled) {
          setTokens(result);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setTokens(null);
          setFailed(true);
        }
      }
    }
    highlight();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (tokens && !failed) {
    return (
      <pre className="max-w-full overflow-x-auto rounded-b-xl border border-t-0 border-[#111827] bg-[#0f172a] p-4 text-sm leading-6 text-slate-100">
        <code>
          {tokens.map((line, lineIndex) => (
            <span key={lineIndex} className="block min-h-[1.5rem]">
              {line.map((token, tokenIndex) => (
                <span key={`${lineIndex}-${tokenIndex}`} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    );
  }

  return (
    <pre className="max-w-full overflow-x-auto rounded-b-xl border border-t-0 border-[#111827] bg-[#0f172a] p-4 text-sm leading-6 text-slate-100">
      <code>{code}</code>
    </pre>
  );
}

async function getShikiTokens(language: BundledLanguage, code: string): Promise<ThemedToken[][]> {
  const key = `${language}:${hashCode(code)}`;
  const cached = shikiTokenCache.get(key);
  if (cached) {
    return cached;
  }
  shikiHighlighterPromise ??= createCachedHighlighter();
  const highlighter = await shikiHighlighterPromise;
  const result = highlighter.codeToTokens(code, { lang: language, theme: "github-dark" }).tokens;
  if (shikiTokenCache.size >= 300) {
    const oldestKey = shikiTokenCache.keys().next().value;
    if (oldestKey) {
      shikiTokenCache.delete(oldestKey);
    }
  }
  shikiTokenCache.set(key, result);
  return result;
}

async function createCachedHighlighter() {
  const { createHighlighter } = await import("shiki");
  return createHighlighter({ themes: ["github-dark"], langs: SHIKI_LANGUAGES });
}

function hashCode(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function MermaidDiagram({ code }: SyntaxHighlighterProps) {
  const [svgUri, setSvgUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function renderMermaid() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#f8fafc",
            primaryTextColor: "#111827",
            primaryBorderColor: "#cbd5e1",
            lineColor: "#64748b",
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvgUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
          setError(null);
        }
      } catch (event) {
        if (!cancelled) {
          setSvgUri(null);
          setError(event instanceof Error ? event.message : "Mermaid render failed.");
        }
      }
    }
    renderMermaid();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (svgUri) {
    return (
      <div className="overflow-x-auto rounded-b-xl border border-t-0 border-[#d8dee9] bg-[#f8fafc] p-4">
        <img src={svgUri} alt="Mermaid diagram" className="mx-auto max-w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 rounded-b-xl border border-t-0 border-[#111827] bg-[#0f172a] p-4">
        <p className="text-xs text-amber-300">Mermaid 渲染失败，已回退为源码。</p>
        <pre className="max-w-full overflow-x-auto text-sm leading-6 text-slate-100">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div className="rounded-b-xl border border-t-0 border-[#111827] bg-[#0f172a] p-4 text-sm text-slate-300">正在渲染 Mermaid 图表...</div>;
}

function CitationPart({ part }: { part: CanonicalSourcePart }) {
  return (
    <div className="my-3 rounded-xl border border-[#d8dee9] bg-white px-4 py-3 text-sm shadow-sm">
      <div className="font-semibold text-[#111827]">{part.title}</div>
      {part.snippet ? <p className="mt-1 leading-6 text-[#475569]">{part.snippet}</p> : null}
      {part.url && isSafeHref(part.url) ? (
        <a href={part.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-[#0f766e] underline">
          来源链接
        </a>
      ) : null}
    </div>
  );
}

function ToolPart({ part }: { part: CanonicalToolPart }) {
  return (
    <div className="my-3 rounded-xl border border-[#d8dee9] bg-[#f8fafc] px-4 py-3 text-sm text-[#475569]">
      <div className="font-semibold text-[#111827]">工具结果 · {part.name}</div>
      {part.status ? <div className="mt-1 text-xs text-[#64748b]">{part.status}</div> : null}
      {part.result !== undefined ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-white p-3 text-xs">{JSON.stringify(part.result, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function AttachmentPart({ name, detail, url }: { name: string; detail?: string; url?: string }) {
  const safeUrl = url && isSafeHref(url) ? url : undefined;
  return (
    <div className="my-3 flex max-w-full items-center justify-between gap-3 rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm text-[#475569]">
      <div className="min-w-0">
        <div className="truncate font-medium text-[#111827]">{name}</div>
        {detail ? <div className="text-xs text-[#64748b]">{detail}</div> : null}
      </div>
      {safeUrl ? (
        <a href={safeUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[#0f766e] underline">
          打开
        </a>
      ) : null}
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

function normalizeLanguage(language: string): BundledLanguage | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "plaintext") {
    return null;
  }
  const aliases: Record<string, BundledLanguage> = {
    js: "javascript",
    md: "markdown",
    py: "python",
    shell: "bash",
    ts: "typescript",
    yml: "yaml",
  };
  return aliases[normalized] ?? (normalized as BundledLanguage);
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|#|\/(?!\/))/i.test(href);
}
