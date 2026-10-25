import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { default: ReactMarkdown } = await import(pathToFileURL(appRequire.resolve("react-markdown")).href);
const modules = new Map();
async function load(relative) {
  const url = new URL(relative, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  const output = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  let code = output;
  for (const match of output.matchAll(/from ["']([^"']+)["']/g)) {
    const specifier = match[1];
    const href = specifier.startsWith(".")
      ? (await load(new URL(specifier + ".ts", url).href)).href
      : pathToFileURL(appRequire.resolve(specifier)).href;
    code = code.replace(match[0], `from ${JSON.stringify(href)}`);
  }
  const href = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  const result = { href, module: await import(href) };
  modules.set(url.href, result);
  return result;
}
const config = (await load("../../apps/web/features/rich-markdown/rich-markdown-config.ts")).module;
const math = (await load("../../apps/web/features/rich-markdown/remark-ai-math-compatibility.ts")).module;
const path = "../../apps/web/features/rich-markdown/chatgpt-rich-text-compatibility.ts";
// Before the feature exists, exercise the actual unchanged parser rather than
// failing an import: the retained baseline then demonstrates missing semantics.
const compatibility = existsSync(new URL(path, import.meta.url))
  ? (await load(path)).module
  : { projectChatGptRichText: text => ({ text }), detectChatGptRichText: () => false };
const { projectChatGptRichText: project, detectChatGptRichText: detect } = compatibility;
function render(source, enabled) {
  const projection = project(math.normalizeDisplayMathForRenderer(source), enabled);
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: config.richMarkdownRemarkPlugins(),
    rehypePlugins: config.richMarkdownRehypePlugins(),
    skipHtml: true,
    children: projection.text,
  }));
}
const raw = `<box border radius="xl" padding={3}>
<row justify="between"><text>**Synthetic focus**</text><badge color="success">Priority</badge></row>
<divider color="subtle"/>
<text>A synthetic paragraph.</text>
</box>`;
const escaped = String.raw`\# Synthetic heading

\\\<box border radius="xl" padding={3}>
&#x20; \\\<row justify="between">
&#x20;   \\\*\\\*Synthetic focus\\\*\\\*
&#x20;   \\\<badge color="success">Priority\\\</badge>
&#x20; \\\</row>
&#x20; \\\<divider color="subtle"/>
&#x20; \\\<text>Read \\\`sample_code\\\` now.\\\</text>
\\\</box>

1\. First synthetic step
2\. Second synthetic step`;

test("nested quote/list fences, including unclosed fences, retain literal rich tags", () => {
  for (const source of [
    "> ```html\n> <box><text>Synthetic literal</text></box>",
    "> ```html\n> <box><text>Synthetic literal</text></box>\n> ```",
    "- ```html\n  <box><text>Synthetic literal</text></box>",
    "1. ~~~~html\n   <box><text>Synthetic literal</text></box>\n   ~~~~",
    "> - ```html\n>   <box><text>Synthetic literal</text></box>",
    "> ```html\r\n> <box><text>Synthetic literal</text></box>\r\n> ```",
  ]) {
    const mixed = raw + "\n\n" + source;
    assert.equal(detect(source), null, source);
    assert.ok(project(mixed).text.endsWith(source), source);
    assert.ok(project(mixed, { escapedMarkdown: true }).text.endsWith(source), source);
    assert.match(render(mixed), /&lt;box&gt;&lt;text&gt;Synthetic literal&lt;\/text&gt;&lt;\/box&gt;/);
  }
});

test("unknown or rejected HTML remains visible, literal and non-executable", () => {
  for (const source of [
    "<unrecognized>\nSynthetic retained body\n</unrecognized>",
    "<box><row><text>Synthetic retained body</row></text></box>",
    "<box><text>Synthetic retained body</text>",
    '<section onclick="synthetic()">Synthetic retained body</section>',
    "<script>Synthetic retained body</script>",
  ]) {
    assert.equal(project(source).text, source);
    const html = render(source);
    assert.match(html, /Synthetic retained body/);
    assert.match(html, /&lt;/);
    assert.doesNotMatch(html, /<(?:unrecognized|box|section|script)\b/);
  }
});

test("over-budget HTML displays complete source without relaxing recovery budgets", () => {
  const source = "<unrecognized>\n" + "Synthetic long body.\n".repeat(27_000) + "</unrecognized>";
  assert.equal(detect(source), null);
  assert.equal(project(source).text, source);
  const html = render(source);
  assert.equal((html.match(/Synthetic long body\./g) ?? []).length, 27_000);
  assert.match(html, /&lt;\/unrecognized&gt;/);
});

