/**
 * Display-only opening-summary detection. Keep aligned with the API detector
 * through apps/api/tests/fixtures/thinking-summary-cases.json; never rewrite source.
 */
import type { RenderBlockRead } from "../../lib/types";

const duration = String.raw`(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*((?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))`;
const durationLine = new RegExp(`^${duration}$`, "i");
const inlineDuration = new RegExp(`^${duration}[ \\t]+(\\S.*)$`, "i");
const label = /^(?:思考|思考过程|thinking|reasoning)\s*[:：]?\s*$/i;
const timestamp = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const answerStart = /^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|正式回答|final answer|answer)\s*[:：])/i;
const tracePrefixes = ["考虑", "分析", "整理", "搜索", "检索", "浏览", "查找", "提炼", "规划", "总结"];

export type OpeningThinkingSummary = { endOffset: number; label: string };

export function findOpeningThinkingSummary(text: string): OpeningThinkingSummary | null {
  let scannedChars = 0;
  let lines = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (++lines > 80) break;
    const raw = match[0].replace(/[\r\n]+$/, "");
    const normalized = raw.trim().replace(/^(?:>\s*)+/, "").trim();
    scannedChars += Array.from(normalized).length;
    if (scannedChars > 8000) return null;
    if (!normalized) continue;
    if (answerStart.test(normalized) || /^(?:`{3}|~{3})/.test(normalized) || /^(?: {4}|\t)/.test(raw)) return null;
    const standalone = normalized.match(durationLine);
    const inline = normalized.match(inlineDuration);
    if (standalone || inline) {
      let endOffset = (match.index ?? 0) + match[0].length;
      if (inline) {
        endOffset = (match.index ?? 0) + raw.trimEnd().length - inline[2].length;
      } else {
        while (endOffset < text.length && /[\r\n]/.test(text[endOffset])) endOffset += 1;
      }
      return { endOffset, label: `思考过程 · ${(standalone?.[1] ?? inline?.[1] ?? "").replace(/\s+/g, " ")}` };
    }
    if (!looksLikeTraceLine(raw, normalized)) return null;
  }
  return null;
}

function looksLikeTraceLine(raw: string, line: string): boolean {
  const length = Array.from(line).length;
  return label.test(line) || timestamp.test(line)
    || (raw.trimStart().startsWith(">") && length <= 180)
    || (tracePrefixes.some(prefix => line.startsWith(prefix)) && length <= 120)
    || /^(?:\[|- |\* |\d+[.)]\s+)/.test(line)
    || line.includes("http://") || line.includes("https://") || line.includes("](");
}

export function findLeadingThinkingBlocks(blocks: RenderBlockRead[]): {
  endIndex: number; text: string; label: string; remainder: RenderBlockRead | null; summaryBlocks: RenderBlockRead[];
} | null {
  // A hydrated window beginning in the middle of a message is not a prefix.
  if (blocks[0]?.block_index !== 0) return null;
  let captured = "";
  for (let index = 0; index < Math.min(blocks.length, 80); index += 1) {
    const block = blocks[index];
    if (block.block_type !== "paragraph") return null;
    const text = block.plain_text ?? (typeof block.data.text === "string" ? block.data.text : "");
    const blockStart = captured.length + (index ? 2 : 0);
    captured += `${index ? "\n\n" : ""}${text}`;
    const summary = findOpeningThinkingSummary(captured);
    if (summary) {
      const remainingText = captured.slice(summary.endOffset);
      return {
        endIndex: index,
        text: captured.slice(0, summary.endOffset),
        label: summary.label,
        summaryBlocks: [...blocks.slice(0, index), remainingText.trim() ? {
          ...block, plain_text: text.slice(0, summary.endOffset - blockStart),
          data: { ...block.data, text: text.slice(0, summary.endOffset - blockStart) },
        } : block],
        remainder: remainingText.trim() ? {
          ...block, plain_text: remainingText, char_count: remainingText.length,
          data: { ...block.data, text: remainingText }, collapsed_by_default: false,
        } : null,
      };
    }
    // Do not accumulate or repeatedly copy an unbounded message window.
    if (blockStart + text.length > 16_000) return null;
  }
  return null;
}
