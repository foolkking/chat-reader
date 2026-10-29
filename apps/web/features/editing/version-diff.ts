export type VersionDiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

const MAX_TEXT_LENGTH = 80_000;
const MAX_LINES = 4_000;
const MAX_LCS_CELLS = 1_500_000;

export function versionText(value: { display_text?: string; plain_text?: string }): string {
  return value.display_text || value.plain_text || "";
}

export function buildVersionDiff(leftText: string, rightText: string): {
  lines: VersionDiffLine[];
  truncated: boolean;
} {
  const left = boundedLines(leftText);
  const right = boundedLines(rightText);
  const truncated = left.truncated || right.truncated;
  const leftLines = left.lines;
  const rightLines = right.lines;
  if (leftLines.length * rightLines.length > MAX_LCS_CELLS) {
    return {
      lines: [
        ...leftLines.map((text) => ({ kind: "removed" as const, text })),
        ...rightLines.map((text) => ({ kind: "added" as const, text })),
      ],
      truncated: true,
    };
  }

  const table: number[][] = Array.from({ length: leftLines.length + 1 }, () => (
    new Array<number>(rightLines.length + 1).fill(0)
  ));
  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = leftLines[leftIndex] === rightLines[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  const lines: VersionDiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      lines.push({ kind: "same", text: leftLines[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      lines.push({ kind: "removed", text: leftLines[leftIndex] });
      leftIndex += 1;
    } else {
      lines.push({ kind: "added", text: rightLines[rightIndex] });
      rightIndex += 1;
    }
  }
  while (leftIndex < leftLines.length) {
    lines.push({ kind: "removed", text: leftLines[leftIndex] });
    leftIndex += 1;
  }
  while (rightIndex < rightLines.length) {
    lines.push({ kind: "added", text: rightLines[rightIndex] });
    rightIndex += 1;
  }
  return { lines, truncated };
}

function boundedLines(value: string): { lines: string[]; truncated: boolean } {
  const truncated = value.length > MAX_TEXT_LENGTH;
  const bounded = value.slice(0, MAX_TEXT_LENGTH);
  const lines = bounded.split(/\r?\n/);
  if (lines.length <= MAX_LINES) return { lines, truncated };
  return { lines: lines.slice(0, MAX_LINES), truncated: true };
}
