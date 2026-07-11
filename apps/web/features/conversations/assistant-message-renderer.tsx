"use client";

import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { BlockRenderer } from "./block-renderer";
import { MarkdownRenderer, ThinkingDisclosure, stripLeadingTimestamp } from "./markdown-renderer";

const THINKING_LABEL = "思考过程";
const THINKING_DURATION_RE =
  /^(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*((?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))$/i;
const ANSWER_START_RE = /^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|正式回答|final answer|answer)\s*[:：])/i;
const TRACE_PREFIXES = ["考虑", "分析", "整理", "搜索", "检索", "浏览", "查找", "提炼", "规划", "总结"];

export function AssistantMessageRenderer({
  message,
  blocks,
  highlightTargetId,
}: {
  message: MessageListItem;
  blocks: RenderBlockRead[];
  highlightTargetId?: string | null;
}) {
  const isAssistant = message.role === "assistant";

  if (blocks.length === 0) {
    const text = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
    return text.trim() ? (
      <MarkdownRenderer text={text} isAssistant={isAssistant} />
    ) : (
      <p className="text-sm text-[#6b7280]">No displayable content.</p>
    );
  }

  const leadingThinking = isAssistant ? findLeadingThinkingBlocks(blocks) : null;
  const visibleBlocks = leadingThinking ? blocks.slice(leadingThinking.endIndex + 1) : blocks;

  return (
    <div className="space-y-4 break-words">
      {leadingThinking ? (
        <ThinkingDisclosure label={leadingThinking.label} text={leadingThinking.text} />
      ) : null}
      {visibleBlocks.map((block, index) => (
        <div
          key={block.id ?? `${message.id}-${index}`}
          id={`block-${message.id}-${block.block_index}`}
          data-block-index={block.block_index}
          className={`max-w-full rounded-xl transition ${
            highlightTargetId === `block-${message.id}-${block.block_index}`
              ? "ring-2 ring-[#f59e0b]/70 ring-offset-4 ring-offset-[#f7f7f8]"
              : ""
          }`}
        >
          <BlockRenderer block={block} isAssistant={isAssistant} />
        </div>
      ))}
      {visibleBlocks.length === 0 ? null : null}
    </div>
  );
}

function findLeadingThinkingBlocks(blocks: RenderBlockRead[]): { endIndex: number; text: string; label: string } | null {
  let scannedChars = 0;
  const captured: string[] = [];
  for (let index = 0; index < Math.min(blocks.length, 24); index += 1) {
    const text = stripLeadingTimestamp(readBlockText(blocks[index] ?? null)).trim();
    if (!text) {
      continue;
    }
    const lines = text.split(/\r?\n/).map((line) => stripQuote(line).trim()).filter(Boolean);
    scannedChars += text.length;
    if (scannedChars > 4000) {
      return null;
    }
    if (lines.some((line) => ANSWER_START_RE.test(line))) {
      return null;
    }
    captured.push(text);
    const durationLine = lines.find((line) => THINKING_DURATION_RE.test(line));
    if (durationLine) {
      const duration = durationLine.match(THINKING_DURATION_RE)?.[1] ?? null;
      return {
        endIndex: index,
        text: captured.join("\n\n"),
        label: duration ? `${THINKING_LABEL} · ${duration.replace(/\s+/g, " ")}` : THINKING_LABEL,
      };
    }
    if (!looksLikeThinkingBlock(lines)) {
      return null;
    }
  }
  return null;
}

function looksLikeThinkingBlock(lines: string[]): boolean {
  if (lines.length === 0) {
    return true;
  }
  return lines.every((line) => {
    if (line.length <= 180 && TRACE_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      return true;
    }
    if (line.startsWith("[") || line.startsWith("- ") || line.startsWith("* ") || /^\d+[.)]\s+/.test(line)) {
      return true;
    }
    if (line.includes("http://") || line.includes("https://") || line.includes("](")) {
      return true;
    }
    return false;
  });
}

function readBlockText(block: RenderBlockRead | null): string {
  if (!block) {
    return "";
  }
  if (typeof block.plain_text === "string") {
    return block.plain_text;
  }
  const value = block.data.text ?? block.data.title ?? block.data.code;
  return typeof value === "string" ? value : "";
}

function stripQuote(line: string): string {
  let stripped = line.trim();
  while (stripped.startsWith(">")) {
    stripped = stripped.slice(1).trim();
  }
  return stripped;
}
