"use client";

import type { ClipboardEvent, ReactNode } from "react";
import { getRenderedBlockMarkdown } from "./rendered-block-registry";

const COPY_BLOCK_SELECTOR = '[data-reader-copy-block="true"]';
const COPY_IGNORE_SELECTOR = '[data-markdown-copy-ignore="true"], [data-message-meta], button, input, select, textarea, script, style';

export function ReaderMarkdownCopyBoundary({ children, className }: { children: ReactNode; className?: string }) {
  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const root = event.currentTarget;
    if (!containsRangeEndpoint(root, range.startContainer) || !containsRangeEndpoint(root, range.endContainer)) return;

    const blocks = Array.from(root.querySelectorAll<HTMLElement>(COPY_BLOCK_SELECTOR))
      .filter((block) => safelyIntersects(range, block));
    if (blocks.length === 0) return;

    const messageParts = new Map<HTMLElement, string[]>();
    for (const block of blocks) {
      const article = block.closest<HTMLElement>("article[data-message-id]");
      if (!article) return;
      const markdown = rangeCoversNode(range, block)
        ? getRenderedBlockMarkdown(block)
        : serializeSelectedMarkdown(block, range);
      if (markdown === null) return;
      const trimmed = markdown.trim();
      if (!trimmed) continue;
      const parts = messageParts.get(article) ?? [];
      parts.push(trimmed);
      messageParts.set(article, parts);
    }

    const markdown = Array.from(messageParts.values())
      .map((parts) => parts.join("\n\n"))
      .filter(Boolean)
      .join("\n\n");
    if (!markdown) return;

    event.preventDefault();
    event.clipboardData.setData("text/plain", markdown);
    event.clipboardData.setData("text/markdown", markdown);
  }

  return <div className={className} onCopy={handleCopy}>{children}</div>;
}

function containsRangeEndpoint(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
}

function safelyIntersects(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function rangeCoversNode(range: Range, node: Node): boolean {
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);
  return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0;
}

function serializeSelectedMarkdown(root: HTMLElement, range: Range): string | null {
  try {
    return serializeNode(root, range).trim();
  } catch {
    return null;
  }
}

function serializeNode(node: Node, range: Range): string {
  if (!safelyIntersects(range, node)) return "";
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : value.length;
    return value.slice(Math.max(0, start), Math.min(value.length, end));
  }
  if (!(node instanceof HTMLElement)) return serializeChildren(node, range);
  if (node.matches(COPY_IGNORE_SELECTOR) || node.getAttribute("aria-hidden") === "true") return "";

  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "img") {
    const alt = node.getAttribute("alt") ?? "";
    const src = node.getAttribute("src") ?? "";
    return src ? `![${alt}](${src})` : alt;
  }
  if (tag === "table") return serializeTable(node, range);

  const content = serializeChildren(node, range);
  if (!content) return "";
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `*${content}*`;
  if (tag === "del" || tag === "s") return `~~${content}~~`;
  if (tag === "a") {
    const href = node.getAttribute("href");
    return href ? `[${content}](${href})` : content;
  }
  if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") {
    const fence = content.includes("``") ? "```" : content.includes("`") ? "``" : "`";
    return `${fence}${content}${fence}`;
  }
  if (tag === "pre") {
    const language = node.closest<HTMLElement>("[data-copy-language]")?.dataset.copyLanguage
      ?? node.parentElement?.querySelector<HTMLElement>("span.font-mono")?.textContent?.trim();
    const fenceLanguage = language && language !== "text" ? language : "";
    return `\`\`\`${fenceLanguage}\n${content.replace(/\n+$/, "")}\n\`\`\``;
  }
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${content.trim()}\n\n`;
  if (tag === "blockquote") {
    return `${content.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "li") {
    const parent = node.parentElement;
    const prefix = parent?.tagName.toLowerCase() === "ol"
      ? `${Array.from(parent.children).indexOf(node) + 1}. `
      : "- ";
    return `${prefix}${content.trim()}\n`;
  }
  if (tag === "p") return `${content.trimEnd()}\n\n`;
  if (tag === "hr") return "---\n\n";
  return content;
}

function serializeChildren(node: Node, range: Range): string {
  return Array.from(node.childNodes).map((child) => serializeNode(child, range)).join("");
}

function serializeTable(table: HTMLElement, range: Range): string {
  const rows = Array.from(table.querySelectorAll("tr"))
    .filter((row) => safelyIntersects(range, row))
    .map((row) => Array.from(row.querySelectorAll<HTMLElement>(":scope > th, :scope > td"))
      .map((cell) => serializeChildren(cell, range).trim().replace(/\|/g, "\\|")));
  if (rows.length === 0) return "";
  const output = rows.map((cells) => `| ${cells.join(" | ")} |`);
  if (table.querySelector("thead") && rows[0]) output.splice(1, 0, `| ${rows[0].map(() => "---").join(" | ")} |`);
  return `${output.join("\n")}\n\n`;
}
