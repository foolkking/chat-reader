"use client";

import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type AnchorHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Check, Copy, Maximize2, Minimize2, WrapText } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import { useClipboardCopy } from "../../components/use-clipboard-copy";
import type { ImageDisplay, ImageGeometry } from "../../lib/image-display";
import { useImageSource } from "../attachments/image-presentation";
import { AttachmentBlock } from "../attachments/attachment-block";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { BundledLanguage, ThemedToken } from "shiki";
import {
  RICH_MARKDOWN_RENDERER_VERSION,
  richMarkdownRehypeOptions,
  richMarkdownRemarkPlugins,
  scopedRichMarkdownRehypePlugins,
} from "../rich-markdown/rich-markdown-config";
import { normalizeDisplayMathForRenderer } from "../rich-markdown/remark-ai-math-compatibility";
import { MarkdownTableCell, MarkdownTableContent } from "./markdown-table";
import { ReaderMarkdownTable } from "./markdown-table-export-actions";
import { findOpeningThinkingSummary } from "./thinking-summary";
import {
  detectChatGptRichText,
  projectChatGptRichText,
  remarkRichTextSourcePositions,
  type ChatGptRichTextProfile,
} from "../rich-markdown/chatgpt-rich-text-compatibility";

export type MarkdownTaskItem = {
  taskKey: string;
  checked: boolean;
  checkedOffset: number;
  label: string;
  ordinal: number;
};

/** Stable attachment occurrence identity carried by a rendered block.  The
 * source text remains the authority; these attributes only let navigation
 * select the right repeated link after the block is mounted. */
export type MarkdownAttachmentOccurrence = {
  attachmentId: string;
  occurrenceKey: string;
  contentUrl?: string | null;
  downloadUrl?: string | null;
  mimeType?: string | null;
  alt?: string | null;
  caption?: string | null;
  imageDisplay?: ImageDisplay;
  imageGeometry?: ImageGeometry;
  sourceSha256?: string;
};

const EMPTY_TASK_ITEMS: MarkdownTaskItem[] = [];
const EMPTY_ATTACHMENT_OCCURRENCES: MarkdownAttachmentOccurrence[] = [];
const MarkdownLinkContext = createContext(false);
const MarkdownImageParagraphContext = createContext(false);
const MarkdownImageTableContext = createContext(false);
type MarkdownAttachmentContextValue = {
  byId: Map<string, MarkdownAttachmentOccurrence>;
  byKey: Map<string, MarkdownAttachmentOccurrence>;
};
const EMPTY_ATTACHMENT_CONTEXT: MarkdownAttachmentContextValue = { byId: new Map(), byKey: new Map() };
const MarkdownAttachmentContext = createContext<MarkdownAttachmentContextValue>(EMPTY_ATTACHMENT_CONTEXT);

type RichMarkdownPerformanceProbe = {
  markdownRenderTotal?: number;
  mathSourceTotal?: number;
};

/** Test-only counters. The probe is installed by the capacity Playwright run and
 * never sends source text or enables production telemetry. */
function recordRichMarkdownPerformance(text: string): void {
  if (typeof window === "undefined") return;
  const probe = (window as typeof window & { __chatReaderPerfProbe?: RichMarkdownPerformanceProbe }).__chatReaderPerfProbe;
  if (!probe) return;
  probe.markdownRenderTotal = (probe.markdownRenderTotal ?? 0) + 1;
  const withoutFences = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  probe.mathSourceTotal = (probe.mathSourceTotal ?? 0) + (
    (withoutFences.match(/\\\[[\s\S]*?\\\]/g) ?? []).length
    + (withoutFences.match(/\$\$[\s\S]*?\$\$/g) ?? []).length
    + (withoutFences.match(/\\\([\s\S]*?\\\)/g) ?? []).length
  );
}

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

const LEADING_TIMESTAMP_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const LEADING_TIMESTAMP_PREFIX_RE =
  /^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s+/;

