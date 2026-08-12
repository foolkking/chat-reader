import { expect, test } from "@playwright/test";
import { remarkAiMathCompatibility } from "../features/rich-markdown/remark-ai-math-compatibility";

test("ChatGPT bracket and parenthesis delimiters become semantic math nodes", () => {
  const source = String.raw`\[
\boxed{x^2}
\]

Chinese \(x^2+y^2\) text.`;
  const paragraphEnd = source.indexOf("\n\n");
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        position: { start: { offset: 0 }, end: { offset: paragraphEnd } },
        children: [{ type: "text", value: "[\n\\boxed{x^2}\n]", position: { start: { offset: 0 }, end: { offset: paragraphEnd } } }],
      },
      {
        type: "paragraph",
        position: { start: { offset: paragraphEnd + 2 }, end: { offset: source.length } },
        children: [{ type: "text", value: "Chinese (x^2+y^2) text.", position: { start: { offset: paragraphEnd + 2 }, end: { offset: source.length } } }],
      },
    ],
  };
  const canonicalBefore = source;

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children[0]).toMatchObject({ type: "math", value: "\\boxed{x^2}" });
  expect(tree.children[1].children).toMatchObject([
    { type: "text", value: "Chinese " },
    { type: "inlineMath", value: "x^2+y^2" },
    { type: "text", value: " text." },
  ]);
  expect(source).toBe(canonicalBefore);
});

test("currency is text and math delimiters inside code stay code", () => {
  const source = String.raw`The price is $20$.

\(outside\) and \`\(inline-code\)\`

\`\`\`latex
\[fenced\]
\`\`\``;
  const outsideStart = source.indexOf("\\(outside\\)");
  const outsideEnd = source.indexOf(" and ", outsideStart) + " and ".length;
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "The price is " }, { type: "inlineMath", value: "20" }, { type: "text", value: "." }] },
      {
        type: "paragraph",
        children: [
          { type: "text", value: "(outside) and ", position: { start: { offset: outsideStart }, end: { offset: outsideEnd } } },
          { type: "inlineCode", value: "\\(inline-code\\)" },
        ],
      },
      { type: "code", lang: "latex", value: "\\[fenced\\]" },
    ],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children[0].children?.[1]).toEqual({ type: "text", value: "$20$", position: undefined });
  expect(tree.children[1].children).toMatchObject([
    { type: "inlineMath", value: "outside" },
    { type: "text", value: " and " },
    { type: "inlineCode", value: "\\(inline-code\\)" },
  ]);
  expect(tree.children[2]).toMatchObject({ type: "code", value: "\\[fenced\\]" });
});
