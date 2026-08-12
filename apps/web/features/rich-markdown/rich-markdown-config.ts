import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Options } from "react-markdown";
import { remarkAiMathCompatibility } from "./remark-ai-math-compatibility";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export const RICH_MARKDOWN_RENDERER_VERSION = "ai-rich-markdown-v2";

const BASE_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  // Existing Chat Reader conversations intentionally preserve a single source
  // newline as a visual break. This is the frozen AI soft-break profile.
  remarkBreaks,
  [remarkMath, { singleDollarTextMath: true }],
  remarkAiMathCompatibility,
];

const BASE_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  rehypeSanitize,
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