type PositionedMarkdownNode = {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function markdownSourcePositionAttributes(node: PositionedMarkdownNode | null | undefined): {
  "data-markdown-source-start"?: number;
  "data-markdown-source-end"?: number;
} {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  return {
    "data-markdown-source-start": typeof start === "number" ? start : undefined,
    "data-markdown-source-end": typeof end === "number" ? end : undefined,
  };
}

const markdownComponents: Components & {
  CodeHeader?: React.ComponentType<CodeHeaderProps>;
  SyntaxHighlighter?: React.ComponentType<SyntaxHighlighterProps>;
} = {
  a({ href, children, node: _node, ...props }) {
    return <SafeMarkdownLink href={href} {...props}>{children}</SafeMarkdownLink>;
  },
  div({ children, node, ...props }) {
    const style = safeRichHtmlStyle(node);
    const callout = node?.properties?.dataReaderCallout;
    if (typeof callout === "string") {
      return <div {...markdownSourcePositionAttributes(node)} className={`markdown-callout reader-rich-callout border-l-4 px-4 py-3 ${calloutClassName(callout)}`}>{children}</div>;
    }
    return <div {...props} {...markdownSourcePositionAttributes(node)} className={`reader-rich-html-block ${props.className ?? ""}`} style={{ ...props.style, ...style }}>{children}</div>;
  },
  span({ children, node, ...props }) {
    return <span {...props} style={{ ...props.style, ...safeRichHtmlStyle(node) }}>{children}</span>;
  },
  section({ children, node, ...props }) {
    return <section {...props} style={{ ...props.style, ...safeRichHtmlStyle(node) }}>{children}</section>;
  },
  details({ children, open, node }) {
    const callout = node?.properties?.dataReaderCallout;
    if (typeof callout === "string") {
      return <details {...markdownSourcePositionAttributes(node)} open={open} className={`markdown-callout reader-rich-callout rounded-lg border-l-4 px-4 py-3 ${calloutClassName(callout)}`}>{children}</details>;
    }
    return <details {...markdownSourcePositionAttributes(node)} open={open} className="reader-rich-details rounded-lg border border-ui bg-surface px-3 py-2">{children}</details>;
  },
  summary({ children, node }) {
    return <summary {...markdownSourcePositionAttributes(node)} className="min-h-11 cursor-pointer select-none py-2 font-semibold marker:text-current">{children}</summary>;
  },
  blockquote({ node, children }) {
    const sourcePosition = markdownSourcePositionAttributes(node);
    return (
      <blockquote {...sourcePosition} className="border-l-2 border-[var(--quote-border)] py-0.5 pl-4 text-[var(--quote-text)]">
        {children}
      </blockquote>
    );
  },
  CodeHeader: EmptyCodeHeader,
  SyntaxHighlighter: CodeOrMermaidBlock,
  code({ children }) {
    return <code className="rounded-md border border-[var(--inline-code-border)] bg-[var(--inline-code-bg)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--inline-code-text)]">{children}</code>;
  },
  h1({ children, id, className, node }) {
    return <h1 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading reader-heading-1 border-b border-ui pb-2 font-semibold text-primary ${className ?? ""}`}>{children}</h1>;
  },
  h2({ children, id, className, node }) {
    if (className?.includes("sr-only")) return <h2 id={id} className={className}>{children}</h2>;
    return <h2 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading reader-heading-2 font-semibold text-primary ${className ?? ""}`}>{children}</h2>;
  },
  h3({ children, id, className, node }) {
    return <h3 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading reader-heading-3 font-semibold text-primary ${className ?? ""}`}>{children}</h3>;
  },
  h4({ children, id, className, node }) {
    return <h4 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading reader-heading-4 font-semibold text-primary ${className ?? ""}`}>{children}</h4>;
  },
  h5({ children, id, className, node }) {
    return <h5 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading font-semibold text-primary ${className ?? ""}`}>{children}</h5>;
  },
  h6({ children, id, className, node }) {
    return <h6 {...markdownSourcePositionAttributes(node)} id={id} className={`reader-heading font-semibold text-primary ${className ?? ""}`}>{children}</h6>;
  },
  hr({ node }) {
    return <hr {...markdownSourcePositionAttributes(node)} className="border-ui" />;
  },
  img({ alt, src, width, height, node }) {
    const source = markdownResourceSource(src);
    return <SafeMarkdownImage key={source} alt={alt} src={source} width={width} height={height} node={node} />;
  },
  audio({ src, node }) {
    const source = markdownResourceSource(src);
    return <SafeMarkdownMedia key={source} kind="audio" src={source} node={node} />;
  },
  video({ src, width, height, node }) {
    const source = markdownResourceSource(src);
    return <SafeMarkdownMedia key={source} kind="video" src={source} width={width} height={height} node={node} />;
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
    return <li {...markdownSourcePositionAttributes(node)} className={`pl-[0.375em] marker:text-secondary ${task ? "list-none" : ""} ${className ?? ""}`}>{children}</li>;
  },
  ol({ children, start, node }) {
    return <ol {...markdownSourcePositionAttributes(node)} start={start} className="list-decimal pl-[1.625em]">{children}</ol>;
  },
  p({ children, node }) {
    if (node?.properties?.dataReaderCalloutTitle) {
      return <p {...markdownSourcePositionAttributes(node)} className="font-semibold">{children}</p>;
    }
    const imageOnly = Boolean(node?.children?.length && node.children.every(child =>
      (child.type === "element" && child.tagName === "img") || (child.type === "text" && !child.value.trim())));
    return <p {...markdownSourcePositionAttributes(node)} className={imageOnly ? "reader-image-paragraph" : "break-words"}>
      <MarkdownImageParagraphContext.Provider value={imageOnly}>{children}</MarkdownImageParagraphContext.Provider>
    </p>;
  },
  pre({ children, node }) {
    return <pre {...markdownSourcePositionAttributes(node)} className="max-w-full overflow-x-auto rounded-lg border border-ui bg-[var(--code-bg)] p-4 text-[0.875em] leading-[1.65] text-primary">{children}</pre>;
  },
  table({ children, node }) {
    return (
      <ReaderMarkdownTable {...markdownSourcePositionAttributes(node)} node={node}>
        <MarkdownImageTableContext.Provider value={true}><MarkdownTableContent>{children}</MarkdownTableContent></MarkdownImageTableContext.Provider>
      </ReaderMarkdownTable>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-[var(--border)]">{children}</tbody>;
  },
  td({ children, style }) {
    return <MarkdownTableCell style={style}>{children}</MarkdownTableCell>;
  },
  th({ children, style }) {
    return <MarkdownTableCell header style={style}>{children}</MarkdownTableCell>;
  },
  thead({ children }) {
    return <thead className="border-b border-ui">{children}</thead>;
  },
  ul({ children, className, node }) {
    const task = className?.includes("contains-task-list") || hastContainsCheckbox(node);
    return <ul {...markdownSourcePositionAttributes(node)} className={`${task ? "list-none pl-0" : "list-disc pl-[1.625em]"} ${className ?? ""}`} data-markdown-task-list={task || undefined}>{children}</ul>;
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

type TableCellPreviewRenderer = (row: number, column: number, content: ReactNode) => ReactNode;
const TableCellPreviewContext = createContext<{ render: TableCellPreviewRenderer; version?: string } | null>(null);

// Stable component identities keep the active cell/input mounted while typing.
function EditablePreviewTableCell({ children, node, header, style }: {
  children?: ReactNode;
  node?: { properties?: Record<string, unknown> };
  header: boolean;
  style?: CSSProperties;
}) {
  const render = useContext(TableCellPreviewContext);
  const row = Number(node?.properties?.["data-table-preview-row"]);
  const column = Number(node?.properties?.["data-table-preview-column"]);
  const content = render && Number.isInteger(row) && Number.isInteger(column) ? render.render(row, column, children) : children;
  return <MarkdownTableCell header={header} editing style={style}>{content}</MarkdownTableCell>;
}

const editableTablePreviewComponents: Components = {
  ...markdownComponents,
  table({ children }) {
    // The tool already owns its bounded, two-axis scroller and edge controls.
    return <MarkdownTableContent>{children}</MarkdownTableContent>;
  },
  th(props) { return <EditablePreviewTableCell {...props} header />; },
  td(props) { return <EditablePreviewTableCell {...props} header={false} />; },
  // Clicking a cell edits its source; it must not also navigate a link.
  a({ children }) { return <span className="text-[var(--link)] underline">{children}</span>; },
  img({ alt }) { return <span className="text-secondary">{alt || "Image"}</span>; },
  audio() { return <span className="text-secondary">Audio</span>; },
  video() { return <span className="text-secondary">Video</span>; },
};

type TablePreviewNode = {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: TablePreviewNode[];
};

function rehypeTablePreviewCoordinates() {
  return (tree: TablePreviewNode) => {
    const walk = (node: TablePreviewNode) => {
      if (node.tagName === "table") {
        let rowIndex = 0;
        for (const section of node.children ?? []) {
          for (const row of section.tagName === "tr" ? [section] : section.children ?? []) {
            if (row.tagName !== "tr") continue;
            let column = 0;
            for (const cell of row.children ?? []) {
              if (cell.tagName !== "th" && cell.tagName !== "td") continue;
              cell.properties = { ...cell.properties, "data-table-preview-row": rowIndex, "data-table-preview-column": column++ };
            }
            rowIndex++;
          }
        }
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(tree);
  };
}

/** Table-tool presentation only: the existing GFM/math/sanitization core is unchanged. */
export const MarkdownTablePreview = memo(function MarkdownTablePreview({ text, renderCell, interactionVersion }: {
  text: string;
  renderCell: TableCellPreviewRenderer;
  interactionVersion?: string;
}) {
  const scopeId = useId();
  const renderText = useMemo(() => normalizeDisplayMathForRenderer(text), [text]);
  const previewContext = useMemo(() => ({ render: renderCell, version: interactionVersion }), [interactionVersion, renderCell]);
  // Keep the Markdown subtree stable when only the cell callback changes (for
  // example an urgent edit while a deferred preview is catching up). Context
  // consumers still receive live values without rerunning the unchanged parser.
  // This retains only this mounted preview's current element, not a source cache.
  const renderedTable = useMemo(() => {
    return (
      <ReactMarkdown
        components={editableTablePreviewComponents}
        remarkPlugins={richMarkdownRemarkPlugins()}
        rehypePlugins={[...scopedRichMarkdownRehypePlugins(scopeId), rehypeTablePreviewCoordinates]}
        remarkRehypeOptions={richMarkdownRehypeOptions(scopeId)}
        urlTransform={readerMarkdownUrlTransform}
        skipHtml
      >{renderText}</ReactMarkdown>
    );
  }, [renderText, scopeId]);
  return (
    <TableCellPreviewContext.Provider value={previewContext}>
      <div className="aui-chat-markdown reader-prose text-primary" data-rich-markdown-version={RICH_MARKDOWN_RENDERER_VERSION}>
        {renderedTable}
      </div>
    </TableCellPreviewContext.Provider>
  );
});

export const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
  className = "",
  isAssistant = true,
  taskItems = EMPTY_TASK_ITEMS,
  pendingTaskKeys,
  onTaskToggle,
  scopeId,
  attachmentOccurrences = EMPTY_ATTACHMENT_OCCURRENCES,
  preserveSourceOffsets = false,
  richTextProfile,
}: {
  text: string;
  className?: string;
  isAssistant?: boolean;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId?: string;
  attachmentOccurrences?: MarkdownAttachmentOccurrence[];
  preserveSourceOffsets?: boolean;
  richTextProfile?: ChatGptRichTextProfile;
}) {
  const generatedScopeId = useId();
  const resolvedScopeId = scopeId ?? generatedScopeId;
  const resolvedRichTextProfile = useMemo(() => richTextProfile ?? detectChatGptRichText(text) ?? undefined, [richTextProfile, text]);
  const parts = useMemo(() => canonicalMessagePartsFromText(text, isAssistant), [isAssistant, text]);
  const tasksByPart = useMemo(() => assignTasksToParts(parts, taskItems), [parts, taskItems]);
  if (preserveSourceOffsets) {
    return (
      <div className={`aui-chat-markdown max-w-full break-words text-primary ${className}`} data-rich-markdown-version={RICH_MARKDOWN_RENDERER_VERSION}>
        <AssistantMarkdownPart
          text={text}
          taskItems={taskItems}
          pendingTaskKeys={pendingTaskKeys}
          onTaskToggle={onTaskToggle}
          attachmentOccurrences={attachmentOccurrences}
          scopeId={`${resolvedScopeId}-source`}
          richTextProfile={resolvedRichTextProfile}
        />
      </div>
    );
  }
  return (
    <div className={`aui-chat-markdown max-w-full break-words text-primary ${className}`} data-rich-markdown-version={RICH_MARKDOWN_RENDERER_VERSION}>
      {parts.map((part, index) => (
        <CanonicalPartRenderer
          key={`${part.type}-${index}`}
          part={part}
          taskItems={tasksByPart[index] ?? []}
          pendingTaskKeys={pendingTaskKeys}
          onTaskToggle={onTaskToggle}
          attachmentOccurrences={attachmentOccurrences}
          scopeId={`${resolvedScopeId}-part-${index}`}
          richTextProfile={resolvedRichTextProfile}
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
  && previous.onTaskToggle === next.onTaskToggle
  && previous.attachmentOccurrences === next.attachmentOccurrences
  && previous.preserveSourceOffsets === next.preserveSourceOffsets
  && previous.richTextProfile === next.richTextProfile);

export function InlineHeadingMarkdown({ text, richTextProfile }: { text: string; richTextProfile?: ChatGptRichTextProfile }) {
  const inlineText = projectChatGptRichText(text, richTextProfile).text.replace(/\s*\r?\n\s*/g, " ").trim();
  recordRichMarkdownPerformance(inlineText);
  return (
      <ReactMarkdown
        components={inlineMarkdownComponents}
        rehypePlugins={scopedRichMarkdownRehypePlugins("inline-heading")}
        remarkPlugins={richMarkdownRemarkPlugins()}
        remarkRehypeOptions={richMarkdownRehypeOptions("inline-heading")}
        urlTransform={readerMarkdownUrlTransform}
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

export function ThinkingDisclosure({ label, text, attachmentOccurrences = [], richTextProfile, children }: { label: string; text: string; attachmentOccurrences?: MarkdownAttachmentOccurrence[]; richTextProfile?: ChatGptRichTextProfile; children?: ReactNode }) {
  return (
    <details className="reader-thinking rounded-xl border border-ui bg-[var(--reasoning-bg)] px-4 py-3 text-[var(--quote-text)]">
      <summary className="min-h-8 cursor-pointer select-none text-sm font-medium text-primary">
        {label}
      </summary>
      {children ?? (text.trim() ? <AssistantMarkdownPart text={text} className="reader-thinking-content text-[0.875em]" attachmentOccurrences={attachmentOccurrences} richTextProfile={richTextProfile} /> : null)}
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
  attachmentOccurrences = [],
  richTextProfile,
}: {
  text: string;
  className?: string;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId?: string;
  attachmentOccurrences?: MarkdownAttachmentOccurrence[];
  richTextProfile?: ChatGptRichTextProfile;
}) {
  const generatedScopeId = useId();
  const resolvedScopeId = scopeId ?? generatedScopeId;
  // Math keeps its existing preprocessing semantics; rich-text projection
  // additionally maps its own display edits back to the input source offsets.
  const projection = useMemo(() => projectChatGptRichText(normalizeDisplayMathForRenderer(text), richTextProfile), [richTextProfile, text]);
  const renderText = projection.text;
  const interactiveComponents = useMemo(
    () => createTaskAwareComponents(taskItems, pendingTaskKeys, onTaskToggle),
    [onTaskToggle, pendingTaskKeys, taskItems, text],
  );
  const taskPlugin = useMemo(
    () => taskItems.length > 0 ? remarkTaskKeys(taskItems) : null,
    [taskItems, text],
  );
  const attachmentPlugin = useMemo(
    () => attachmentOccurrences.length > 0 ? remarkAttachmentOccurrences(attachmentOccurrences) : null,
    [attachmentOccurrences, text],
  );
  const attachmentContext = useMemo<MarkdownAttachmentContextValue>(() => {
    const byId = new Map<string, MarkdownAttachmentOccurrence>();
    const byKey = new Map<string, MarkdownAttachmentOccurrence>();
    for (const occurrence of attachmentOccurrences) {
      const id = occurrence.attachmentId.toLowerCase();
      if (!byId.has(id)) byId.set(id, occurrence);
      byKey.set(occurrence.occurrenceKey, occurrence);
    }
    return { byId, byKey };
  }, [attachmentOccurrences]);
  const sourcePositionPlugin = useMemo(
    () => projection.sourcePosition ? remarkRichTextSourcePositions(projection) : null,
    [projection],
  );
  const plugins = useMemo(() => richMarkdownRemarkPlugins([
    ...(taskPlugin ? [taskPlugin] : []),
    ...(attachmentPlugin ? [attachmentPlugin] : []),
    remarkExcludedArchiveReferences,
    ...(sourcePositionPlugin ? [sourcePositionPlugin] : []),
  ]), [attachmentPlugin, sourcePositionPlugin, taskPlugin, text]);
  const rehypePlugins = useMemo(() => scopedRichMarkdownRehypePlugins(resolvedScopeId), [resolvedScopeId]);
  const rehypeOptions = useMemo(() => richMarkdownRehypeOptions(resolvedScopeId), [resolvedScopeId]);
  const componentsByLanguage = useMemo(
    () => ({ mermaid: { SyntaxHighlighter: MermaidDiagram, CodeHeader: MermaidCodeHeader } }),
    [],
  );
  const preprocess = useCallback(() => renderText, [renderText]);
  // Keep ordinary Markdown's exact subtree stable across host-style-only
  // updates. Source, profile, task, attachment and scope changes still replace
  // its parser inputs; this is not a cross-message parsed-result cache.
  const renderedMarkdown = useMemo(() => (
    <MarkdownTextPrimitive
      className="reader-prose"
      remarkPlugins={plugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={rehypeOptions}
      components={interactiveComponents}
      componentsByLanguage={componentsByLanguage}
      preprocess={preprocess}
      urlTransform={readerMarkdownUrlTransform}
      skipHtml
    />
  ), [componentsByLanguage, interactiveComponents, plugins, preprocess, rehypeOptions, rehypePlugins]);
  if (!text.trim()) {
    return null;
  }
  recordRichMarkdownPerformance(text);
  if (onTaskToggle && taskItems.length > 0) {
    return (
      <MarkdownAttachmentContext.Provider value={attachmentContext}>
        <div className={`reader-prose ${className}`}>
          <ReactMarkdown
            components={interactiveComponents as Components}
            remarkPlugins={plugins}
            rehypePlugins={rehypePlugins}
            remarkRehypeOptions={rehypeOptions}
            urlTransform={readerMarkdownUrlTransform}
            skipHtml
          >
            {renderText}
          </ReactMarkdown>
        </div>
      </MarkdownAttachmentContext.Provider>
    );
  }
  return (
    <MarkdownAttachmentContext.Provider value={attachmentContext}>
      <div className={className}>
        <TextMessagePartProvider text={text}>
          {renderedMarkdown}
        </TextMessagePartProvider>
      </div>
    </MarkdownAttachmentContext.Provider>
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
  attachmentOccurrences,
  richTextProfile,
}: {
  part: CanonicalMessagePart;
  taskItems: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
  scopeId: string;
  attachmentOccurrences: MarkdownAttachmentOccurrence[];
  richTextProfile?: ChatGptRichTextProfile;
}) {
  if (part.type === "reasoning") {
    return <ThinkingDisclosure label={part.label} text={part.text} attachmentOccurrences={attachmentOccurrences} richTextProfile={richTextProfile} />;
  }
  if (part.type === "text") {
    return <AssistantMarkdownPart text={part.text} taskItems={taskItems} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} attachmentOccurrences={attachmentOccurrences} scopeId={scopeId} richTextProfile={richTextProfile} />;
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
  value?: string;
  url?: string;
  alt?: string;
  checked?: boolean | null;
  data?: {
    hProperties?: Record<string, unknown>;
    hName?: string;
    hChildren?: SafeHtmlAttachmentNode[];
  };
  children?: MarkdownAstNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type SafeHtmlAttachmentNode = {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: SafeHtmlAttachmentNode[];
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

function remarkAttachmentOccurrences(occurrences: MarkdownAttachmentOccurrence[]) {
  const byAttachment = new Map<string, MarkdownAttachmentOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = occurrence.attachmentId.toLowerCase();
    const list = byAttachment.get(key) ?? [];
    list.push(occurrence);
    byAttachment.set(key, list);
  }
  return () => (tree: MarkdownAstNode) => {
    const cursors = new Map<string, number>();
    const resolve = (url: string, media: boolean, properties: Record<string, unknown>) => {
      const match = /^cr-asset:\/\/([0-9a-f-]{16,})$/i.exec(url.trim());
      if (!match) return url;
      const key = match[1].toLowerCase();
      const cursor = cursors.get(key) ?? 0;
      const occurrence = byAttachment.get(key)?.[cursor];
      if (!occurrence) return url;
      cursors.set(key, cursor + 1);
      properties.dataAttachmentId = occurrence.attachmentId;
      properties.dataOccurrenceKey = occurrence.occurrenceKey;
      return (media ? occurrence.contentUrl ?? occurrence.downloadUrl : occurrence.downloadUrl ?? occurrence.contentUrl) || url;
    };
    const walkHtml = (node: SafeHtmlAttachmentNode) => {
      const key = node.tagName === "a" ? "href" : ["img", "audio", "video"].includes(node.tagName ?? "") ? "src" : null;
      if (key && typeof node.properties?.[key] === "string") {
        node.properties[key] = resolve(node.properties[key], key === "src", node.properties);
      }
      node.children?.forEach(walkHtml);
    };
    const walk = (node: MarkdownAstNode) => {
      if (node.type === "link" || node.type === "image") {
        node.data ??= {};
        node.data.hProperties ??= {};
        node.url = resolve(node.url ?? "", node.type === "image", node.data.hProperties);
      } else if (node.type === "safeHtml" && node.data) {
        node.data.hProperties ??= {};
        walkHtml({ tagName: node.data.hName, properties: node.data.hProperties, children: node.data.hChildren });
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

function remarkExcludedArchiveReferences() {
  return (tree: MarkdownAstNode) => {
    const walk = (node: MarkdownAstNode) => {
      if (node.type === "link" || node.type === "image") {
        const url = node.url ?? "";
        if (/^cr-archive-member:\/\/[0-9a-f-]{16,}$/i.test(url.trim())) {
          const label = node.type === "image" ? node.alt : markdownNodeText(node);
          node.type = "text";
          node.value = typeof label === "string" && label.trim() ? label : "Excluded archive resource";
          node.url = undefined;
          node.data = undefined;
          node.children = undefined;
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

function markdownNodeText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(markdownNodeText).join("") ?? "";
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

type MarkdownElementNode = { properties?: Record<string, unknown> };

function markdownResourceSource(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readerMarkdownUrlTransform(url: string, key: string): string {
  // react-markdown intentionally strips unknown protocols before the
  // component layer.  Keep only our opaque, UUID-shaped asset reference long
  // enough for the attachment context to resolve it to a same-origin or blob
  // URL; every other URL keeps the library's default safety transform.
  if (key !== "href" && key !== "src") return defaultUrlTransform(url);
  if (/^cr-asset:\/\/[0-9a-f-]{16,}$/i.test(url.trim())) return url;
  return defaultUrlTransform(url);
}

function safeRichHtmlStyle(node: MarkdownElementNode | null | undefined): CSSProperties {
  const properties = node?.properties;
  if (!properties) return {};
  const style: CSSProperties = {};
  const display = properties.dataReaderDisplay;
  if (display === "flex" || display === "grid") style.display = display;
  const gap = safeRichHtmlDimension(properties.dataReaderGap, 64);
  if (gap) style.gap = gap;
  const align = properties.dataReaderAlign;
  if (align === "flex-start" || align === "center" || align === "flex-end" || align === "stretch") style.alignItems = align;
  const justify = properties.dataReaderJustify;
  if (justify === "flex-start" || justify === "center" || justify === "flex-end" || justify === "space-between" || justify === "space-around") style.justifyContent = justify;
  const margin = safeRichHtmlDimension(properties.dataReaderMargin, 64);
  if (margin) style.marginBlock = margin;
  const radius = safeRichHtmlDimension(properties.dataReaderRadius, 24);
  if (radius) style.borderRadius = radius;
  const flex = properties.dataReaderFlex;
  if (flex === "none" || flex === "1" || flex === "1 1 auto" || flex === "0 0 auto") style.flex = flex;
  const width = safeRichHtmlDimension(properties.dataReaderWidth, 640);
  if (width) style.width = width;
  const maxWidth = safeRichHtmlDimension(properties.dataReaderMaxWidth, 640);
  if (maxWidth) style.maxWidth = maxWidth;
  return style;
}

function safeRichHtmlDimension(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:px|rem|em)$/.test(value)) return undefined;
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > max) return undefined;
  // A bound expressed as 64 units is not a 64px bound when the unit is rem/em.
  return value.endsWith("px") ? value : `min(${max}px, ${value})`;
}

function SafeMarkdownImage({ alt, src, width, height, node }: {
  alt?: string;
  src?: string;
  width?: number | string;
  height?: number | string;
  node?: MarkdownElementNode | null;
}) {
  const [failed, setFailed] = useState(false);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const insideLink = useContext(MarkdownLinkContext);
  const imageOnly = useContext(MarkdownImageParagraphContext);
  const insideTable = useContext(MarkdownImageTableContext);
  const attachmentContext = useContext(MarkdownAttachmentContext);
  const attachment = resolveAttachmentFromContext(attachmentContext, src, node);
  const resolvedSrc = attachment?.contentUrl ?? attachment?.downloadUrl ?? src;
  const safeSrc = typeof resolvedSrc === "string"
    && (isSafeLocalMediaSource(resolvedSrc) || (attachment !== null && isSafeAttachmentMediaSource(resolvedSrc)))
    ? resolvedSrc
    : undefined;
  const resolvedAlt = alt ?? attachment?.alt ?? attachment?.caption ?? undefined;
  const imageRef = useRef<HTMLImageElement | null>(null);
  const image = useImageSource({ id: attachment?.attachmentId ?? `local:${safeSrc}`, sha256: attachment?.sourceSha256,
    metadata: { image_display_v1: attachment?.imageDisplay, image_geometry_v1: attachment?.imageGeometry } }, imageRef);
  const occurrenceAnchor = attachment ? {
    id: `attachment-occurrence-${attachment.occurrenceKey}`,
    "data-attachment-id": attachment.attachmentId,
    "data-occurrence-key": attachment.occurrenceKey,
  } : {};
  const safeWidth = image.size?.width ?? boundedImageDimension(width);
  const safeHeight = image.size?.height ?? boundedImageDimension(height);
  const ratio = safeWidth && safeHeight ? `${safeWidth} / ${safeHeight}` : undefined;
  const style: CSSProperties = {
    ...safeRichHtmlStyle(node),
    aspectRatio: ratio,
    width: safeWidth ?? "auto",
    maxWidth: "100%",
    height: "auto",
  };
  if (imageOnly && !insideLink && !insideTable && attachment?.sourceSha256 && safeSrc && !failed) {
    // Reuse the image UI with span-only DOM. No figure/div inside a paragraph;
    // linked, table and prose-inline images retain their native semantics.
    return <AttachmentBlock attachmentId={attachment.attachmentId} occurrenceKey={attachment.occurrenceKey}
      alt={resolvedAlt ?? undefined} caption={attachment.caption ?? undefined} grouped phrasing inlinePresentation="gallery"
      attachment={{
        id: attachment.attachmentId, conversation_id: "", display_name: resolvedAlt || (zh ? "图片" : "Image"),
        original_filename: "", detected_mime_type: attachment.mimeType || "image/png",
        status: "available", scan_status: "unscanned", source_type: "markdown", resolution_status: "resolved", created_at: "",
        content_url: safeSrc, download_url: attachment.downloadUrl,
        asset_object: attachment.sourceSha256 ? { id: attachment.attachmentId, sha256: attachment.sourceSha256,
          byte_size: 1, detected_mime_type: attachment.mimeType || "image/png", scan_status: "unscanned", status: "available" } : null,
        metadata: { image_display_v1: attachment.imageDisplay, image_geometry_v1: attachment.imageGeometry },
      }} />;
  }
  if (!safeSrc || failed) {
    return <span {...occurrenceAnchor} className="reader-rich-image-fallback inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed border-ui bg-[var(--attachment-bg)] px-2 py-1 text-[0.75em] text-secondary" role={resolvedAlt ? "img" : undefined} aria-label={resolvedAlt || undefined} style={style}>
      <span className="min-w-0 truncate">{resolvedAlt || (zh ? "图片附件" : "Image attachment")}</span>
      {!insideLink && typeof resolvedSrc === "string" && (isSafeHref(resolvedSrc) || (attachment !== null && isSafeAttachmentMediaSource(resolvedSrc))) ? <a href={resolvedSrc} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[var(--link)] underline">{zh ? "打开图片" : "Open image"}</a> : null}
    </span>;
  }
  return <img
    ref={imageRef}
    {...occurrenceAnchor}
    src={safeSrc}
    alt={resolvedAlt ?? ""}
    width={safeWidth}
    height={safeHeight}
    loading="lazy"
    decoding="async"
    className="reader-rich-image inline-block h-auto max-w-full align-middle"
    style={style}
    onError={() => setFailed(true)}
    onLoad={event => image.onDecoded(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
  />;
}

function SafeMarkdownMedia({ kind, src, width, height, node }: {
  kind: "audio" | "video";
  src?: string;
  width?: number | string;
  height?: number | string;
  node?: MarkdownElementNode | null;
}) {
  const [failed, setFailed] = useState(false);
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const insideLink = useContext(MarkdownLinkContext);
  const attachmentContext = useContext(MarkdownAttachmentContext);
  const attachment = resolveAttachmentFromContext(attachmentContext, src, node);
  const occurrenceAnchor = attachment ? {
    id: `attachment-occurrence-${attachment.occurrenceKey}`,
    "data-attachment-id": attachment.attachmentId,
    "data-occurrence-key": attachment.occurrenceKey,
  } : {};
  const resolvedSrc = attachment?.contentUrl ?? attachment?.downloadUrl ?? src;
  const safeSrc = typeof resolvedSrc === "string"
    && (isSafeLocalMediaSource(resolvedSrc) || (attachment !== null && isSafeAttachmentMediaSource(resolvedSrc)))
    ? resolvedSrc
    : undefined;
  const safeWidth = boundedImageDimension(width);
  const safeHeight = boundedImageDimension(height);
  const ratio = safeWidth && safeHeight ? `${safeWidth} / ${safeHeight}` : undefined;
  const style: CSSProperties = {
    ...safeRichHtmlStyle(node),
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...(safeWidth ? { width: safeRichHtmlStyle(node).width ?? safeWidth } : {}),
    maxWidth: "100%",
    ...(kind === "video" ? { maxHeight: "70vh" } : {}),
  };
  if (!safeSrc || failed) {
    return (
      <span {...occurrenceAnchor} className="reader-rich-image-fallback inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed border-ui bg-[var(--attachment-bg)] px-2 py-1 text-[0.75em] text-secondary" role="status" style={style}>
        <span>{kind === "audio" ? (zh ? "音频附件" : "Audio attachment") : (zh ? "视频附件" : "Video attachment")}</span>
        {!insideLink && safeSrc ? <a href={safeSrc} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[var(--link)] underline">{zh ? "打开媒体" : "Open media"}</a> : null}
      </span>
    );
  }
  if (kind === "audio") {
    return <audio {...occurrenceAnchor} src={safeSrc} controls preload="metadata" className="reader-rich-media max-w-full" style={style} onError={() => setFailed(true)} />;
  }
  return <video {...occurrenceAnchor} src={safeSrc} controls preload="metadata" playsInline width={safeWidth} height={safeHeight} className="reader-rich-media max-h-[70vh] max-w-full rounded-lg object-contain" style={style} onError={() => setFailed(true)} />;
}

function boundedImageDimension(value: number | string | undefined): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(number) && number > 0 && number <= 4096 ? number : undefined;
}

function isSafeLocalMediaSource(src: string): boolean {
  return src.startsWith("/") && !src.startsWith("//") && !src.includes("\\")
    && !/^(?:javascript|data|vbscript):/i.test(src)
    && !hasUnsafeLocalPathEncoding(src)
    && !src.split(/[/?#]/).includes("..");
}

function isSafeAttachmentMediaSource(src: string): boolean {
  return /^blob:[A-Za-z0-9._~:/?#\x5B\x5D@!$&'()*+,;=%-]+$/.test(src)
    || isSafeLocalMediaSource(src);
}

function SafeMarkdownLink({ href, children, ...props }: { href?: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">) {
  const attachmentContext = useContext(MarkdownAttachmentContext);
  const dataProps = props as AnchorHTMLAttributes<HTMLAnchorElement> & Record<string, unknown>;
  const attachment = resolveAttachmentFromContext(attachmentContext, href, dataProps);
  const resolvedHref = attachment?.downloadUrl ?? attachment?.contentUrl ?? href;
  const safeHref = typeof resolvedHref === "string"
    && (isSafeHref(resolvedHref) || (attachment !== null && isSafeAttachmentMediaSource(resolvedHref)))
    ? resolvedHref
    : undefined;
  const parsedAttachmentId = typeof href === "string" ? attachmentIdFromHref(href) : null;
  if (!safeHref) {
    const occurrenceKey = typeof dataProps["data-occurrence-key"] === "string" ? dataProps["data-occurrence-key"] : null;
    const attachmentId = typeof dataProps["data-attachment-id"] === "string" ? dataProps["data-attachment-id"] : parsedAttachmentId;
    return (
      <span
        id={occurrenceKey && attachmentId ? `attachment-occurrence-${occurrenceKey}` : undefined}
        data-attachment-id={attachmentId ?? undefined}
        data-occurrence-key={occurrenceKey ?? undefined}
        className="text-secondary"
      >{children}</span>
    );
  }
  const local = safeHref.startsWith("#") || safeHref.startsWith("/");
  const occurrenceKey = typeof dataProps["data-occurrence-key"] === "string" ? dataProps["data-occurrence-key"] : null;
  const attachmentId = typeof dataProps["data-attachment-id"] === "string" ? dataProps["data-attachment-id"] : parsedAttachmentId;
  return (
    <a
      href={safeHref}
      id={occurrenceKey && attachmentId ? `attachment-occurrence-${occurrenceKey}` : undefined}
      data-attachment-id={attachmentId ?? undefined}
      data-occurrence-key={occurrenceKey ?? undefined}
      {...props}
      target={local ? undefined : "_blank"}
      rel={local ? undefined : "noopener noreferrer"}
      className="font-medium text-[var(--link)] underline decoration-[var(--link-decoration)] underline-offset-2 hover:text-[var(--link-hover)]"
    >
      <MarkdownLinkContext.Provider value={true}>{children}</MarkdownLinkContext.Provider>
    </a>
  );
}

function attachmentIdFromHref(href: string): string | null {
  const match = /^cr-asset:\/\/([0-9a-f-]{16,})$/i.exec(href.trim());
  return match?.[1] ?? null;
}

function resolveAttachmentFromContext(
  context: MarkdownAttachmentContextValue,
  source: string | undefined,
  nodeOrProps: MarkdownElementNode | Record<string, unknown> | null | undefined,
): MarkdownAttachmentOccurrence | null {
  let properties: Record<string, unknown> | undefined;
  if (nodeOrProps && typeof nodeOrProps === "object" && "properties" in nodeOrProps) {
    const candidate = (nodeOrProps as { properties?: unknown }).properties;
    if (candidate && typeof candidate === "object") {
      properties = candidate as Record<string, unknown>;
    }
  } else if (nodeOrProps && typeof nodeOrProps === "object") {
    properties = nodeOrProps as Record<string, unknown>;
  }
  const occurrenceKey = properties?.["data-occurrence-key"] ?? properties?.dataOccurrenceKey;
  if (typeof occurrenceKey === "string") {
    const occurrence = context.byKey.get(occurrenceKey);
    if (occurrence) return occurrence;
  }
  // The sanitizer may remove an opaque/blob URL. Only the trusted occurrence
  // context can restore it; untrusted HTML cannot supply these data keys.
  const attachmentId = typeof source === "string" ? attachmentIdFromHref(source) : null;
  return attachmentId ? context.byId.get(attachmentId.toLowerCase()) ?? null : null;
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
  const { resolvedTheme, resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const containerRef = useRef<HTMLElement | null>(null);
  const [shouldHighlight, setShouldHighlight] = useState(false);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [failed, setFailed] = useState(false);
  const clipboard = useClipboardCopy(code);
  const copied = clipboard.state === "copied";
  const copying = clipboard.state === "copying";
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
      <div data-markdown-copy-ignore="true" className="flex min-h-10 items-center justify-between gap-3 border-b border-ui bg-subtle px-3 text-xs text-secondary">
        <span className="min-w-0 truncate font-mono">{language || "text"}</span>
        <div className="flex items-center gap-1">
          <CodeAction title={wrapped ? "Disable line wrapping" : "Wrap long lines"} onClick={() => setWrapped((value) => !value)}><WrapText className="h-3.5 w-3.5" /></CodeAction>
          {longCode ? <CodeAction title={expanded ? "Collapse code" : "Expand code"} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</CodeAction> : null}
          <CodeAction title={copying ? (zh ? "正在复制代码…" : "Copying code…") : copied ? (zh ? "已复制" : "Copied") : (zh ? "复制代码" : "Copy code")} onClick={clipboard.copy} disabled={copying}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</CodeAction>
        </div>
      </div>
      {clipboard.state === "failed" ? <div data-markdown-copy-ignore="true" className="space-y-2 border-b border-ui p-3">
        <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "剪贴板不可用，请从下方选择并复制。" : "Clipboard unavailable. Select and copy below."}</p>
        <textarea ref={clipboard.manualRef} readOnly value={code} rows={5}
          aria-label={zh ? "可手动复制的代码" : "Code for manual copy"}
          onFocus={event => event.currentTarget.select()}
          className="w-full resize-y rounded-md border border-ui bg-surface p-3 font-mono text-sm leading-6 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" />
      </div> : null}
      <div className={`relative ${longCode && !expanded ? "max-h-[30rem] overflow-hidden" : ""}`}>
        <pre className={`max-w-full overflow-x-auto bg-[var(--code-bg)] p-4 text-[0.875em] leading-[1.65] text-primary ${wrapped ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
          <code>
            {code.split(/\r?\n/).map((line, lineIndex, lines) => <span key={lineIndex}>
              {tokens && !failed && tokens[lineIndex]
                ? tokens[lineIndex].map((token, tokenIndex) => <span key={tokenIndex} style={{ color: token.color }}>{token.content}</span>)
                : line}
              {lineIndex < lines.length - 1 ? "\n" : null}
            </span>)}
          </code>
        </pre>
        {longCode && !expanded ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[var(--code-bg)] to-transparent" /> : null}
      </div>
    </section>
  );
}

function CodeAction({ title, onClick, children, disabled = false }: { title: string; onClick: () => void | Promise<void>; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} aria-busy={disabled || undefined} onClick={() => void onClick()} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition hover:bg-surface hover:text-primary disabled:opacity-40">{children}</button>;
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
  const { resolvedLocale, resolvedTheme } = usePreferences();
  const descriptionId = useId();
  const [rendered, setRendered] = useState<{
    code: string; theme: string; uri?: string; title?: string; description?: string; failed?: boolean;
  } | null>(null);
  // Never label the previous diagram with a new source while async work runs.
  const current = rendered?.code === code && rendered.theme === resolvedTheme ? rendered : null;
  const zh = resolvedLocale === "zh-CN";

  useEffect(() => {
    let cancelled = false;
    async function renderMermaid() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
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
          const document = new DOMParser().parseFromString(svg, "image/svg+xml");
          setRendered({
            code, theme: resolvedTheme,
            uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            // These are supplied by Mermaid (e.g. accTitle/accDescr), not an
            // inferred description or user HTML inserted into the page.
            title: document.querySelector("title")?.textContent?.trim() || undefined,
            description: document.querySelector("desc")?.textContent?.trim() || undefined,
          });
        }
      } catch {
        if (!cancelled) {
          setRendered({ code, theme: resolvedTheme, failed: true });
        }
      }
    }
    renderMermaid();
    return () => {
      cancelled = true;
    };
  }, [code, resolvedTheme]);

  return <div className={`overflow-x-auto rounded-b-md border border-t-0 border-ui bg-surface p-4 ${current?.failed ? "reader-mermaid-error" : ""}`} data-testid="mermaid-diagram">
    {current?.uri ? <>
      <img src={current.uri} alt={current.title ?? (zh ? "Mermaid 图表；可展开下方源码" : "Mermaid diagram; source available below")} aria-describedby={current.description ? descriptionId : undefined} className="mx-auto max-w-full" />
      {current.description ? <p id={descriptionId} className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-secondary">{current.description}</p> : null}
    </> : <p className={`text-xs ${current?.failed ? "text-[var(--callout-warning-text)]" : "text-secondary"}`} role="status">{current?.failed
      ? (zh ? "图表暂时无法渲染，已保留源码。" : "The diagram could not be rendered; the source is preserved.")
      : (zh ? "正在渲染 Mermaid 图表…" : "Rendering Mermaid diagram…")}</p>}
    <details className="mt-2 text-xs text-secondary" open={current?.failed || undefined}>
      <summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{zh ? "图表源码" : "Diagram source"}</summary>
      <pre tabIndex={0} role="region" aria-label={zh ? "Mermaid 图表源码" : "Mermaid diagram source"} className="max-h-96 max-w-full overflow-auto rounded border border-ui bg-subtle p-3 text-xs leading-5 text-primary"><code>{code}</code></pre>
    </details>
  </div>;
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
  const opening = findOpeningThinkingSummary(text);
  if (opening) {
    const thinkingText = text.slice(0, opening.endOffset);
    const answerText = text.slice(opening.endOffset);
    return [
      { kind: "thinking", label: opening.label, text: thinkingText },
      ...(answerText ? [{ kind: "markdown" as const, text: answerText }] : []),
    ];
  }
  return text.trim() ? [{ kind: "markdown", text }] : [];
}

