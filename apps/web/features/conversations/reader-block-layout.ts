import type { RenderBlockRead } from "../../lib/types";

export type ReaderBlockLayoutMetrics = {
  contentWidth: number;
  fontSize: number;
  lineHeight: number;
  density: string;
  estimatedColumns: number;
};

export const DEFAULT_READER_BLOCK_LAYOUT_METRICS: ReaderBlockLayoutMetrics = {
  contentWidth: 720,
  fontSize: 17,
  lineHeight: 27.625,
  density: "comfortable",
  estimatedColumns: 76,
};

const WIDE_CHARACTER_RE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;

export function estimateReaderBlockSize(
  block: RenderBlockRead | undefined,
  metrics: ReaderBlockLayoutMetrics = DEFAULT_READER_BLOCK_LAYOUT_METRICS,
  renderedText?: string,
): number {
  if (!block) return Math.round(metrics.lineHeight * 3.5);

  const text = renderedText ?? block.plain_text ?? blockText(block);
  const minimumGap = Math.max(12, Math.round(metrics.lineHeight * 0.48));
  if (!text.trim()) return minimumGap;

  if (block.block_type === "image" || block.block_type === "mermaid") return 420;
  if (block.block_type === "attachment") return 68;

  const visualLines = estimateVisualLineCount(text, metrics.estimatedColumns);
  if (block.block_type === "heading") {
    const level = numericValue(block.data.level) ?? 3;
    const scale = level === 1 ? 1.45 : level === 2 ? 1.3 : level === 3 ? 1.16 : 1.06;
    const borderAndPadding = level === 1 ? 20 : 14;
    return Math.max(48, Math.round(visualLines * metrics.lineHeight * scale + borderAndPadding));
  }

  if (block.block_type === "code") {
    const sourceLines = Math.max(1, text.split(/\r?\n/).length);
    const codeLineHeight = Math.max(22, metrics.lineHeight * 0.88);
    const visibleLines = Math.min(20, sourceLines);
    return Math.min(560, Math.round(80 + visibleLines * codeLineHeight));
  }

  if (block.block_type === "table") {
    const rows = Math.max(1, text.split(/\r?\n/).filter((line) => line.trim()).length);
    return Math.min(420, Math.round(52 + Math.min(8, rows) * Math.max(32, metrics.lineHeight * 1.2)));
  }

  if (block.block_type === "thematic_break" || block.block_type === "horizontal_rule") {
    return Math.max(32, Math.round(metrics.lineHeight * 1.5));
  }

  return Math.max(minimumGap, Math.min(760, Math.round(visualLines * metrics.lineHeight)));
}

export function readReaderBlockLayoutMetrics(container: HTMLElement): ReaderBlockLayoutMetrics {
  const frame = container.closest<HTMLElement>(".reader-frame");
  const style = window.getComputedStyle(container);
  const frameStyle = frame ? window.getComputedStyle(frame) : null;
  const contentWidth = Math.max(1, container.getBoundingClientRect().width);
  const fontSize = positiveCssNumber(frameStyle?.getPropertyValue("--reader-font-size"))
    ?? positiveCssNumber(style.fontSize)
    ?? DEFAULT_READER_BLOCK_LAYOUT_METRICS.fontSize;
  const configuredLineHeight = positiveCssNumber(frameStyle?.getPropertyValue("--reader-line-height"));
  const computedLineHeight = positiveCssNumber(style.lineHeight);
  const lineHeight = resolveReaderLineHeight(fontSize, configuredLineHeight, computedLineHeight);
  const averageAsciiGlyphWidth = Math.max(7, fontSize * 0.56);
  const estimatedColumns = Math.max(24, Math.min(120, Math.floor(contentWidth / averageAsciiGlyphWidth)));
  return {
    contentWidth,
    fontSize,
    lineHeight,
    density: frame?.dataset.readerDensity ?? "comfortable",
    estimatedColumns,
  };
}

export function resolveReaderLineHeight(
  fontSize: number,
  configuredLineHeight: number | null,
  computedLineHeight: number | null,
): number {
  return configuredLineHeight !== null
    ? configuredLineHeight <= 4 ? configuredLineHeight * fontSize : configuredLineHeight
    : computedLineHeight ?? fontSize * 1.625;
}

export function readerBlockLayoutSignature(metrics: ReaderBlockLayoutMetrics): string {
  return [
    Math.round(metrics.contentWidth * 2) / 2,
    Math.round(metrics.fontSize * 100) / 100,
    Math.round(metrics.lineHeight * 100) / 100,
    metrics.density,
    metrics.estimatedColumns,
  ].join("|");
}

function estimateVisualLineCount(text: string, columns: number): number {
  return text.split(/\r?\n/).reduce((total, line) => {
    const units = displayUnits(line);
    return total + Math.max(1, Math.ceil(units / Math.max(1, columns)));
  }, 0);
}

function displayUnits(value: string): number {
  let units = 0;
  for (const character of value) units += WIDE_CHARACTER_RE.test(character) ? 2 : 1;
  return units;
}

function blockText(block: RenderBlockRead): string {
  for (const key of ["text", "title", "code"] as const) {
    const value = block.data[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function numericValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveCssNumber(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
