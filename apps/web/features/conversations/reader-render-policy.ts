import type { RenderBlockRead } from "../../lib/types";

/** Cost hint only. It never splits source or replaces the Markdown parser. */
export function hasReaderMath(blocks: RenderBlockRead[]): boolean {
  return blocks.some(block => {
    if (block.block_type === "code") return false;
    if (block.block_type === "math") return true;
    const source = String(block.data.text ?? block.plain_text ?? "");
    const text = source.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, "").replace(/(`+)[^\n]*?\1/g, "");
    return /\\\(|\\\[|\$\$|(?<![\\$])\$[^$\n]+(?<!\\)\$|^\s*\/?\[\s*\n[\s\S]*\\[a-z]+/m.test(text);
  });
}

export function virtualizeReaderBlocks(blockCount: number, charCount: number, unitCount: number, hasMath: boolean): boolean {
  return blockCount > 160 || charCount > 50_000 || (hasMath && unitCount > 8);
}