test("raw rich wrappers retain answer text, emphasis, badge and divider semantics", () => {
  const html = render(raw);
  assert.match(html, /<strong>Synthetic focus<\/strong>/);
  assert.match(html, /Priority/);
  assert.match(html, /A synthetic paragraph/);
  assert.match(html, /<hr/);
  assert.doesNotMatch(html, /<\/?(?:box|row|badge|text|divider)\b/);
});
test("multiply escaped rich exports restore headings, emphasis, code and ordered lists", () => {
  const html = render(escaped);
  assert.match(html, /<h1>Synthetic heading<\/h1>/);
  assert.match(html, /<strong>Synthetic focus<\/strong>/);
  assert.match(html, /<code>sample_code<\/code>/);
  assert.match(html, /<ol>/);
  assert.doesNotMatch(html, /&lt;\/?(?:box|row|badge|text|divider)\b/);
});

test("one-, two- and three-slash exported formatting is bounded to an established profile", () => {
  for (let depth = 1; depth <= 3; depth++) {
    const slash = "\\".repeat(depth);
    const source = `${slash}# Synthetic heading\n\n${slash}<box>\n${slash}<text>${slash}*${slash}*Focus${slash}*${slash}*</text>\n${slash}</box>`;
    assert.match(render(source), /<h1>Synthetic heading<\/h1>/);
    assert.match(render(source), /<strong>Focus<\/strong>/);
  }
});
test("normal Markdown, deliberately escaped prose and whitespace entities are byte-identical", () => {
  for (const source of [
    String.raw`\# literal heading and \*\*literal emphasis\*\*`,
    "# Ordinary\n\n**Normal** and `code`.\n\n1. List",
    "&#x20; a literal entity, not a rich export",
    '<text>Unprofiled custom tag</text>',
    "The word <box> is an example, not a standalone layout.\n<text>x</text>\n</box>",
  ]) {
    assert.equal(detect(source), null);
    assert.equal(project(source).text, source);
  }
});
test("malformed, unclosed and excessively deep profiles do not authorize recovery", () => {
  for (const source of [
    "<box><text>Unclosed</text>",
    "<box><row><text>Wrong nesting</row></text></box>",
    "<box>Nothing establishes a rich child</box>",
    "<box>".repeat(65) + "<text>x</text>" + "</box>".repeat(65),
  ]) assert.equal(project(source).text, source);
});
test("raw and escaped layout examples in fenced/inline/indented code never establish a profile", () => {
  for (const source of [
    "```html\n" + raw + "\n```",
    "~~~~html\n" + raw + "\n~~~~",
    "`" + raw.replaceAll("\n", " ") + "`",
    "    <box><text>Indented code</text></box>",
    "```text\n" + escaped, // unclosed code fence
  ]) {
    assert.equal(detect(source), null);
    assert.equal(project(source).text, source);
  }
});
test("code within a real profile retains literal tags, escapes and longer fences exactly", () => {
  const fenced = "````markdown\n```html\n<box><text>example</text></box>\n```\n````";
  const inline = String.raw`<text>Keep \# and \*\* inside</text>`;
  const source = escaped + "\n\n" + fenced + "\n\n`" + inline + "`\n\n    <script>indented example</script>";
  const projected = project(source).text;
  assert.ok(projected.includes(fenced));
  assert.ok(projected.includes("`" + inline + "`"));
  assert.ok(projected.includes("    <script>indented example</script>"));
});
test("escaped inline-code recovery restores delimiters only, never its body", () => {
  const code = String.raw`<text>example \*\*literal\*\*</text>`;
  const source = escaped + "\n\n" + "\\`" + code + "\\`";
  assert.ok(project(source).text.includes("`" + code + "`"));
});
test("raw profiles do not turn deliberately escaped headings and emphasis into formatting", () => {
  const literal = String.raw`\# Literal and \*\*literal\*\*`;
  assert.ok(project(raw + "\n\n" + literal).text.includes(literal));
});
test("all balanced rich boxes contribute to the message escape profile", () => {
  for (const mixed of [raw + "\n\n" + escaped, escaped + "\n\n" + raw]) {
    assert.deepEqual(detect(mixed), { escapedMarkdown: true });
    const html = render(mixed);
    assert.match(html, /<h1>Synthetic heading<\/h1>/);
    assert.match(html, /<strong>Synthetic focus<\/strong>/);
    assert.match(html, /<code>sample_code<\/code>/);
    const projected = project(mixed);
    assert.equal(projected.sourcePosition(projected.text.indexOf("Second synthetic step")).offset,
      mixed.indexOf("Second synthetic step"));
  }
});
test("a valid first box cannot authorize partial conversion of a later malformed box", () => {
  for (const suffix of [
    "<box><text>unclosed",
    "<box><text>bad</box></text>",
    "<box><row><text>bad</text></box>",
    "<box>".repeat(65) + "<text>deep</text>" + "</box>".repeat(65),
  ]) {
    const source = raw + "\n\n" + suffix;
    assert.equal(detect(source), null);
    assert.equal(project(source).text, source);
  }
});
test("later malformed or escaped examples inside code never influence an established rich profile", () => {
  const code = "```text\n" + escaped + "\n<box><text>unclosed\n```";
  assert.deepEqual(detect(raw + "\n\n" + code), { escapedMarkdown: false });
  assert.ok(project(raw + "\n\n" + code).text.includes(code));
});
test("an inherited escaped profile still preserves canonical task, link and negative-code content", () => {
  const mixed = raw + "\n\n" + escaped;
  const profile = detect(mixed);
  for (const source of [
    "- [ ] synthetic task\n\n[external](https://example.invalid)",
    "```text\n<box><text>unclosed\n```",
    String.raw`\(x^2\) and [unsafe](javascript:alert(1))`,
  ]) {
    assert.equal(project(source, profile).text, source);
  }
});
test("rich and math compatibility compose without changing currency, formulas or code", () => {
  const formulas = String.raw`Inline \(x^2\), price USD $20.

\[
\frac{1}{3}
\]`;
  const html = render(raw + "\n\n" + formulas);
  assert.match(html, /katex/);
  assert.match(html, /<math/);
  assert.match(html, /USD \$20/);
  assert.equal(project(raw + "\n\n" + formulas).text.includes(formulas), true);
});
test("documented widget presentation attributes remain a bounded readable profile", () => {
  const documented = `<box direction="column" flex={1} width="full" minWidth={2} margin="sm" border={1} radius="lg" background="surface">
<row gap={2} align="center" justify="between" wrap="wrap" aspectRatio="1">
<text weight="semibold" textAlign="start" italic lineThrough maxLines={2}>Documented surface</text>
<badge color="success" variant="soft" pill size="sm">Ready</badge>
</row>
<divider spacing="sm" color="muted" size={1} flush/>
</box>`;
  assert.deepEqual(detect(documented), { escapedMarkdown: false });
  const projected = project(documented).text;
  assert.match(projected, /Documented surface/);
  assert.match(projected, /Ready/);
  assert.match(projected, /---/);
});
test("unknown attributes, scripts, links, images and JSX expressions are never executed", () => {
  const source = raw + '\n\n<script>globalThis.syntheticProbe=1</script>\n'
    + '<iframe src="https://example.invalid/widget"></iframe>\n'
    + '<box onClick={run()}><text>Unknown attributes</text></box>\n'
    + '<box style="color:red"><text>Style is not a widget export</text></box>\n'
    + '<box className="danger"><text>Class is not a widget export</text></box>\n'
    + '{runSyntheticExpression()}\n\n[unsafe](javascript:alert(1))';
  const html = render(source);
  assert.doesNotMatch(html, /<(?:script|iframe|box|text)\b/);
  assert.doesNotMatch(html, /href="javascript:|<[^>]+\b(?:onClick|onerror)=/i);
  assert.equal(globalThis.syntheticProbe, undefined);
  assert.match(html, /\{runSyntheticExpression\(\)\}/);
});
test("tokens beyond the supported escape depth remain literal", () => {
  const source = "\\\\".repeat(2) + "<box><text>x</text></box>";
  assert.equal(detect(source), null);
  assert.equal(project(source).text, source);
});
test("input/token budgets fail closed without truncating content", () => {
  const limits = compatibility.CHATGPT_RICH_TEXT_LIMITS;
  const huge = raw + "x".repeat(limits.sourceUnits);
  assert.equal(project(huge).text, huge);
  const many = "<box>" + "<text>x</text>".repeat(limits.tokens) + "</box>";
  assert.equal(project(many).text, many);
});
test("repeated projection and CRLF/Unicode content preserve ordered readable content", () => {
  const source = (escaped + "\n\n<text>合成内容 😀 é</text>").replaceAll("\n", "\r\n");
  const first = project(source).text;
  assert.ok(first.includes("合成内容 😀 é"));
  assert.equal(project(source).text, first);
  assert.equal(project(first).text, first);
});
test("cross-block metadata is immutable and preserves IDs, indices, code, assets and raw copy strings", () => {
  const blocks = [
    { id: "synthetic-heading", block_index: 4, block_type: "paragraph", plain_text: String.raw`\# Heading`, data: { text: String.raw`\# Heading` } },
    { id: "synthetic-body", block_index: 5, block_type: "paragraph", plain_text: escaped, data: { text: escaped } },
    { id: "synthetic-code", block_index: 6, block_type: "code", plain_text: raw, data: { code: raw } },
    { id: "synthetic-file", block_index: 7, block_type: "attachment", data: { attachmentId: "synthetic-file" } },
  ];
  const before = JSON.stringify(blocks);
  const projected = compatibility.withChatGptRichTextProfile(blocks, detect(escaped));
  assert.equal(JSON.stringify(blocks), before);
  assert.equal(projected[0].plain_text, blocks[0].plain_text);
  assert.equal(projected[0].data.text, blocks[0].data.text);
  assert.deepEqual(projected.map(b => [b.id, b.block_index]), blocks.map(b => [b.id, b.block_index]));
  assert.equal(projected[2], blocks[2]);
  assert.equal(projected[3], blocks[3]);
  assert.match(render(projected[0].plain_text, projected[0].data.chatGptRichTextProfile), /<h1>Heading<\/h1>/);
  assert.equal(compatibility.withChatGptRichTextProfile(blocks, null), blocks);
});
test("each block independently recovers inherited profile formatting and orphaned known wrapper fragments", () => {
  const profile = detect(escaped);
  for (const [source, pattern] of [
    [String.raw`\# Separate heading`, /<h1>Separate heading<\/h1>/],
    [String.raw`\\\*\\\*Separate emphasis\\\*\\\*`, /<strong>Separate emphasis<\/strong>/],
    [String.raw`\\\<text>Separate paragraph\\\</text>`, /Separate paragraph/],
    [String.raw`\\\</box>`, /^$/],
  ]) assert.match(render(source, profile), pattern);
});
test("projection source positions map text back to canonical UTF-16 offsets and CRLF lines", () => {
  const source = escaped.replaceAll("\n", "\r\n");
  const projected = project(source);
  for (const text of ["Synthetic heading", "Synthetic focus", "Priority", "sample_code", "Second synthetic step"]) {
    const start = projected.text.indexOf(text);
    const mapped = projected.sourcePosition(start);
    assert.equal(mapped.offset, source.indexOf(text));
    assert.equal(mapped.line, source.slice(0, mapped.offset).split("\n").length);
    assert.equal(mapped.column, mapped.offset - source.lastIndexOf("\n", mapped.offset - 1));
    assert.equal(source.slice(mapped.offset, projected.sourcePosition(start + text.length).offset), text);
  }
});
test("source-position remark plugin remaps actual parsed Markdown nodes after math plugins", async () => {
  const source = escaped;
  const projected = project(source);
  const { unified } = await import(pathToFileURL(appRequire.resolve("unified", {
    paths: [appRequire.resolve("react-markdown")],
  })).href);
  const { default: remarkParse } = await import(pathToFileURL(appRequire.resolve("remark-parse", {
    paths: [appRequire.resolve("react-markdown")],
  })).href);
  const parser = unified().use(remarkParse);
  const tree = parser.parse(projected.text);
  compatibility.remarkRichTextSourcePositions(projected)()(tree);
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const focus = walk(tree).find(node => node.type === "text" && node.value === "Synthetic focus");
  assert.ok(focus);
  assert.equal(focus.position.start.offset, source.indexOf("Synthetic focus"));
});

// Compile the actual component with the real React/Markdown/remark/rehype stack.
// Only assistant-ui's provider/primitive and unrelated UI imports are adapters;
// these checks are SSR, not browser, lifecycle, geometry or CPU/RSS acceptance.
const sourceContext = React.createContext("");
const primitiveInputs = [];
const uiAdapter = {
  TextMessagePartProvider: ({ text, children }) => React.createElement(sourceContext.Provider, { value: text }, children),
  MarkdownTextPrimitive: ({ preprocess, componentsByLanguage: _languages, ...props }) => {
    const source = React.useContext(sourceContext);
    primitiveInputs.push(source);
    return React.createElement(ReactMarkdown, { ...props, children: preprocess(source) });
  },
};
function compileComponent(relative, stubs) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)(name => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name === "react-markdown") return { default: ReactMarkdown };
    if (name === "react" || name === "react/jsx-runtime") return appRequire(name);
    throw new Error("Unstubbed component import: " + name);
  }, exports);
  return exports;
}
const tablePresentation = compileComponent("../../apps/web/features/conversations/markdown-table.tsx", {});
const clipboardCopy = compileComponent("../../apps/web/components/use-clipboard-copy.ts", {});
const thinkingSummary = (await load("../../apps/web/features/conversations/thinking-summary.ts")).module;
const renderer = compileComponent("../../apps/web/features/conversations/markdown-renderer.tsx", {
  "@assistant-ui/react": uiAdapter,
  "@assistant-ui/react-markdown": uiAdapter,
  "lucide-react": new Proxy({}, { get: () => () => null }),
  "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US", resolvedTheme: "light" }) },
  "../../components/use-clipboard-copy": clipboardCopy,
  "../rich-markdown/rich-markdown-config": config,
  "../rich-markdown/remark-ai-math-compatibility": math,
  "../rich-markdown/chatgpt-rich-text-compatibility": compatibility,
  "./markdown-table": tablePresentation,
  "./thinking-summary": thinkingSummary,
});
const tableTools = compileComponent("../../apps/web/features/editing/markdown-table-tools.ts", {
  "@codemirror/lang-markdown": appRequire("@codemirror/lang-markdown"),
});
test("table normalization retains absolute-value versus norm MathML in the real Reader and table preview", () => {
  const mathml = html => html.match(/<math\b[\s\S]*?<\/math>/)?.[0].replace(/<annotation\b[\s\S]*?<\/annotation>/g, "");
  for (const value of [
    String.raw`\(|x|\)`, String.raw`\(\left|p_k-p_{k-1}\right|\)`,
    String.raw`$|x|$`, String.raw`$$|x|$$`,
    String.raw`\(\|x\|\)`, String.raw`$\|x\|$`,
    String.raw`\(\mathchoice{|x|}{|y|}{|z|}{|w|}\)`,
    String.raw`[formula \(|x|\)](https://example.invalid)`,
  ]) {
    const source = `| Formula | Note |\n| --- | --- |\n| ${value} | retained |`;
    const result = tableTools.applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result, value);
    const expectedMath = mathml(render(value));
    assert.ok(expectedMath, value);
    for (const html of [
      renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text: result.insert, isAssistant: false })),
      renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
        text: result.insert, renderCell: (_row, _column, content) => content,
      })),
    ]) {
      assert.equal((html.match(/<th\b/g) ?? []).length, 2, value);
      assert.equal((html.match(/<td\b/g) ?? []).length, 2, value);
      assert.equal((html.match(/class="katex"/g) ?? []).length, 1, value);
      assert.equal(mathml(html), expectedMath, value);
      assert.doesNotMatch(html, /data-math-error|katex-error/);
    }
  }
});
test("table code pipe normalization preserves the literal backslashes through actual GFM rendering", () => {
  for (let slashes = 0; slashes <= 8; slashes++) {
    const source = "| A | B |\n| --- | --- |\n| `x" + "\\".repeat(slashes) + "|y` | retained |";
    const result = tableTools.applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result);
    const expected = "x" + "\\".repeat(slashes - slashes % 2) + "|y";
    for (const html of [
      renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text: result.insert, isAssistant: false })),
      renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
        text: result.insert, renderCell: (_row, _column, content) => content,
      })),
    ]) {
      assert.equal((html.match(/<td\b/g) ?? []).length, 2);
      assert.equal(html.match(/<code(?:\s[^>]*)?>([^<]*)<\/code>/)?.[1], expected, slashes);
      assert.doesNotMatch(html, /class="katex"/);
    }
  }
});
test("normalization preserves actual Reader and editable-preview GFM for escaped pipes beside code delimiters", () => {
  const slash = String.fromCharCode(92);
  const tableHtml = html => html.match(/<table\b[\s\S]*?<\/table>/)?.[0];
  const cases = [
    "`code " + slash + "| pipe`",
    "``code " + slash + "` still " + slash + "| pipe``",
    "``code" + slash + "`` outside " + slash + "| pipe",
    "`left ` inner " + slash + "| right`",
    slash + "`left " + slash + "| right``",
    "`left " + slash + "` inner " + slash + "| right`",
  ];

  for (const value of cases) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | tail |`;
    const result = tableTools.applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result, value);

    const readerBefore = tableHtml(renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
      text: source, isAssistant: false,
    })));
    const readerAfter = tableHtml(renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
      text: result.insert, isAssistant: false,
    })));
    const previewBefore = tableHtml(renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
      text: source, renderCell: (_row, _column, content) => content,
    })));
    const previewAfter = tableHtml(renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
      text: result.insert, renderCell: (_row, _column, content) => content,
    })));

    assert.ok(readerBefore, value);
    assert.ok(previewBefore, value);
    assert.equal(readerAfter, readerBefore, value);
    assert.equal(previewAfter, previewBefore, value);
  }
});
test("math-looking image alt and reference identity survive table normalization without TeX rewrites", () => {
  const image = "| A | B |\n| --- | --- |\n| " + String.raw`![\(|x|\)](https://example.invalid/image.png)` + " | retained |";
  const imageResult = tableTools.applyMarkdownTableAction(image, 0, 0, { type: "normalize" });
  assert.ok(imageResult);
  const imageHtml = renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
    text: imageResult.insert, renderCell: (_row, _column, content) => content,
  }));
  assert.match(imageHtml, /\(\|x\|\)/);
  assert.doesNotMatch(imageHtml, /\\vert|class="katex"|<img\b/);
  const source = "| A | B |\n| --- | --- |\n| " + String.raw`[label][\(\|x\|\)]` + " | retained |\n\n"
    + String.raw`[\(\|x\|\)]: https://example.invalid/target`;
  const result = tableTools.applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
  assert.ok(result);
  const html = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
    text: result.insert + source.slice(result.to), isAssistant: false,
  }));
  assert.match(html, /href="https:\/\/example\.invalid\/target"/);
  assert.match(html, />label<\/a>/);
  assert.doesNotMatch(result.insert, /\\vert/);
  const collapsed = "| A | B |\n| --- | --- |\n| " + String.raw`[a\|b][]` + " | retained |\n\n"
    + String.raw`[a\|b]: https://example.invalid/collapsed "Original title"`;
  const collapsedResult = tableTools.applyMarkdownTableAction(collapsed, 0, 0, { type: "normalize" });
  assert.ok(collapsedResult);
  const collapsedHtml = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
    text: collapsedResult.insert + collapsed.slice(collapsedResult.to), isAssistant: false,
  }));
  assert.match(collapsedHtml, /href="https:\/\/example\.invalid\/collapsed"/);
  assert.match(collapsedHtml, /title="Original title"/);
  assert.match(collapsedHtml, />a\|b<\/a>/);
  for (const imageReference of [String.raw`![img\|id]`, String.raw`![img\|id][]`]) {
    const source = "| A | B |\n| --- | --- |\n| " + imageReference + " | retained |\n\n"
      + String.raw`[img\|id]: https://example.invalid/image.png`;
    const result = tableTools.applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result);
    const html = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
      text: result.insert + source.slice(result.to), isAssistant: false,
    }));
    assert.match(html, /href="https:\/\/example\.invalid\/image\.png"/);
    assert.match(html, /img\|id/);
    assert.doesNotMatch(html, /<img\b/);
  }
});
test("editable table preview uses the actual shared GFM/math chain and stable cell coordinates", () => {
  const visited = [];
  const html = renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
    text: "| A | B |\n| --- | --- |\n| \\(x^2\\) | **bold** |",
    renderCell: (row, column, content) => {
      visited.push([row, column]);
      return React.createElement("button", { type: "button" }, content);
    },
  }));
  assert.deepEqual(visited, [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.equal((html.match(/<table\b/g) ?? []).length, 1);
  assert.match(html, /class="katex"/);
  assert.match(html, /<math/);
  assert.match(html, /<strong>bold<\/strong>/);
});
test("Reader body and editable preview share the same bounded table presentation primitives", () => {
  const source = "| Metric | Long description |\n| --- | --- |\n| 3 | A long paragraph stays readable within a bounded column. |";
  const reader = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text: source, isAssistant: false }));
  const preview = renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
    text: source, renderCell: (_row, _column, content) => content,
  }));
  for (const html of [reader, preview]) {
    assert.match(html, /class="markdown-table-content w-max min-w-full border-collapse text-\[0\.875em\]"/);
    assert.equal((html.match(/class="markdown-table-cell-content /g) ?? []).length, 4);
    assert.match(html, /border-ui/);
    assert.match(html, /Long description/);
  }
  assert.match(reader, /class="markdown-table max-w-full overflow-x-auto rounded-lg border border-ui bg-surface"/);
  assert.doesNotMatch(preview, /class="markdown-table max-w-full overflow-x-auto/);
});
test("editable preview never navigates links or loads user images while clicking a cell", () => {
  const html = renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
    text: "| A | B |\n| --- | --- |\n| [safe](https://example.invalid) | ![remote](https://example.invalid/x.png) |\n| [unsafe](javascript:alert(1)) | <script>alert(1)</script> |",
    renderCell: (_row, _column, content) => React.createElement("button", { type: "button" }, content),
  }));
  assert.doesNotMatch(html, /<a\b|<img\b|<script\b|href=|onerror=/i);
  assert.match(html, /safe/);
});
test("GFM alignment survives both the Reader and editable table presentations", () => {
  const text = "| A | B |\n| :---: | ---: |\n| center | right |";
  const readerHtml = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text, isAssistant: false }));
  const editorHtml = renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
    text, renderCell: (_row, _column, content) => content,
  }));
  for (const html of [readerHtml, editorHtml]) {
    assert.equal((html.match(/style="text-align:center"/g) ?? []).length, 2);
    assert.equal((html.match(/style="text-align:right"/g) ?? []).length, 2);
  }
});
test("table preview retains GFM cell content for Unicode spacing, autolinks and inline syntax", () => {
  const cells = html => [...html.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, attributes, content]) => ({ tag, attributes, content }));
  for (const values of [
    ["text", "🙂 中文", "3.14", "x-y + 2"],
    ["\u00a0kept\u00a0", "\ufeffkept\ufeff", "中\u2003文", "\u202fkept\u202f"],
    ["NUL:\u0000:end", "x\u000by", "x\u000cy", "plain"],
    ["www.example.test", "https://example.test/path", "reader@example.test", "**bold**"],
    ["&#124;", "`code`", "[link](https://example.test)", "\\(x^2\\)"],
  ]) {
    const source = "| A | B | C | D |\n| --- | :--- | :---: | ---: |\n| " + values.join(" | ") + " |";
    const renderPreview = text => renderToStaticMarkup(React.createElement(renderer.MarkdownTablePreview, {
      text, renderCell: (_row, _column, content) => content,
    }));
    const actual = renderPreview(source);
    // Supplying reference context must not change unrelated cell content.
    const reference = renderPreview(source + "\n\n[unused-plain-preview]: https://example.test/unused");
    assert.deepEqual(cells(actual), cells(reference), values.join(" / "));
    if (values[0].startsWith("\u00a0")) {
      for (const value of values) assert.ok(actual.includes(value));
    }
    if (values[0].startsWith("NUL:")) {
      assert.ok(actual.includes("NUL:\uFFFD:end"));
      assert.ok(!actual.includes("\0"));
    }
  }
});
const blockRenderer = compileComponent("../../apps/web/features/conversations/block-renderer.tsx", {
  "./markdown-renderer": renderer,
  "./thinking-summary": thinkingSummary,
  "../attachments/attachment-block": { AttachmentBlock: () => null, embeddedAttachment: () => null },
  "../rich-markdown/chatgpt-rich-text-compatibility": compatibility,
});
test("actual shared renderer exercises primitive and interactive branches without changing canonical provider input", () => {
  const source = escaped + "\n\n- [ ] Synthetic task";
  primitiveInputs.length = 0;
  const passive = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text: source, isAssistant: false }));
  assert.match(passive, /<h1[^>]*>Synthetic heading<\/h1>/);
  assert.equal(primitiveInputs.at(-1), source);
  const tasks = renderer.extractMarkdownTaskItems(source);
  const active = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
    text: source, isAssistant: false, taskItems: tasks, onTaskToggle: () => {},
  }));
  assert.match(active, /role="checkbox"/);
  assert.match(active, /<h1[^>]*>Synthetic heading<\/h1>/);
  assert.match(active, new RegExp(tasks[0].taskKey));
  assert.deepEqual(renderer.extractMarkdownTaskItems(source), tasks);
});
test("actual source-preview renderer exposes original offsets and keeps canonical source unchanged", () => {
  const html = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, {
    text: escaped, preserveSourceOffsets: true, isAssistant: false,
  }));
  const headingStart = escaped.indexOf("#");
  assert.match(html, new RegExp(`data-markdown-source-start="${headingStart}"`));
  assert.match(html, /<strong>Synthetic focus<\/strong>/);
});
test("actual block renderer reads inherited profile while preserving heading/code boundaries", () => {
  const profile = detect(escaped);
  const block = { id: "synthetic-block", block_index: 9, block_type: "paragraph", plain_text: String.raw`\# Cross-block heading`, data: { chatGptRichTextProfile: profile } };
  const before = JSON.stringify(block);
  const html = renderToStaticMarkup(React.createElement(blockRenderer.BlockRenderer, { block, messageId: "synthetic-message" }));
  assert.match(html, /<h1[^>]*>Cross-block heading<\/h1>/);
  assert.equal(JSON.stringify(block), before);
  const heading = { ...block, block_type: "heading", plain_text: String.raw`\*\*Heading emphasis\*\*`, data: { ...block.data, level: 2 } };
  assert.match(renderToStaticMarkup(React.createElement(blockRenderer.BlockRenderer, { block: heading })), /<strong>Heading emphasis<\/strong>/);
  const code = { ...block, block_type: "code", data: { ...block.data, code: raw, language: "html" } };
  const codeHtml = renderToStaticMarkup(React.createElement(blockRenderer.BlockRenderer, { block: code }));
  assert.match(codeHtml, /&lt;box/);
  assert.doesNotMatch(codeHtml, /<hr/);
});

