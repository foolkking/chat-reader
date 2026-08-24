import { expect, test } from "@playwright/test";
import {
  normalizeDisplayMathForRenderer,
  remarkAiMathCompatibility,
} from "../features/rich-markdown/remark-ai-math-compatibility";

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

test("long escaped display math spanning parsed headings is recovered as one node", () => {
  const source = String.raw`\[
\mathbb E[f(X)]
=
\int_{\mathbb R^n}
f(\mathbf x)
\frac{1}{(2\pi)^{n/2}|\Sigma|^{1/2}}
\exp\left[-\frac12(\mathbf x-\boldsymbol\mu)^\top\Sigma^{-1}(\mathbf x-\boldsymbol\mu)\right]
\,d\mathbf x
\]`;
  const split = source.indexOf("\\int");
  const tree = {
    type: "root",
    children: [
      {
        type: "heading",
        position: { start: { offset: 0 }, end: { offset: split - 1 } },
        children: [],
      },
      {
        type: "paragraph",
        position: { start: { offset: split }, end: { offset: source.length } },
        children: [],
      },
    ],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children).toHaveLength(1);
  expect(tree.children[0]).toMatchObject({
    type: "math",
    data: { aiMathDelimiter: "bracket" },
  });
  expect((tree.children[0] as { value?: string }).value).toContain("\\mathbb E[f(X)]");
  expect(normalizeDisplayMathForRenderer(source)).toContain("\\left\\lbrack");
  expect(normalizeDisplayMathForRenderer(source)).toContain("\\right\\rbrack");
});

test("render normalization separates an exported display formula from prose without touching line breaks", () => {
  const source = String.raw`*italic* and formula \[
\int_0^1 x^2\,dx=\frac13
\]

\begin{aligned}a&=b\\[4pt]c&=d\end{aligned}`;
  const normalized = normalizeDisplayMathForRenderer(source);
  expect(normalized).toContain("formula\n\n\\[\n\\int");
  expect(normalized).toContain("a&=b\\\\[4pt]c&=d");
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

test("ChatGPT clipboard bare inline parentheses recover compact math in prose", () => {
  const source = "对 (k) 求和，根号中最高次是 (n^6)，所以应该提出 (n^6)，极限为 (1/3)。";
  const tree = {
    type: "root",
    children: [{
      type: "paragraph",
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
    }],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children[0].children).toMatchObject([
    { type: "text", value: "对 " },
    { type: "inlineMath", value: "k", data: { aiMathDelimiter: "bare-paren" } },
    { type: "text", value: " 求和，根号中最高次是 " },
    { type: "inlineMath", value: "n^6", data: { aiMathDelimiter: "bare-paren" } },
    { type: "text", value: "，所以应该提出 " },
    { type: "inlineMath", value: "n^6", data: { aiMathDelimiter: "bare-paren" } },
    { type: "text", value: "，极限为 " },
    { type: "inlineMath", value: "1/3", data: { aiMathDelimiter: "bare-paren" } },
    { type: "text", value: "。" },
  ]);
  expect(source).toContain("(n^6)");
});

test("bare parenthetical prose, dates, versions, and code remain text", () => {
  const source = "说明 (Appendix A)、接口 (API/v1)、日期 (2026-08-12) 与 `代码 (n^6)`。";
  const codeStart = source.indexOf("`代码");
  const textEnd = codeStart - 1;
  const tree = {
    type: "root",
    children: [{
      type: "paragraph",
      children: [
        { type: "text", value: source.slice(0, textEnd), position: { start: { offset: 0 }, end: { offset: textEnd } } },
        { type: "inlineCode", value: "代码 (n^6)" },
        { type: "text", value: "。", position: { start: { offset: source.length - 1 }, end: { offset: source.length } } },
      ],
    }],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children[0].children?.filter((node) => node.type === "inlineMath")).toHaveLength(0);
  expect(tree.children[0].children?.[1]).toMatchObject({ type: "inlineCode", value: "代码 (n^6)" });
});

test("standalone bare brackets accept a pure mathematical expression without a LaTeX command", () => {
  const source = "[\nf(x)=x^2.\n]";
  const tree = {
    type: "root",
    children: [{
      type: "paragraph",
      position: { start: { offset: 0 }, end: { offset: source.length } },
      children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
    }],
  };

  remarkAiMathCompatibility()(tree, { value: source });

  expect(tree.children[0]).toMatchObject({
    type: "math",
    value: "f(x)=x^2.",
    data: { aiMathDelimiter: "bare-bracket" },
  });
});

test("standalone bare brackets recover compact products while ordinary prose remains text", () => {
  const sources = ["[\nkn\n]", "[\nn^6+kn\n]", "[\nordinary prose\n]"];
  const rendered = sources.map((source) => {
    const tree = {
      type: "root",
      children: [{
        type: "paragraph",
        position: { start: { offset: 0 }, end: { offset: source.length } },
        children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
      }],
    };
    remarkAiMathCompatibility()(tree, { value: source });
    return tree.children[0];
  });

  expect(rendered[0]).toMatchObject({ type: "math", value: "kn" });
  expect(rendered[1]).toMatchObject({ type: "math", value: "n^6+kn" });
  expect(rendered[2]).toMatchObject({ type: "paragraph" });
});

test("standalone ChatGPT brackets recover common scientific LaTeX commands", () => {
  const sources = [
    "[\ns=(1-\\lambda)s_{text}\n]",
    "[\nH_q\\in\\mathbb R^{L_q\\times D}\n]",
    "[\n\\langle h_q,h_d\\rangle\\neq0\n]",
    "[\nq\\xrightarrow{\\mathrm{Retriever}}Evidence\n]",
    "[\nPaper\\ Retrieval\n]",
  ];

  for (const source of sources) {
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
  }
});

test("standalone ChatGPT display labels render without accepting ordinary prose", () => {
  const sources = [
    "[\nImage > Text\n]",
    "[\nText > Image\n]",
    "[\nImage+Text\n]",
    "[\nText-only\n]",
    "[\nImage\n]",
    "[\nOCR/Text\n]",
    "[\nQuestion\n]",
    "[\nAnswer + Provenance\n]",
    "[\nordinary prose\n]",
    "[\nAppendix A\n]",
  ];
  const rendered = sources.map((source) => {
    const tree = {
      type: "root",
      children: [{
        type: "paragraph",
        position: { start: { offset: 0 }, end: { offset: source.length } },
        children: [{ type: "text", value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }],
      }],
    };
    remarkAiMathCompatibility()(tree, { value: source });
    return tree.children[0];
  });

  expect(rendered.slice(0, 8).every((node) => node.type === "math")).toBe(true);
  expect(rendered[0]).toMatchObject({ value: "\\text{Image} > \\text{Text}" });
  expect(rendered[2]).toMatchObject({ value: "\\text{Image} + \\text{Text}" });
  expect(rendered[7]).toMatchObject({ value: "\\text{Answer} + \\text{Provenance}" });
  expect(rendered[8]).toMatchObject({ type: "paragraph" });
  expect(rendered[9]).toMatchObject({ type: "paragraph" });
});
