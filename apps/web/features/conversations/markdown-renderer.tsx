"use client";

import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";
import { memo, useEffect, useId, useMemo, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, Maximize2, Minimize2, WrapText } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import type { BundledLanguage, ThemedToken } from "shiki";
import {
  RICH_MARKDOWN_RENDERER_VERSION,
  richMarkdownRehypeOptions,
  richMarkdownRemarkPlugins,
  scopedRichMarkdownRehypePlugins,
} from "../rich-markdown/rich-markdown-config";

export type MarkdownTaskItem = {
  taskKey: string;
  checked: boolean;
  checkedOffset: number;
  label: string;
  ordinal: number;
};

const shikiTokenCache = new Map<string, ThemedToken[][]>();
let shikiHighlighterPromise: ReturnType<typeof createCachedHighlighter> | null = null;
const shikiLanguagePromises = new Map<BundledLanguage, Promise<void>>();

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
const MAX_THINKING_SCAN_CHARS = 8000;

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
  a({ href, children, node: _node, ...props }) {
    return <SafeMarkdownLink href={href} {...props}>{children}</SafeMarkdownLink>;
  },
  blockquote({ node, children }) {
    const rawText = collectNodeText(node);
    const callout = parseCallout(rawText);
    if (callout) {
      return (
        <div className={`markdown-callout border-l-4 px-4 py-3 ${calloutClassName(callout.type)}`}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-normal">{callout.label}</div>
          <AssistantMarkdownPart text={callout.body} className="text-[0.9em]" />
        </div>
      );
    }
    return (
      <blockquote className="border-l-2 border-[var(--quote-border)] py-0.5 pl-4 text-[var(--quote-text)]">
        {children}
      </blockquote>
    );
  },
  CodeHeader: EmptyCodeHeader,
  SyntaxHighlighter: CodeOrMermaidBlock,
  code({ children }) {
    return <code className="rounded-md border border-[var(--inline-code-border)] bg-[var(--inline-code-bg)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--inline-code-text)]">{children}</code>;
  },
  h1({ children, id, className }) {
    return <h1 id={id} className={`reader-heading reader-heading-1 border-b border-ui pb-2 font-semibold text-primary ${className ?? ""}`}>{children}</h1>;
  },
  h2({ children, id, className }) {
    if (className?.includes("sr-only")) return <h2 id={id} className={className}>{children}</h2>;
    return <h2 id={id} className={`reader-heading reader-heading-2 font-semibold text-primary ${className ?? ""}`}>{children}</h2>;
  },
  h3({ children, id, className }) {
    return <h3 id={id} className={`reader-heading reader-heading-3 font-semibold text-primary ${className ?? ""}`}>{children}</h3>;
  },
  h4({ children, id, className }) {
    return <h4 id={id} className={`reader-heading reader-heading-4 font-semibold text-primary ${className ?? ""}`}>{children}</h4>;
  },
  hr() {
    return <hr className="border-ui" />;
  },
  img({ alt, src }) {
    const safeSrc = typeof src === "string" && isSafeHref(src) ? src : undefined;
    return (
      <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed border-ui bg-[var(--attachment-bg)] px-2 py-1 text-[0.75em] text-secondary">
        图片附件
        {alt ? <span className="truncate">{alt}</span> : null}
        {safeSrc ? (
          <a href={safeSrc} target="_blank" rel="noreferrer" className="text-[var(--link)] underline">
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
        className="mr-2 h-4 w-4 rounded border-ui align-[-2px] accent-[var(--accent)]"
      />
    );
  },
  li({ children, className, node }) {
    const task = className?.includes("task-list-item") || hastContainsCheckbox(node);
    return <li className={`pl-[0.375em] marker:text-secondary ${task ? "list-none" : ""} ${className ?? ""}`}>{children}</li>;
  },
  ol({ children, start }) {
    return <ol start={start} className="list-decimal pl-[1.625em]">{children}</ol>;
  },
  p({ children }) {
    return <p className="break-words">{children}</p>;
  },
  pre({ children }) {
    return <pre className="max-w-full overflow-x-auto rounded-lg border border-ui bg-[var(--code-bg)] p-4 text-[0.875em] leading-[1.65] text-primary">{children}</pre>;
  },
  table({ children }) {
    return (
      <div className="markdown-table max-w-full overflow-x-auto rounded-lg border border-ui bg-surface">
        <table className="w-max min-w-full border-collapse text-[0.875em]">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-[var(--border)]">{children}</tbody>;
  },
  td({ children }) {
    return <td className="border-r border-ui px-3 py-2.5 align-top last:border-r-0">{children}</td>;
  },
  th({ children }) {
    return <th className="sticky top-0 border-r border-ui bg-[var(--table-header)] px-3 py-2.5 text-left font-semibold last:border-r-0">{children}</th>;
  },
  thead({ children }) {
    return <thead className="border-b border-ui">{children}</thead>;
  },
  ul({ children, className, node }) {
    const task = className?.includes("contains-task-list") || hastContainsCheckbox(node);
    return <ul className={`${task ? "list-none pl-0" : "list-disc pl-[1.625em]"} ${className ?? ""}`} data-markdown-task-list={task || undefined}>{children}</ul>;
  },
};

const inlineMarkdownComponents: Components = {
  a({ href, children }) {
    return <SafeMarkdownLink href={href}>{children}</SafeMarkdownLink>;
  },
  code({ children }) {
    return <code className="rounded border border-[var(--inline-code-border)] bg-[var(--inline-code-bg)] px-1 py-0.5 font-mono text-[0.88em] text-[var(--inline-code-text)]">{children}</code>;
  },
  img() {
    // A heading is navigation text, never a remote-image loading surface.
    return null;
  },
  p({ children }) {
    return <>{children}</>;
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
  className = "",
  isAssistant = true,
  taskItems = [],
  pendingTaskKeys,
  onTaskToggle,
  scopeId,
}: {
  text: string;
  className?: string;
  isAssistant?: boolean;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId?: string;
}) {
  const generatedScopeId = useId();
  const resolvedScopeId = scopeId ?? generatedScopeId;
  const parts = useMemo(() => canonicalMessagePartsFromText(text, isAssistant), [isAssistant, text]);
  const tasksByPart = useMemo(() => assignTasksToParts(parts, taskItems), [parts, taskItems]);
  return (
    <div className={`aui-chat-markdown max-w-full break-words text-primary ${className}`} data-rich-markdown-version={RICH_MARKDOWN_RENDERER_VERSION}>
      {parts.map((part, index) => (
        <CanonicalPartRenderer
          key={`${part.type}-${index}`}
          part={part}
          taskItems={tasksByPart[index] ?? []}
          pendingTaskKeys={pendingTaskKeys}
          onTaskToggle={onTaskToggle}
          scopeId={`${resolvedScopeId}-part-${index}`}
        />
      ))}
    </div>
  );
}, (previous, next) => previous.text === next.text
  && previous.className === next.className
  && previous.isAssistant === next.isAssistant
  && previous.scopeId === next.scopeId
  && previous.pendingTaskKeys === next.pendingTaskKeys
  && previous.taskItems === next.taskItems
  && previous.onTaskToggle === next.onTaskToggle);

export function InlineHeadingMarkdown({ text }: { text: string }) {
  const inlineText = text.replace(/\s*\r?\n\s*/g, " ").trim();
  return (
    <ReactMarkdown
      components={inlineMarkdownComponents}
      rehypePlugins={scopedRichMarkdownRehypePlugins("inline-heading")}
      remarkPlugins={richMarkdownRemarkPlugins()}
      remarkRehypeOptions={richMarkdownRehypeOptions("inline-heading")}
      skipHtml
    >
      {inlineText}
    </ReactMarkdown>
  );
}

export function markdownHeadingLabel(markdown: string): string {
  let text = markdown.replace(/\s*\r?\n\s*/g, " ").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    text = text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`]+?)`+/g, "$1")
      .replace(/\*\*([^*]+?)\*\*/g, "$1")
      .replace(/__([^_]+?)__/g, "$1")
      .replace(/~~([^~]+?)~~/g, "$1")
      .replace(/(^|\s)\*([^*]+?)\*(?=\s|$|[.,!?;:])/g, "$1$2")
      .replace(/(^|\s)_([^_]+?)_(?=\s|$|[.,!?;:])/g, "$1$2");
  }
  return text
    .replace(/^#{1,6}\s+/, "")
    .replace(/\\([\\`*_[\]{}()#+\-.!~>])/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ThinkingDisclosure({ label, text }: { label: string; text: string }) {
  return (
    <details className="reader-thinking rounded-xl border border-ui bg-[var(--reasoning-bg)] px-4 py-3 text-[var(--quote-text)]">
      <summary className="min-h-8 cursor-pointer select-none text-sm font-medium text-primary">
        {label}
      </summary>
      {text.trim() ? <AssistantMarkdownPart text={text} className="reader-thinking-content text-[0.875em]" /> : null}
    </details>
  );
}

export function AssistantMarkdownPart({
  text,
  className = "",
  taskItems = [],
  pendingTaskKeys,
  onTaskToggle,
  scopeId,
}: {
  text: string;
  className?: string;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId?: string;
}) {
  const generatedScopeId = useId();
  const resolvedScopeId = scopeId ?? generatedScopeId;
  if (!text.trim()) {
    return null;
  }
  const interactiveComponents = createTaskAwareComponents(taskItems, pendingTaskKeys, onTaskToggle);
  const taskPlugin = taskItems.length > 0 ? remarkTaskKeys(taskItems) : null;
  if (onTaskToggle && taskItems.length > 0) {
    return (
      <div className={`reader-prose ${className}`}>
        <ReactMarkdown
          components={interactiveComponents as Components}
          remarkPlugins={richMarkdownRemarkPlugins(taskPlugin ? [taskPlugin] : [])}
          rehypePlugins={scopedRichMarkdownRehypePlugins(resolvedScopeId)}
          remarkRehypeOptions={richMarkdownRehypeOptions(resolvedScopeId)}
          skipHtml
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <TextMessagePartProvider text={text}>
      <MarkdownTextPrimitive
        className={`reader-prose ${className}`}
        remarkPlugins={richMarkdownRemarkPlugins(taskPlugin ? [taskPlugin] : [])}
        rehypePlugins={scopedRichMarkdownRehypePlugins(resolvedScopeId)}
        remarkRehypeOptions={richMarkdownRehypeOptions(resolvedScopeId)}
        components={interactiveComponents}
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

function CanonicalPartRenderer({
  part,
  taskItems,
  pendingTaskKeys,
  onTaskToggle,
  scopeId,
}: {
  part: CanonicalMessagePart;
  taskItems: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId: string;
}) {
  if (part.type === "reasoning") {
    return <ThinkingDisclosure label={part.label} text={part.text} />;
  }
  if (part.type === "text") {
    return <AssistantMarkdownPart text={part.text} taskItems={taskItems} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} scopeId={scopeId} />;
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

type MarkdownAstNode = {
  type?: string;
  checked?: boolean | null;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownAstNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function remarkTaskKeys(taskItems: MarkdownTaskItem[]) {
  return () => (tree: MarkdownAstNode) => {
    let taskIndex = 0;
    const walk = (node: MarkdownAstNode) => {
      if (node.type === "listItem" && typeof node.checked === "boolean") {
        const task = taskItems[taskIndex];
        taskIndex += 1;
        if (task) {
          node.data = node.data ?? {};
          node.data.hProperties = { ...(node.data.hProperties ?? {}), "data-task-key": task.taskKey };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

function createTaskAwareComponents(
  taskItems: MarkdownTaskItem[],
  pendingTaskKeys?: ReadonlySet<string>,
  onTaskToggle?: (taskKey: string, checked: boolean) => void,
): typeof markdownComponents {
  if (!onTaskToggle || taskItems.length === 0) return markdownComponents;
  const taskByKey = new Map(taskItems.map((task) => [task.taskKey, task]));
  let taskCursor = 0;
  return {
    ...markdownComponents,
    input({ node, checked, type }) {
      if (type !== "checkbox") {
        return <input type={type} checked={checked} readOnly />;
      }
      const task = taskForListNode(node, taskItems) ?? taskItems[taskCursor++];
      const pending = Boolean(task && pendingTaskKeys?.has(task.taskKey));
      if (task) {
        return (
          <button
            type="button"
            role="checkbox"
            aria-checked={task.checked}
            aria-label={task.label || "Markdown task"}
            disabled={pending}
            className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded border border-ui align-[-2px] text-[var(--surface)] enabled:cursor-pointer disabled:opacity-60"
            style={{ background: task.checked ? "var(--accent)" : "var(--surface)" }}
            onClick={() => onTaskToggle(task.taskKey, !task.checked)}
          >
            {task.checked ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
          </button>
        );
      }
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          readOnly
          className="mr-2 h-4 w-4 rounded border-ui align-[-2px] accent-[var(--accent)]"
        />
      );
    },
    li({ node, children, className }) {
      const rawKey = node?.properties?.["data-task-key"];
      const taskKey = typeof rawKey === "string" ? rawKey : null;
      const task = (taskKey ? taskByKey.get(taskKey) : undefined) ?? taskForListNode(node, taskItems);
      const resolvedTaskKey = task?.taskKey ?? taskKey;
      const pending = Boolean(resolvedTaskKey && pendingTaskKeys?.has(resolvedTaskKey));
      return (
        <li
          className={`pl-[0.375em] marker:text-secondary ${task ? "task-list-interactive list-none" : ""} ${pending ? "opacity-60" : ""} ${className ?? ""}`}
          data-task-key={resolvedTaskKey ?? undefined}
          aria-busy={pending || undefined}
        >
          {children}
        </li>
      );
    },
  };
}

function taskForListNode(
  node: { position?: { start?: { offset?: number }; end?: { offset?: number } } } | undefined,
  tasks: MarkdownTaskItem[],
): MarkdownTaskItem | undefined {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return tasks.find((task) => task.checkedOffset >= start && task.checkedOffset <= end);
}

function assignTasksToParts(parts: CanonicalMessagePart[], tasks: MarkdownTaskItem[]): MarkdownTaskItem[][] {
  const remaining = [...tasks];
  return parts.map((part) => {
    if (part.type !== "text") return [];
    const local = extractMarkdownTaskItems(part.text);
    return local.map((candidate) => {
      const index = remaining.findIndex((task) => task.label === candidate.label && task.checked === candidate.checked);
      if (index < 0) return candidate;
      return remaining.splice(index, 1)[0];
    });
  });
}

export function extractMarkdownTaskItems(text: string): MarkdownTaskItem[] {
  const items: MarkdownTaskItem[] = [];
  const duplicateCounts = new Map<string, number>();
  let inCode = false;
  let fenceCharacter = "";
  let fenceLength = 0;
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const lineMatch of text.matchAll(linePattern)) {
    const sourceLine = lineMatch[0];
    if (!sourceLine) break;
    const line = sourceLine.replace(/(?:\r\n|\r|\n)$/, "");
    const stripped = line.trim();
    if (inCode) {
      let closingLength = 0;
      while (stripped[closingLength] === fenceCharacter) closingLength += 1;
      if (stripped.startsWith(fenceCharacter) && closingLength >= fenceLength && stripped.slice(closingLength).trim() === "") {
        inCode = false;
      }
      continue;
    }
    const fence = stripped.match(/^(`{3,}|~{3,})/);
    if (fence) {
      inCode = true;
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      continue;
    }
    const task = line.match(/^(\s*[-+*]\s+)\[([ xX])\]((?:\s+.*)?)$/);
    if (!task) continue;
    const label = task[3].trim();
    const digest = stableTaskDigest(label.replace(/\s+/g, " ").trim());
    const occurrence = (duplicateCounts.get(digest) ?? 0) + 1;
    duplicateCounts.set(digest, occurrence);
    const checkedIndex = line.indexOf("[", task[1].length - 1) + 1;
    items.push({
      taskKey: `task-${digest}-${occurrence}`,
      checked: task[2].toLowerCase() === "x",
      checkedOffset: (lineMatch.index ?? 0) + checkedIndex,
      label,
      ordinal: items.length,
    });
  }
  return items;
}