const virtualizer = ({ count, getItemKey }) => ({
  getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
    index, key: getItemKey(index), start: index * 100, end: (index + 1) * 100, size: 100,
  })),
  getTotalSize: () => count * 100,
  measure: () => {}, measureElement: () => {},
});
const assistant = compileComponent("../../apps/web/features/conversations/assistant-message-renderer.tsx", {
  "@tanstack/react-virtual": { defaultRangeExtractor: () => [], useVirtualizer: virtualizer, useWindowVirtualizer: virtualizer },
  "../../components/preferences-provider": { useTranslations: () => key => key },
  "./block-renderer": blockRenderer,
  "./markdown-renderer": renderer,
  "./thinking-summary": thinkingSummary,
  "./block-virtualization": { registerVirtualMessage: () => () => {}, READER_WINDOW_LAYOUT_EVENT: "synthetic-layout" },
  "./rendered-block-registry": { registerRenderedBlock: () => () => {} },
  "../attachments/attachment-block": { embeddedAttachment: () => null },
  "../attachments/attachment-inline-layout": { AttachmentInlineGroup: () => null },
  "./reader-block-layout": { DEFAULT_READER_BLOCK_LAYOUT_METRICS: {}, estimateReaderBlockSize: () => 100, readerBlockLayoutSignature: () => "synthetic-layout" },
  "../rich-markdown/remark-ai-math-compatibility": math,
  "../rich-markdown/chatgpt-rich-text-compatibility": compatibility,
});
for (const mode of ["regular", "element", "window"]) {
  test(`actual message wiring propagates the profile across ${mode} block paths with canonical anchors`, () => {
    const pieces = escaped.split("\n\n");
    const blocks = pieces.map((text, index) => ({
      id: `synthetic-block-${index}`, block_index: index, block_type: "paragraph", plain_text: text, data: { text },
    }));
    const message = {
      id: "synthetic-message", role: "assistant", block_count: mode === "regular" ? blocks.length : 161,
      char_count: escaped.length, current_version: { id: "synthetic-version", display_text: escaped },
    };
    const before = JSON.stringify({ message, blocks });
    const html = renderToStaticMarkup(React.createElement(assistant.AssistantMessageRenderer, {
      message, blocks, scrollRootMode: mode === "window" ? "window" : "element",
    }));
    assert.match(html, /<h1[^>]*>Synthetic heading<\/h1>/);
    assert.match(html, /<strong>Synthetic focus<\/strong>/);
    for (const block of blocks) assert.ok(html.includes(`id="block-synthetic-message-${block.block_index}"`));
    assert.equal(JSON.stringify({ message, blocks }), before);
  });
}
test("actual shared safe-link/image components stay inert for projected untrusted content", () => {
  const source = raw + "\n\n[unsafe](javascript:alert(1))\n\n![remote](https://example.invalid/synthetic.png)";
  const html = renderToStaticMarkup(React.createElement(renderer.MarkdownRenderer, { text: source, isAssistant: false }));
  assert.doesNotMatch(html, /<img\b|href="javascript:|<script\b/);
  assert.match(html, /Synthetic focus/);
});
test("leading thinking disclosure inherits the same full-message rich-text profile", () => {
  const thought = String.raw`分析 \*\*Synthetic reasoning\*\*` + "\n思考 1s";
  const blocks = [thought, escaped].map((text, index) => ({
    id: `synthetic-thinking-${index}`, block_index: index, block_type: "paragraph", plain_text: text, data: { text },
  }));
  const message = {
    id: "synthetic-message", role: "assistant", block_count: blocks.length,
    char_count: 100, current_version: { id: "synthetic-version", display_text: thought + "\n\n" + escaped },
  };
  const before = JSON.stringify({ message, blocks });
  const html = renderToStaticMarkup(React.createElement(assistant.AssistantMessageRenderer, { message, blocks }));
  assert.match(html, /<details[^>]*class="reader-thinking/);
  assert.match(html, /<strong>Synthetic reasoning<\/strong>/);
  assert.equal(JSON.stringify({ message, blocks }), before);
});
