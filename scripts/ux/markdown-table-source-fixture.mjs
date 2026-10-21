// Test-only loader for the actual TS projection/plugin and installed renderer.
// Data URLs keep transient compilation out of the repository and system Temp.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { default: ReactMarkdown } = await import(pathToFileURL(appRequire.resolve("react-markdown")).href);
const modules = new Map();
export async function loadTableFixtureModule(relative) {
  const url = new URL(relative, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  let output = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const match of output.matchAll(/from ["']([^"']+)["']/g)) {
    const specifier = match[1];
    const href = specifier.startsWith(".")
      ? (await loadTableFixtureModule(new URL(specifier + ".ts", url).href)).href
      : pathToFileURL(appRequire.resolve(specifier)).href;
    output = output.replace(match[0], `from ${JSON.stringify(href)}`);
  }
  const href = "data:text/javascript;base64," + Buffer.from(output).toString("base64");
  const result = { href, module: await import(href) };
  modules.set(url.href, result);
  return result;
}
export const tableSourceAnalysis = (await loadTableFixtureModule("../../apps/web/features/editing/markdown-table-source-analysis.ts")).module;
const config = (await loadTableFixtureModule("../../apps/web/features/rich-markdown/rich-markdown-config.ts")).module;
export function analyseTableSource(source) {
  const probe = tableSourceAnalysis.createMarkdownTableSourceProbe(source);
  if (!probe.limited) {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
      children: probe.text, remarkPlugins: config.richMarkdownRemarkPlugins([probe.plugin]), skipHtml: true,
    }));
    if (html !== "") throw Error("The context probe emitted preview DOM");
  }
  return probe.result();
}