function stableTaskDigest(value: string): string {
  let digest = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    digest ^= byte;
    digest = Math.imul(digest, 16777619) >>> 0;
  }
  return digest.toString(16).padStart(8, "0");
}

function EmptyCodeHeader(_: CodeHeaderProps) {
  return null;
}

function SafeMarkdownLink({ href, children, ...props }: { href?: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">) {
  const safeHref = typeof href === "string" && isSafeHref(href) ? href : undefined;
  if (!safeHref) {
    return <span className="text-secondary">{children}</span>;
  }
  const local = safeHref.startsWith("#") || safeHref.startsWith("/");
  return (
    <a
      href={safeHref}
      {...props}
      target={local ? undefined : "_blank"}
      rel={local ? undefined : "noopener noreferrer"}
      className="font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-2 hover:text-[var(--link-hover)]"
    >
      {children}
    </a>
  );
}

function MermaidCodeHeader(_: CodeHeaderProps) {
  return null;
}

function CodeOrMermaidBlock(props: SyntaxHighlighterProps) {
  if (props.language.toLowerCase() === "mermaid") {
    return <MermaidDiagram {...props} />;
  }
  return <ShikiCodeBlock {...props} />;
}

function ShikiCodeBlock({ language, code }: SyntaxHighlighterProps) {
  const { resolvedTheme } = usePreferences();
  const containerRef = useRef<HTMLElement | null>(null);
  const [shouldHighlight, setShouldHighlight] = useState(false);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const longCode = code.split("\n").length > 80;

  useEffect(() => {
    const target = containerRef.current;
    if (!target || shouldHighlight) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldHighlight(true);
        observer.disconnect();
      },
      { rootMargin: "320px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldHighlight]);

  useEffect(() => {
    if (!shouldHighlight) return undefined;
    let cancelled = false;
    async function highlight() {
      try {
        const lang = normalizeLanguage(language);
        if (!lang) {
          setTokens(null);
          setFailed(true);
          return;
        }
        const result = await getShikiTokens(lang, code, resolvedTheme);
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
  }, [code, language, resolvedTheme, shouldHighlight]);

  return (
    <section ref={containerRef} className="reader-code-block max-w-full overflow-hidden rounded-lg border border-ui bg-[var(--code-bg)]">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-ui bg-subtle px-3 text-xs text-secondary">
        <span className="min-w-0 truncate font-mono">{language || "text"}</span>
        <div className="flex items-center gap-1">
          <CodeAction title={wrapped ? "Disable line wrapping" : "Wrap long lines"} onClick={() => setWrapped((value) => !value)}><WrapText className="h-3.5 w-3.5" /></CodeAction>
          {longCode ? <CodeAction title={expanded ? "Collapse code" : "Expand code"} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</CodeAction> : null}
          <CodeAction title={copied ? "Copied" : "Copy code"} onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</CodeAction>
        </div>
      </div>
      <div className={`relative ${longCode && !expanded ? "max-h-[30rem] overflow-hidden" : ""}`}>
        <pre className={`max-w-full overflow-x-auto bg-[var(--code-bg)] p-4 text-[0.875em] leading-[1.65] text-primary ${wrapped ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
          <code>
            {tokens && !failed
              ? tokens.map((line, lineIndex) => (
                  <span key={lineIndex} className="block min-h-6">
                    {line.map((token, tokenIndex) => <span key={`${lineIndex}-${tokenIndex}`} style={{ color: token.color }}>{token.content}</span>)}
                  </span>
                ))
              : code}
          </code>
        </pre>
        {longCode && !expanded ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[var(--code-bg)] to-transparent" /> : null}
      </div>
    </section>
  );
}

function CodeAction({ title, onClick, children }: { title: string; onClick: () => void | Promise<void>; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} onClick={() => void onClick()} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition hover:bg-surface hover:text-primary">{children}</button>;
}

async function getShikiTokens(language: BundledLanguage, code: string, resolvedTheme: "light" | "dark"): Promise<ThemedToken[][]> {
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light";
  const key = `${theme}:${language}:${hashCode(code)}`;
  const cached = shikiTokenCache.get(key);
  if (cached) {
    return cached;
  }
  shikiHighlighterPromise ??= createCachedHighlighter();
  const highlighter = await shikiHighlighterPromise;
  await ensureShikiLanguage(highlighter, language);
  const result = highlighter.codeToTokens(code, { lang: language, theme }).tokens;
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
  return createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
}

async function ensureShikiLanguage(
  highlighter: Awaited<ReturnType<typeof createCachedHighlighter>>,
  language: BundledLanguage,
) {
  if (highlighter.getLoadedLanguages().includes(language)) return;
  let request = shikiLanguagePromises.get(language);
  if (!request) {
    request = highlighter.loadLanguage(language).then(() => undefined);
    shikiLanguagePromises.set(language, request);
  }
  try {
    await request;
  } finally {
    shikiLanguagePromises.delete(language);
  }
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
  const { resolvedTheme } = usePreferences();
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
            primaryColor: resolvedTheme === "dark" ? "#292c2a" : "#f6f8fa",
            primaryTextColor: resolvedTheme === "dark" ? "#ecedeb" : "#202123",
            primaryBorderColor: resolvedTheme === "dark" ? "#667069" : "#b9c2cb",
            lineColor: resolvedTheme === "dark" ? "#a7aaa5" : "#57606a",
            background: resolvedTheme === "dark" ? "#202120" : "#ffffff",
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
  }, [code, resolvedTheme]);

  if (svgUri) {
    return (
      <div className="overflow-x-auto rounded-b-md border border-t-0 border-ui bg-surface p-4">
        <img src={svgUri} alt="Mermaid diagram" className="mx-auto max-w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="reader-mermaid-error rounded-b-md border border-t-0 border-ui bg-[var(--reasoning-bg)] p-4">
        <p className="text-xs text-[var(--callout-warning-text)]">Mermaid 渲染失败，已回退为源码。</p>
        <pre className="max-w-full overflow-x-auto rounded border border-ui bg-surface p-3 text-[0.875em] leading-[1.65] text-primary">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div className="rounded-b-md border border-t-0 border-ui bg-[var(--reasoning-bg)] p-4 text-[0.875em] text-secondary">正在渲染 Mermaid 图表…</div>;
}

function CitationPart({ part }: { part: CanonicalSourcePart }) {
  return (
    <div className="rounded-xl border border-ui bg-surface px-4 py-3 text-[0.875em]">
      <div className="font-semibold text-primary">{part.title}</div>
      {part.snippet ? <p className="mt-1 leading-6 text-secondary">{part.snippet}</p> : null}
      {part.url && isSafeHref(part.url) ? (
        <a href={part.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-[var(--link)] underline">
          来源链接
        </a>
      ) : null}
    </div>
  );
}

function ToolPart({ part }: { part: CanonicalToolPart }) {
  return (
    <div className="rounded-xl border border-ui bg-[var(--attachment-bg)] px-4 py-3 text-[0.875em] text-secondary">
      <div className="font-semibold text-primary">工具结果 · {part.name}</div>
      {part.status ? <div className="mt-1 text-xs text-secondary">{part.status}</div> : null}
      {part.result !== undefined ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface p-3 text-xs text-primary">{JSON.stringify(part.result, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function AttachmentPart({ name, detail, url }: { name: string; detail?: string; url?: string }) {
  const safeUrl = url && isSafeHref(url) ? url : undefined;
  return (
    <div className="flex max-w-full items-center justify-between gap-3 rounded-xl border border-dashed border-ui bg-[var(--attachment-bg)] px-4 py-3 text-[0.875em] text-secondary">
      <div className="min-w-0">
        <div className="truncate font-medium text-primary">{name}</div>
        {detail ? <div className="text-xs text-secondary">{detail}</div> : null}
      </div>
      {safeUrl ? (
        <a href={safeUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[var(--link)] underline">
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
    return "border-[var(--callout-warning-border)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-text)]";
  }
  if (type === "tip" || type === "todo") {
    return "border-[var(--callout-tip-border)] bg-[var(--callout-tip-bg)] text-[var(--callout-tip-text)]";
  }
  if (type === "important") {
    return "border-[var(--callout-important-border)] bg-[var(--callout-important-bg)] text-[var(--callout-important-text)]";
  }
  return "border-[var(--callout-note-border)] bg-[var(--callout-note-bg)] text-[var(--callout-note-text)]";
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

function hastContainsCheckbox(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const candidate = node as { tagName?: unknown; properties?: Record<string, unknown>; children?: unknown[] };
  if (candidate.tagName === "input" && candidate.properties?.type === "checkbox") return true;
  return candidate.children?.some(hastContainsCheckbox) ?? false;
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
