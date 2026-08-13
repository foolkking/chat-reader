import { expect, test } from "@playwright/test";
import type { RenderBlockRead } from "../lib/types";
import {
  DEFAULT_READER_BLOCK_LAYOUT_METRICS,
  estimateReaderBlockSize,
  resolveReaderLineHeight,
} from "../features/conversations/reader-block-layout";

const metrics = {
  ...DEFAULT_READER_BLOCK_LAYOUT_METRICS,
  contentWidth: 720,
  estimatedColumns: 76,
};

test.describe("Reader virtual block height estimator", () => {
  test("keeps empty, paragraph, heading, and code estimates near their visual shapes", () => {
    expect(estimateReaderBlockSize(block("paragraph", ""), metrics)).toBeGreaterThanOrEqual(12);
    expect(estimateReaderBlockSize(block("paragraph", ""), metrics)).toBeLessThanOrEqual(16);

    const shortParagraph = estimateReaderBlockSize(block("paragraph", "A short paragraph."), metrics);
    expect(shortParagraph).toBeGreaterThanOrEqual(26);
    expect(shortParagraph).toBeLessThanOrEqual(30);

    const heading = estimateReaderBlockSize(block("heading", "A section heading", { level: 2 }), metrics);
    expect(heading).toBeGreaterThanOrEqual(48);
    expect(heading).toBeLessThanOrEqual(54);

    const oneLineCode = estimateReaderBlockSize(block("code", "const ready = true;"), metrics);
    const twoLineCode = estimateReaderBlockSize(block("code", "const ready = true;\nreturn ready;"), metrics);
    expect(oneLineCode).toBeGreaterThanOrEqual(102);
    expect(oneLineCode).toBeLessThanOrEqual(106);
    expect(twoLineCode - oneLineCode).toBeGreaterThanOrEqual(23);
    expect(twoLineCode - oneLineCode).toBeLessThanOrEqual(26);
  });

  test("accounts for explicit lines and wide CJK or emoji glyphs", () => {
    const ascii = estimateReaderBlockSize(block("paragraph", "a".repeat(70)), metrics);
    const cjk = estimateReaderBlockSize(block("paragraph", "中".repeat(70)), metrics);
    const emoji = estimateReaderBlockSize(block("paragraph", "🙂".repeat(70)), metrics);
    const explicitLines = estimateReaderBlockSize(block("paragraph", "one\ntwo\nthree"), metrics);

    expect(ascii).toBe(Math.round(metrics.lineHeight));
    expect(cjk).toBe(Math.round(metrics.lineHeight * 2));
    expect(emoji).toBe(Math.round(metrics.lineHeight * 2));
    expect(explicitLines).toBe(Math.round(metrics.lineHeight * 3));
  });

  test("derives an absolute line height from the unitless Reader preference", () => {
    expect(resolveReaderLineHeight(20, 1.5, 30)).toBe(30);
    expect(resolveReaderLineHeight(20, 32, 30)).toBe(32);
    expect(resolveReaderLineHeight(20, null, 30)).toBe(30);
  });

  test("treats display math as a bounded horizontal surface", () => {
    const short = estimateReaderBlockSize(block("paragraph", "\\[x^2+y^2=z^2\\]"), metrics);
    const long = estimateReaderBlockSize(block("paragraph", `\\[${"\\frac{x^2+y^2}{z}".repeat(80)}\\]`), metrics);
    const aligned = estimateReaderBlockSize(block("paragraph", String.raw`\[
\begin{aligned}
a &= b + c \\
d &= e + f \\
g &= h + i
\end{aligned}
\]`), metrics);

    expect(short).toBeGreaterThanOrEqual(68);
    expect(long).toBe(short);
    expect(aligned).toBeGreaterThan(short);
    expect(aligned).toBeLessThan(260);
  });

  test("ignores math delimiters in code and does not treat currency as math", () => {
    const code = estimateReaderBlockSize(block("paragraph", "`\\(x^2\\)` and ```latex\n\\[x^2\\]\n```"), metrics);
    const currency = estimateReaderBlockSize(block("paragraph", "The price is $20."), metrics);
    expect(code).toBeGreaterThan(metrics.lineHeight);
    expect(currency).toBe(Math.round(metrics.lineHeight));
  });
});

function block(blockType: string, plainText: string, data: Record<string, unknown> = {}): RenderBlockRead {
  return {
    block_index: 0,
    block_type: blockType,
    plain_text: plainText,
    data,
    char_count: plainText.length,
  };
}
