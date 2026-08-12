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

test("ChatGPT clipboard bare bracket display spans multiple Markdown blocks", () => {
  const source = String.raw`Before.

[
\boxed{
S_n
===

\frac1n
\sum_{k=1}^{n}
\frac{\left(\frac{k}{n}\right)^2}
{\sqrt{1+\frac{k}{n^5}}}
}
]

After.`;
  const open = source.indexOf("[\n");
  const close = source.indexOf("\n]\n", open) + 2;
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", value: "Before.", position: { start: { offset: 0 }, end: { offset: 7 } } },
      { type: "paragraph", value: "[\\boxed{S_n", position: { start: { offset: open }, end: { offset: source.indexOf("\n\n", open) } } },
      { type: "heading", depth: 1, value: "S_n", position: { start: { offset: source.indexOf("S_n", open) }, end: { offset: source.indexOf("\n\n", source.indexOf("S_n", open)) } } },
      { type: "paragraph", value: "formula remainder", position: { start: { offset: source.indexOf("\\frac1n", open) }, end: { offset: close } } },
      { type: "paragraph", value: "After.", position: { start: { offset: close + 2 }, end: { offset: source.length } } },
    ],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children).toHaveLength(3);
  expect(tree.children[1]).toMatchObject({ type: "math", data: { aiMathDelimiter: "bare-bracket" } });
  expect(tree.children[1].value).toContain("\\boxed{");
  expect(tree.children[1].value).toContain("\\sqrt{");
  expect(source.slice(open, close)).toContain("[\n");
});

test("bare brackets without strong LaTeX and fenced code remain ordinary Markdown", () => {
  const source = "[\nordinary prose\n]\n\n```latex\n[\n\\boxed{x}\n]\n```";
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", value: "ordinary", position: { start: { offset: 0 }, end: { offset: 18 } } },
      { type: "code", lang: "latex", value: "[\n\\boxed{x}\n]", position: { start: { offset: 20 }, end: { offset: source.length } } },
    ],
  };
  remarkAiMathCompatibility()(tree, { value: source });
  expect(tree.children.map((node) => node.type)).toEqual(["paragraph", "code"]);
});

test("ChatGPT slash-bracket clipboard variant remains a bounded display formula", () => {
  const source = String.raw`/[
S_n=\sum_{k=1}^{n}\frac{k^2}{\sqrt{n^6+kn}}.
]/`;
  const tree = {
    type: "root",
    children: [{
      type: "paragraph",
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
    }],
  };
  remarkAiMathCompatibility()(tree, { value: source });
  expect(tree.children[0]).toMatchObject({ type: "math", data: { aiMathDelimiter: "bare-bracket" } });
  expect((tree.children[0] as { value?: string }).value).toContain("\\sum");
});

test("ChatGPT Setext clipboard artifacts are normalized only inside display math", () => {
  const source = String.raw`[
\lim_{n\to\infty}\frac13
==========================

# \int_0^1x^2\,dx
]`;
  const tree = {
    type: "root",
    children: [{
      type: "paragraph",
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
    }],
  };
  remarkAiMathCompatibility()(tree, { value: source });
  expect(tree.children[0]).toMatchObject({ type: "math", data: { aiMathDelimiter: "bare-bracket" } });
  expect((tree.children[0] as { value?: string }).value).toBe(String.raw`\lim_{n\to\infty}\frac13
=
\int_0^1x^2\,dx`);
});
