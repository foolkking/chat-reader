import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Options } from "react-markdown";
import { remarkAiMathCompatibility } from "./remark-ai-math-compatibility";
import { remarkReaderHighlight } from "./remark-reader-highlight";
import { remarkReaderCallouts } from "./remark-reader-callouts";
import rehypeKatex from "rehype-katex";
import { remarkSafeHtml } from "./remark-safe-html";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export const RICH_MARKDOWN_RENDERER_VERSION = "ai-rich-markdown-v13";

const BASE_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  // Preserve source coordinates before soft-break/highlight transforms split
  // text nodes. The extracted callout body still receives every later plugin.
  remarkReaderCallouts,
  // Existing Chat Reader conversations intentionally preserve a single source
  // newline as a visual break. This is the frozen AI soft-break profile.
  remarkBreaks,
  [remarkMath, { singleDollarTextMath: true }],
  remarkAiMathCompatibility,
  remarkReaderHighlight,
  remarkSafeHtml,
  remarkParseProbe,
];

/** Opt-in synthetic test instrumentation at the real Markdown pipeline. */
function remarkParseProbe() {
  return () => {
    if (typeof window === "undefined") return;
    const probe = (window as typeof window & { __chatReaderPerfProbe?: { markdownParseTotal?: number } }).__chatReaderPerfProbe;
    if (probe) probe.markdownParseTotal = (probe.markdownParseTotal ?? 0) + 1;
  };
}

const RICH_MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "audio", "dd", "dl", "dt", "figcaption", "figure", "mark", "small", "u", "video"],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify", "dataReaderMargin",
      "dataReaderRadius", "dataReaderFlex", "dataReaderWidth", "dataReaderMaxWidth", "dataReaderHtmlFragment",
      "dataReaderCallout",
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify", "dataReaderMargin",
      "dataReaderRadius", "dataReaderFlex", "dataReaderWidth", "dataReaderMaxWidth",
    ],
    section: [
      ...(defaultSchema.attributes?.section ?? []),
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify", "dataReaderMargin",
      "dataReaderRadius", "dataReaderFlex", "dataReaderWidth", "dataReaderMaxWidth",
    ],
    audio: [...(defaultSchema.attributes?.audio ?? []), "src", "controls", "preload", "dataAttachmentId", "dataOccurrenceKey"],
    details: [...(defaultSchema.attributes?.details ?? []), "open", "dataReaderCallout"],
    p: [...(defaultSchema.attributes?.p ?? []), "dataReaderCalloutTitle"],
    a: [...(defaultSchema.attributes?.a ?? []), "dataAttachmentId", "dataOccurrenceKey"],
    mark: [...(defaultSchema.attributes?.mark ?? [])],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "alt", "width", "height",
      "dataAttachmentId", "dataOccurrenceKey",
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify", "dataReaderMargin",
      "dataReaderRadius", "dataReaderFlex", "dataReaderWidth", "dataReaderMaxWidth",
    ],
    video: [
      ...(defaultSchema.attributes?.video ?? []),
      "src", "controls", "preload", "playsInline", "width", "height",
      "dataAttachmentId", "dataOccurrenceKey",
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify", "dataReaderMargin",
      "dataReaderRadius", "dataReaderFlex", "dataReaderWidth", "dataReaderMaxWidth",
    ],
  },
};

const BASE_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  [rehypeSanitize, RICH_MARKDOWN_SANITIZE_SCHEMA],
  [rehypeKatex, {
    output: "htmlAndMathml",
    trust: false,
    throwOnError: false,
    strict: "warn",
    maxExpand: 1000,
    maxSize: 20,
  }],
  rehypeMathErrorFallback,
];

export function richMarkdownRemarkPlugins(
  extra: NonNullable<Options["remarkPlugins"]> = [],
): NonNullable<Options["remarkPlugins"]> {
  return extra.length ? [...BASE_REMARK_PLUGINS, ...extra] : BASE_REMARK_PLUGINS;
}

export function richMarkdownRehypePlugins(): NonNullable<Options["rehypePlugins"]> {
  return BASE_REHYPE_PLUGINS;
}

export function scopedRichMarkdownRehypePlugins(scopeId: string): NonNullable<Options["rehypePlugins"]> {
  return [...BASE_REHYPE_PLUGINS, [rehypeNamespaceFootnotes, { scopeId }]];
}

export function richMarkdownRehypeOptions(scopeId: string) {
  return { clobberPrefix: `cr-md-${safeScope(scopeId)}-` };
}

function rehypeMathErrorFallback() {
  return (tree: HastNode) => {
    walk(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "span") return;
      const className = node.properties?.className;
      const classes = Array.isArray(className) ? className.map(String) : typeof className === "string" ? className.split(/\s+/) : [];
      if (!classes.includes("katex-error")) return;
      const latex = textContent(node);
      node.properties = {
        ...node.properties,
        role: "note",
        "aria-label": `无法渲染公式：${latex}`,
        "data-math-error": "true",
      };
      node.children = [
        { type: "element", tagName: "span", properties: { className: ["sr-only"] }, children: [{ type: "text", value: "无法渲染公式：" }] },
        { type: "text", value: latex },
      ];
    });
  };
}

function rehypeNamespaceFootnotes(options: { scopeId?: string } = {}) {
  const labelId = `cr-md-${safeScope(options.scopeId ?? "content")}-footnote-label`;
  return (tree: HastNode) => {
    walk(tree, (node) => {
      if (node.type !== "element") return;
      if (node.properties?.id === "footnote-label") node.properties.id = labelId;
      const describedBy = node.properties?.ariaDescribedBy;
      if (Array.isArray(describedBy)) {
        node.properties!.ariaDescribedBy = describedBy.map((value) => value === "footnote-label" ? labelId : value);
      } else if (describedBy === "footnote-label") {
        node.properties!.ariaDescribedBy = [labelId];
      }
    });
  };
}

function walk(node: HastNode, visitor: (node: HastNode) => void): void {
  visitor(node);
  node.children?.forEach((child) => walk(child, visitor));
}

function textContent(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(textContent).join("") ?? "";
}

function safeScope(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "content";
}
