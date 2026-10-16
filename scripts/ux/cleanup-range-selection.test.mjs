import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const code = ts.transpileModule(readFileSync(new URL("../../apps/web/features/conversations/cleanup-range-selection.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { candidateAfterText, candidateRemovalParts, candidateSelectionSource, fullCandidateRange, mergeCandidateRanges } =
  await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const range = (start, end) => ({ start_offset: start, end_offset: end });

test("retained candidate text uses absolute Unicode offsets and several deletions", () => {
  const item = { start_offset: 7, end_offset: 15, match_text: "🙂A KEEPZ" };
  assert.equal(candidateAfterText(item, [range(7, 9), range(14, 15)]), " KEEP");
  assert.equal(candidateAfterText(item, fullCandidateRange(item)), "");
  assert.equal(candidateAfterText(item, []), item.match_text);
});

test("invalid and overlapping ranges never display a guessed removal", () => {
  const item = { start_offset: 3, end_offset: 8, match_text: "abcde" };
  for (const ranges of [[range(2, 4)], [range(3, 9)], [range(3, 6), range(5, 7)], [range(4, 4)], [range(NaN, 7)]]) {
    assert.equal(candidateAfterText(item, ranges), null);
  }
  assert.equal(candidateAfterText({ ...item, match_text: "wrong length" }, [range(3, 5)]), null);
});

test("textarea LF and UTF-16 offsets map back to canonical CRLF, CR and code points", () => {
  const original = "🙂A\r\n中\rZ\n";
  const { text, boundaries } = candidateSelectionSource(original);
  assert.equal(text, "🙂A\n中\nZ\n");
  assert.deepEqual(boundaries, [0, null, 1, 2, 4, 5, 6, 7, 8]);
  assert.equal(Array.from(original).slice(boundaries[3], boundaries[5]).join(""), "\r\n中");
  assert.equal(boundaries[1], null, "a partial surrogate must not become a deletion boundary");
});

test("adding disjoint, touching and overlapping selections merges without mutating drafts", () => {
  const existing = [range(2, 4), range(10, 12)];
  assert.deepEqual(mergeCandidateRanges([...existing, range(3, 6), range(6, 8)]), [range(2, 8), range(10, 12)]);
  assert.deepEqual(existing, [range(2, 4), range(10, 12)]);
});

test("inline removal parts preserve exact Unicode source and share the retained text", () => {
  const item = { start_offset: 7, end_offset: 15, match_text: "🙂A KEEPZ" };
  const ranges = [range(7, 9), range(14, 15)];
  const parts = candidateRemovalParts(item, ranges);
  assert.deepEqual(parts, { gaps: ["", " KEEP", ""], removed: ["🙂A", "Z"] });
  assert.equal(parts.gaps.join(""), candidateAfterText(item, ranges));
  assert.equal(parts.removed.map((text, index) => parts.gaps[index] + text).join("") + parts.gaps.at(-1), item.match_text);
  assert.deepEqual(candidateRemovalParts(item, []), { gaps: [item.match_text], removed: [] });
  const crlf = { start_offset: 5, end_offset: 10, match_text: "A\r\n🙂Z" };
  assert.deepEqual(candidateRemovalParts(crlf, [range(6, 9)]), { gaps: ["A", "Z"], removed: ["\r\n🙂"] });
});

test("malformed persisted refinements fail closed for both markers and after text", () => {
  const item = { start_offset: 3, end_offset: 8, match_text: "abcde" };
  for (const ranges of [null, {}, true, [null], [3], [{ start_offset: "3", end_offset: 5 }], [{ ...range(3, 5), text: "ignored" }]]) {
    assert.equal(candidateRemovalParts(item, ranges), null);
    assert.equal(candidateAfterText(item, ranges), null);
  }
  assert.equal(candidateRemovalParts(item, Array.from({ length: 21 }, () => range(3, 4))), null);
  for (const changed of [{ start_offset: -1 }, { start_offset: 3.5 }, { end_offset: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(candidateRemovalParts({ ...item, ...changed }, [range(3, 5)]), null);
  }
});