function stripQuote(line: string): string {
  let stripped = line.trim();
  while (stripped.startsWith(">")) {
    stripped = stripped.slice(1).trim();
  }
  return stripped;
}

function calloutClassName(type: string): string {
  if (type === "warning" || type === "caution" || type === "danger" || type === "failure" || type === "bug") {
    return "border-[var(--callout-warning-border)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-text)]";
  }
  if (type === "tip" || type === "todo" || type === "success" || type === "example") {
    return "border-[var(--callout-tip-border)] bg-[var(--callout-tip-bg)] text-[var(--callout-tip-text)]";
  }
  if (type === "important") {
    return "border-[var(--callout-important-border)] bg-[var(--callout-important-bg)] text-[var(--callout-important-text)]";
  }
  return "border-[var(--callout-note-border)] bg-[var(--callout-note-bg)] text-[var(--callout-note-text)]";
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
    ltx: "latex",
    md: "markdown",
    py: "python",
    shell: "bash",
    ts: "typescript",
    tex: "latex",
    yml: "yaml",
  };
  return aliases[normalized] ?? (normalized as BundledLanguage);
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.includes("\\")) return false;
  if (/^\/(?!\/)/.test(trimmed)) {
    const path = trimmed.split(/[?#]/, 1)[0] ?? "";
    return !path.split("/").some((segment) => segment === "..") && !hasUnsafeLocalPathEncoding(path);
  }
  return /^(https?:|mailto:|#)/i.test(trimmed);
}

function hasUnsafeLocalPathEncoding(value: string): boolean {
  return /%(?:2e|2f|5c)/i.test(value);
}
