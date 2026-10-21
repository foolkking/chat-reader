// Explicit local browser gate. No API, account, production data, CI or deployment.
// The actual workspace/form/CodeMirror, dialog, renderer and focus run in Chrome.
// HTTP APIs, Next's client loader, assistant-ui source forwarding, cleanup UI and
// unrelated rich-view dependencies are explicit adapters, not server acceptance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web");
const appRequire = createRequire(join(web, "package.json"));
const tempRoot = resolve(process.env.TEMP ?? "");
assert.match(tempRoot.toLowerCase().replaceAll("\\", "/"), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
const out = join(tempRoot, "table-browser");
mkdirSync(out, { recursive: true });
const resultPath = join(out, "result.json");
const edgeObservationPath = join(out, "wide-edge-observations.json");
const emptyStateObservationPath = join(out, "empty-state-observations.json");
const edgeObservations = [];
const startedAt = new Date().toISOString();
const date = startedAt.slice(0, 10);
const profileEnabled = process.env.TABLE_TOOL_PROFILE === "1";
const performancePath = join(out, "performance.json");
writeFileSync(resultPath, JSON.stringify({ date, startedAt, status: "not_completed" }, null, 2));
writeFileSync(edgeObservationPath, JSON.stringify({ date, startedAt, status: "not_completed", observations: [] }, null, 2));
writeFileSync(emptyStateObservationPath, JSON.stringify({ date, startedAt, status: "not_completed", observations: [] }, null, 2));
// A later functional-only or interrupted run must not leave earlier timings
// looking like fresh observations in a reused task directory.
writeFileSync(performancePath, JSON.stringify({
  date, startedAt, status: profileEnabled ? "not_completed" : "not_requested",
}, null, 2));
const tsPath = appRequire.resolve("typescript");
writeFileSync(join(out, "ts-loader.cjs"), `
const ts = require(${JSON.stringify(tsPath)});
module.exports = function(source) {
  // A transparent, test-only scheduling seam: do not replace parsing results.
  // Suspending its entry exposes the urgent Markdown commit before deferred
  // parsing finishes, independent of machine speed. Production source is intact.
  if(this.resourcePath.replaceAll("\\\\","/").endsWith("/features/editing/markdown-table-tools.ts")) {
    const entry="export function inspectMarkdownTableDraft(source: string): MarkdownTableModel | null {";
    if(!source.includes(entry)) throw Error("Table draft parser probe no longer matches its actual entry");
    source=source.replace(entry,entry+\`
      if(typeof window!=="undefined"&&window.tableDraftParseHold
        &&source.includes(window.tableDraftParseHold.marker)) {
        window.tableDraftParseHold.entries++;
        throw window.tableDraftParseHold.promise;
      }
    \`);
  }
  return ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX
}}).outputText; };`);
writeFileSync(join(out, "adapters.mjs"), `
import React, {createContext,useContext} from "react";
import ReactMarkdown from "react-markdown";
const sourceContext=createContext("");
export const TextMessagePartProvider = ({text,children}) => React.createElement(sourceContext.Provider,{value:text},children);
export const MarkdownTextPrimitive = ({preprocess,componentsByLanguage,...props}) =>
  React.createElement(ReactMarkdown,{...props,children:preprocess(useContext(sourceContext))});
export const usePreferences = () => ({resolvedLocale:window.gateLocale??"en-US",resolvedTheme:"light",t:key=>key});
export const createHighlighter = () => {throw Error("Not used by the table gate");};
export default {};`);
writeFileSync(join(out, "client-loader.mjs"), `
import React, {lazy,Suspense} from "react";
export default function dynamic(load) {
  const Component=lazy(load);
  return props=>React.createElement(Suspense,{fallback:null},React.createElement(Component,props));
}`);
writeFileSync(join(out, "workspace-adapters.mjs"), `
const outsideScope=()=>{throw Error("Unexpected API/cleanup call outside this local table gate");};
export const getConversationAttachments=async()=>[];
export const editMessage=async(id,payload)=>{
  window.workspaceWrites.push({id,payload});
  const old=window.workspaceMessage;
  const version={...old.current_version,id:"synthetic-saved-version",
    version_number:old.current_version.version_number+1,display_text:payload.contentMarkdown,plain_text:payload.contentMarkdown};
  const message={...old,current_version:version};
  window.workspaceMessage=message;
  return {message,conversation_revision:2,attachment_occurrences:[]};
};
export const createAttachmentUploadSession=outsideScope,deleteAttachmentUploadItem=outsideScope,
  deleteConversationAttachment=outsideScope,finalizeConversationAttachments=outsideScope,
  getConversation=outsideScope,getConversationReaderTurn=outsideScope,uploadAttachmentItem=outsideScope;
export const ContentCleanupDialog=({open})=>open?outsideScope():null;`);
// Count actual parser component entries without substituting its implementation.
// Callback-only rerenders should update editable cells, not parse the same source.
writeFileSync(join(out, "markdown-probe.mjs"), `
import React from "react";
import ActualMarkdown from ${JSON.stringify(appRequire.resolve("react-markdown").replaceAll("\\", "/"))};
export default function MeasuredMarkdown(props) {
  if(window.tablePreviewHold&&String(props.children).includes(window.tablePreviewHold.marker))
    throw window.tablePreviewHold.promise;
  window.tableMarkdownParseCount=(window.tableMarkdownParseCount??0)+1;
  if(!props.rehypePlugins) window.tableSourceProbeCount=(window.tableSourceProbeCount??0)+1;
  return React.createElement(ActualMarkdown,props);
}`);
const dialogPath = join(web, "features/editing/markdown-table-dialog.tsx").replaceAll("\\", "/");
const toolsPath = join(web, "features/editing/markdown-table-tools.ts").replaceAll("\\", "/");
const workspacePath = join(web, "features/editing/source-editor-workspace.tsx").replaceAll("\\", "/");
const rendererPath = join(web, "features/conversations/markdown-renderer.tsx").replaceAll("\\", "/");
writeFileSync(join(out, "entry.tsx"), `
import React, {useState, useEffect, useRef} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {EditorView} from "@codemirror/view";
import {markdownLanguage} from "@codemirror/lang-markdown";
import {TableToolDialog} from ${JSON.stringify(dialogPath)};
import {applyMarkdownTableAction} from ${JSON.stringify(toolsPath)};
import {SourceEditorWorkspace} from ${JSON.stringify(workspacePath)};
import {MarkdownTablePreview} from ${JSON.stringify(rendererPath)};
const originalContextParse=markdownLanguage.parser.parse;
markdownLanguage.parser.parse=function(...args) {
  window.tableContextParseInputs??=[];
  window.tableContextParseInputs.push(typeof args[0]==="string"?args[0].length:null);
  return originalContextParse.apply(this,args);
};
function Harness() {
  const [source,setSource]=useState("");
  const [revision,setRevision]=useState(0);
  const [tool,setTool]=useState(null);
  const [zh,setZh]=useState(false);
  const opener=useRef(null);
  useEffect(()=>{
    window.tableGate={
      reset(value,locale=false) { setTool(null); setSource(value); setRevision(r=>r+1); setZh(locale); window.applied=[]; window.submits=0; },
      externalChange(value) {setSource(value); setRevision(r=>r+1);},
      source:()=>source
    };
  });
  return <form onSubmit={event=>{event.preventDefault();if(!tool) window.submits++;}}>
    <button ref={opener} type="button" id="open" onClick={()=>setTool({source,from:source.indexOf("|"),to:source.indexOf("|"),revision})}>Open table</button>
    {tool ? <TableToolDialog key={tool.revision} zh={zh} source={tool.source} range={tool}
      stale={revision!==tool.revision} restoreFocus={()=>opener.current} onClose={()=>setTool(null)}
      onRefresh={()=>setTool({source,from:source.indexOf("|"),to:source.indexOf("|"),revision})}
      onApply={(action,context)=>{const result=applyMarkdownTableAction(source,tool.from,tool.to,action,context);
        if(!result) throw Error("Invalid replacement");
        const next=source.slice(0,result.from)+result.insert+source.slice(result.to);
        window.applied.push(next);setSource(next);setRevision(r=>r+1);setTool(null);}}
    /> : null}
  </form>;
}
function WorkspaceHarness({source}) {
  const [target,setTarget]=useState(()=>({cursorOffset:Array.from(source.slice(0,source.indexOf("|"))).length,
    message:{id:"synthetic-message",conversation_id:"synthetic-conversation",role:"assistant",ordinal:1,order_key:1,
    current_version:{id:"synthetic-version",version_number:1,display_text:source,plain_text:source}}}));
  const [open,setOpen]=useState(true);
  const [queryClient]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false}}}));
  useEffect(()=>{
    window.workspaceMessage=target.message;
    const view=()=>EditorView.findFromDOM(document.querySelector(".cm-editor"));
    window.workspaceGate={
      source:()=>view()?.state.doc.toString(),
      select(from,to=from){view().dispatch({selection:{anchor:from,head:to}});view().focus();},
      replace(text){const current=view();current.dispatch({changes:{from:0,to:current.state.doc.length,insert:text}});},
      insert(position,text){view().dispatch({changes:{from:position,insert:text}});},
      requestSubmit(){document.querySelector("#reader-source-editor-form").requestSubmit();},
    };
  });
  return <QueryClientProvider client={queryClient}>{open?<SourceEditorWorkspace target={target}
    onDirtyChange={value=>{window.workspaceDirty=value;}} onTargetUpdated={setTarget}
    onMessageChanged={message=>setTarget(current=>({...current,message}))}
    onClose={()=>setOpen(false)} onLocate={()=>{throw Error("Unexpected navigation");}}
    onDiscardAndSwitch={()=>{throw Error("Unexpected source switch");}}/>:null}</QueryClientProvider>;
}
function Root() {
  const [workspace,setWorkspace]=useState(null);
  const [previewProbe,setPreviewProbe]=useState(false);
  useEffect(()=>{
    window.startPreviewProbe=()=>{setWorkspace(null);setPreviewProbe(true);};
    window.startWorkspace=(source,zh=false)=>{
      window.gateLocale=zh?"zh-CN":"en-US";window.workspaceWrites=[];window.workspaceDirty=false;
      window.tableContextParseInputs=[];
      window.tableSourceProbeCount=0;
      setPreviewProbe(false);
      setWorkspace({source,key:performance.now()});
    };
  },[]);
  return previewProbe?<PreviewProbe/>:workspace?<WorkspaceHarness key={workspace.key} source={workspace.source}/>:<Harness/>;
}
function PreviewProbe() {
  const [tick,setTick]=useState(0);
  const [text,setText]=useState("| H | B |\\n| --- | --- |\\n| \\\\(x^2\\\\) | **value** |");
  return <section data-testid="table-renderer-probe">
    <button type="button" onClick={()=>setTick(value=>value+1)}>Update cell callback</button>
    <button type="button" onClick={()=>setText(value=>value.replace("**value**","**changed**"))}>Update preview source</button>
    <MarkdownTablePreview text={text} renderCell={(row,column,content)=>
      <span data-probe-cell data-probe-row={row} data-probe-column={column} data-probe-tick={tick}>{content}</span>}/>
  </section>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode>
  <React.Suspense fallback={<span data-testid="unexpected-preview-fallback">Loading</span>}><Root/></React.Suspense>
</React.StrictMode>);`);

const webpack = appRequire("next/dist/compiled/webpack/webpack").webpack;
await new Promise((yes, no) => webpack({
  mode: "production",
  context: root,
  entry: join(out, "entry.tsx"),
  output: { path: out, filename: "bundle.js" },
  optimization: { minimize: false },
  resolve: {
    extensions: [".tsx", ".ts", ".mjs", ".js"],
    modules: ["node_modules", join(web, "node_modules"), join(root, "node_modules")],
    alias: { ...Object.fromEntries([
      "@assistant-ui/react", "@assistant-ui/react-markdown", "shiki", "mermaid", "../../components/preferences-provider",
    ].map(name => [name + "$", join(out, "adapters.mjs")])),
      "react$": appRequire.resolve("react"),
      "react/jsx-runtime$": appRequire.resolve("react/jsx-runtime"),
      "react-dom$": appRequire.resolve("react-dom"),
      "react-dom/client$": appRequire.resolve("react-dom/client"),
      "react-markdown$": join(out, "markdown-probe.mjs"),
      "next/dynamic$": join(out, "client-loader.mjs"),
      "../../lib/api$": join(out, "workspace-adapters.mjs"),
      "../conversations/content-cleanup-panel$": join(out, "workspace-adapters.mjs"),
    },
  },
  module: {
    parser: { javascript: { dynamicImportMode: "eager" } },
    rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(out, "ts-loader.cjs") }],
  },
}, (error, stats) => error || stats.hasErrors() ? no(error ?? Error(stats.toString({ all: false, errors: true }))) : yes()));

const postcss = appRequire("postcss");
const tailwind = appRequire("tailwindcss");
const styles = await postcss([tailwind({
  content: [
    dialogPath, workspacePath, join(web, "features/editing/edit-message-form.tsx"),
    join(web, "features/editing/source-context-toolbar.tsx"), join(web, "components/floating-workspace-panel.tsx"),
    join(web, "features/conversations/markdown-renderer.tsx"), join(web, "components/use-dialog-focus.ts"),
  ],
  theme: { extend: {} }, plugins: [],
})]).process(readFileSync(join(web, "app/globals.css"), "utf8"), { from: join(web, "app/globals.css") });
const katexRoot = dirname(appRequire.resolve("katex/dist/katex.min.css"));
writeFileSync(join(out, "style.css"), styles.css + "\n" + readFileSync(join(katexRoot, "katex.min.css"), "utf8"));
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const path = pathname === "/bundle.js" || pathname === "/style.css" ? join(out, pathname.slice(1))
    : /^\/fonts\/KaTeX_[a-zA-Z0-9_.-]+$/.test(pathname) ? join(katexRoot, pathname) : null;
  response.setHeader("Content-Type", path
    ? ({ ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" }[extname(path)] ?? "application/octet-stream")
    : "text/html; charset=utf-8");
  try {
    response.end(path ? readFileSync(path) : '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:var(--page);font-family:system-ui"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(yes => server.listen(0, "127.0.0.1", yes));
const { chromium, expect } = appRequire("@playwright/test");
let browser;
const results = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("BROWSER " + error.message); });
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.tableGate));
  const dialog = page.getByTestId("source-editor-table-tool");
  const markdown = page.getByTestId("source-editor-table-markdown");
  const apply = () => dialog.getByRole("button", { name: /^(Apply|应用)$/ });
  const reset = async (source, zh = false) => {
    await page.evaluate(({ source, zh }) => window.tableGate.reset(source, zh), { source, zh });
    await page.locator("#open").click();
    await expect(dialog).toBeVisible();
    await expect(apply()).toBeEnabled();
  };
  const run = async (name, work) => {
    try {
      await work();
      results.push(name);
      console.log("PASS " + name);
    } catch (error) {
      writeFileSync(resultPath, JSON.stringify({
        date, startedAt, status: "failed", passed: results, failedScenario: name,
      }, null, 2));
      throw error;
    }
  };
  const small = "before\n| A | B |\n| --- | --- |\n| \\(x^2\\) | **bold** |\nafter";
  // A test-only renderer hold makes deferred/stale behavior deterministic rather
  // than depending on CPU speed. Actual Markdown parsing resumes on release.
  const holdPreview = marker => page.evaluate(marker => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    window.tablePreviewHold = { marker, promise };
    window.releaseTablePreview = () => { window.tablePreviewHold = null; release(); };
  }, marker);
  const releasePreview = () => page.evaluate(() => window.releaseTablePreview?.());
  const holdDraftParse = marker => page.evaluate(marker => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    window.tableDraftParseHold = { marker, promise, entries: 0 };
    window.releaseTableDraftParse = () => { window.tableDraftParseHold = null; release(); };
  }, marker);
  const releaseDraftParse = () => page.evaluate(() => window.releaseTableDraftParse?.());
  // Deliberately use coordinates, not locator.click/tap/hover: locator actions
  // scroll offscreen controls into view and would conceal this regression.
  const checkRowEdges = async (targetPage, label, positions = ["before", "after"]) => {
    const observation = await targetPage.evaluate(() => {
      const preview = document.querySelector("[data-testid='source-editor-table-preview']");
      const grid = document.querySelector("[data-testid='source-editor-table-grid']");
      const visible = preview.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        preview: { left: visible.left, right: visible.right, top: visible.top, bottom: visible.bottom,
          width: preview.clientWidth, scrollWidth: preview.scrollWidth, scrollLeft: preview.scrollLeft,
          height: preview.clientHeight, scrollHeight: preview.scrollHeight, scrollTop: preview.scrollTop },
        edges: ["before", "after"].map(position => {
          const button = grid.querySelector(`[data-testid='source-editor-table-add-row-${position}']`);
          const rect = button.getBoundingClientRect();
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { position, x, y, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: rect.width, height: rect.height,
            insideHorizontalViewport: rect.left >= visible.left - 1 && rect.right <= visible.right + 1,
            insideScreen: rect.top >= 0 && rect.bottom <= innerHeight,
            pointerHitsButton: hit === button || button.contains(hit),
            outsideCellViewport: rect.bottom <= visible.top || rect.top >= visible.bottom };
        }),
      };
    });
    edgeObservations.push({ label, requiredPositions: positions, ...observation });
    writeFileSync(edgeObservationPath, JSON.stringify({
      date, startedAt, status: "observed", boundary: "actual Chrome DOM and hit tests; no locator auto-scroll",
      observations: edgeObservations,
    }, null, 2));
    for (const edge of observation.edges) {
      if (!positions.includes(edge.position)) continue;
      assert.ok(edge.width >= 44 && edge.height >= 44, `${label}: ${edge.position} needs a 44px target`);
      assert.ok(edge.insideHorizontalViewport, `${label}: ${edge.position} row control is horizontally offscreen`);
      assert.ok(edge.insideScreen && edge.pointerHitsButton, `${label}: ${edge.position} must be directly pointer-reachable`);
      assert.ok(edge.outsideCellViewport, `${label}: ${edge.position} must not cover editable cells or scrollbars`);
    }
    return observation;
  };
  const scrollPreview = async (targetPage, horizontal, vertical = 0) => {
    await targetPage.getByTestId("source-editor-table-preview").evaluate(async (node, { horizontal, vertical }) => {
      node.scrollLeft = (node.scrollWidth - node.clientWidth) * horizontal;
      node.scrollTop = (node.scrollHeight - node.clientHeight) * vertical;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }, { horizontal, vertical });
  };
  const checkColumnEdges = async (targetPage, label) => {
    const observation = await targetPage.evaluate(() => {
      const preview = document.querySelector("[data-testid='source-editor-table-preview']");
      const visible = preview.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        preview: { left: visible.left, right: visible.right, top: visible.top, bottom: visible.bottom,
          scrollLeft: preview.scrollLeft, scrollTop: preview.scrollTop },
        edges: ["before", "after"].map(position => {
          const button = document.querySelector(`[data-testid='source-editor-table-add-column-${position}']`);
          const rect = button.getBoundingClientRect();
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { position, x, y, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: rect.width, height: rect.height,
            insideVerticalViewport: rect.top >= visible.top && rect.bottom <= visible.bottom,
            insideScreen: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            pointerHitsButton: hit === button || button.contains(hit),
            outsideCellViewport: rect.right <= visible.left || rect.left >= visible.right };
        }),
      };
    });
    edgeObservations.push({ label, axis: "column", ...observation });
    writeFileSync(edgeObservationPath, JSON.stringify({
      date, startedAt, status: "observed", boundary: "actual Chrome DOM and hit tests; no locator auto-scroll",
      observations: edgeObservations,
    }, null, 2));
    for (const edge of observation.edges) {
      assert.ok(edge.width >= 44 && edge.height >= 44, `${label}: ${edge.position} needs a 44px target`);
      assert.ok(edge.insideVerticalViewport, `${label}: ${edge.position} column control is vertically offscreen`);
      assert.ok(edge.insideScreen && edge.pointerHitsButton, `${label}: ${edge.position} must be directly pointer-reachable`);
      assert.ok(edge.outsideCellViewport, `${label}: ${edge.position} must not cover editable cells or scrollbars`);
    }
    return observation;
  };

  await run("one real rendered table; no obsolete modes; math and cell source", async () => {
    await reset(small);
    await expect(dialog.locator("table")).toHaveCount(1);
    await expect(dialog.locator(".katex")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: /Create blank|Normalize|Add rows|Add columns/ })).toHaveCount(0);
    await page.screenshot({ path: join(out, "desktop-light.png") });
  });
  await run("desktop edges reveal on hover/focus; Tab remains inside the dialog", async () => {
    const edge = dialog.getByTestId("source-editor-table-add-row-before");
    await expect(edge).toHaveCSS("opacity", "0");
    await edge.hover();
    await expect(edge).toHaveCSS("opacity", "1");
    await dialog.getByRole("button", { name: "Column 1 header", exact: true }).focus();
    await expect(dialog.getByTestId("source-editor-table-add-column-after")).toHaveCSS("opacity", "1");
    await apply().focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(apply()).toBeFocused();
  });
  await run("cell typing retains focus and immediately updates escaped Markdown", async () => {
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("edited");
    await input.pressSequentially(" | 中文");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("edited | 中文");
    await expect(markdown).toHaveValue(/\| edited \\\| 中文 \|/);
    await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "false");
    await expect(apply()).toBeEnabled();
    await input.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
    await expect(dialog.locator("td").first()).toContainText("edited | 中文");
  });
  await run("cell text selection keeps native caret behavior until a cell boundary", async () => {
    await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("hello");
    await input.press("Home");
    await input.press("ArrowRight");
    await input.press("ArrowRight");
    await input.press("Shift+ArrowLeft");
    assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]), [1, 2]);
    await expect(input).toBeFocused();
    await input.evaluate(node => node.setSelectionRange(2, 2));
    await input.press("Shift+ArrowUp");
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 2]);
    await input.evaluate(node => node.setSelectionRange(2, 2));
    await input.press("Shift+ArrowDown");
    await expect(input).toBeFocused();
    assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]), [2, 5]);
    await input.press("ArrowLeft");
    await expect(input).toBeFocused();
    await input.press("Home");
    await input.press("ArrowLeft");
    await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
  });
  await run("raw Markdown repairs ragged rows and applies only the original table", async () => {
    await markdown.fill("| New | B |\n| - |\n| left | right | extra |");
    await expect(dialog.locator("th")).toHaveCount(3);
    await expect(dialog.locator("td")).toHaveCount(3);
    await apply().click();
    const applied = await page.evaluate(() => window.applied);
    assert.equal(applied.length, 1);
    assert.equal(applied[0], "before\n| New | B |  |\n| --- | --- | --- |\n| left | right | extra |\nafter");
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await run("incomplete Markdown is preserved; stale grid cannot overwrite it", async () => {
    await reset(small);
    await markdown.fill("unfinished Markdown");
    await expect(apply()).toBeDisabled();
    await expect(dialog.locator("[data-table-cell]").first()).toBeDisabled();
    await expect(markdown).toHaveValue("unfinished Markdown");
    await markdown.fill("\n| A | B |\n| --- | --- |\n| restored | 2 |\n");
    await expect(apply()).toBeEnabled();
    await expect(dialog.locator("td").first()).toContainText("restored");
  });
  await run("four edges add rows/columns; Enter never submits; IME does not navigate", async () => {
    await dialog.getByTestId("source-editor-table-add-row-before").click();
    await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
    await dialog.getByTestId("source-editor-table-add-row-after").click();
    await expect(dialog.getByRole("button", { name: "Row 3, column 1", exact: true })).toBeFocused();
    await dialog.getByTestId("source-editor-table-add-column-before").click();
    await expect(dialog.getByRole("button", { name: "Column 1 header", exact: true })).toBeFocused();
    await dialog.getByTestId("source-editor-table-add-column-after").click();
    await expect(dialog.getByRole("button", { name: "Column 4 header", exact: true })).toBeFocused();
    await expect(dialog.locator("th")).toHaveCount(4);
    await expect(dialog.locator("tbody tr")).toHaveCount(3);
    await dialog.getByRole("button", { name: "Row 3, column 4", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    await expect(input).toBeFocused();
    await input.press("Enter");
    assert.equal(await page.evaluate(() => window.submits), 0);
    await expect(dialog).toBeVisible();
  });
  await run("external source changes do not reset a draft; refresh is explicit", async () => {
    await reset(small);
    await markdown.fill("| A | B |\n| --- | --- |\n| draft | 2 |");
    await page.evaluate(() => window.tableGate.externalChange("before\n| A | B |\n| --- | --- |\n| external | 2 |\nafter"));
    await expect(apply()).toBeDisabled();
    await expect(markdown).toHaveValue(/draft/);
    await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await expect(markdown).toHaveValue(/external/);
    await expect(apply()).toBeEnabled();
  });
  await run("quote containers and CRLF survive cell edits and final application", async () => {
    await reset("intro\r\n> | A | B |\r\n> | --- | --- |\r\n> | 1 | 2 |\r\noutro");
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("quoted");
    await apply().click();
    assert.deepEqual(await page.evaluate(() => window.applied), [
      "intro\r\n> | A | B |\r\n> | --- | --- |\r\n> | quoted | 2 |\r\noutro",
    ]);
  });
  await run("CRLF tables after an HTML blank boundary keep live reference captions and exact source", async () => {
    const source = "<div>\r\n\r\n| A | B |\r\n| --- | --- |\r\n| [label][paper] | 2 |\r\n\r\n[paper]: /actual-reference\r\n\r\n</div>";
    await reset(source);
    await expect(dialog.locator("td").first()).toHaveText("label");
    await expect(dialog.locator("a")).toHaveCount(0);
    await apply().click();
    assert.deepEqual(await page.evaluate(() => window.applied), [source]);
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await run("row paging is bounded and appending reveals the actual final row", async () => {
    await reset("| A | B |\n| --- | --- |\n" + Array.from({ length: 85 }, (_, index) => `| row${index + 1} | 2 |`).join("\n"));
    await expect(dialog.locator("tbody tr")).toHaveCount(30);
    await dialog.getByRole("button", { name: "Row 30, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").press("Enter");
    await expect(dialog.getByText("31–60 / 85")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Row 31, column 1", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Row 31, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").press("Shift+Enter");
    await expect(dialog.getByText("1–30 / 85")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Row 30, column 1", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Next table rows" }).click();
    await expect(dialog.locator("td").first()).toContainText("row31");
    await dialog.getByRole("button", { name: "Row 31, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("row31-edited");
    await expect(markdown).toHaveValue(/row31-edited/);
    await expect(dialog.locator("td").first()).toContainText("row31-edited");
    await expect(apply()).toBeEnabled();
    await dialog.getByTestId("source-editor-table-add-row-after").click();
    await expect(dialog.locator("tbody tr")).toHaveCount(26);
    await expect(dialog.getByRole("button", { name: "Row 86, column 1", exact: true })).toBeVisible();
  });
  await run("200-column preview mounts at most 400 cells and refuses another column", async () => {
    const line = "| " + Array(200).fill("x").join(" | ") + " |";
    await reset(line + "\n| " + Array(200).fill("---").join(" | ") + " |\n" + Array(40).fill(line).join("\n"));
    assert.equal(await dialog.locator("th,td").count(), 400);
    await expect(dialog.getByRole("button", { name: "Next table rows" })).toBeVisible();
    await expect(dialog.getByText("1–1 / 40")).toBeVisible();
    await expect(dialog.getByTestId("source-editor-table-add-column-after")).toBeDisabled();
  });
  await run("large tables reach first and last row pages directly and preserve exact tail edits", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    const header = "| " + Array.from({ length: 10 }, (_, index) => `H${index + 1}`).join(" | ") + " |";
    const separator = "| " + Array(10).fill("---").join(" | ") + " |";
    const rows = Array.from({ length: 4_000 }, (_, row) =>
      "| " + Array.from({ length: 10 }, (_, column) => `R${row + 1}C${column + 1}`).join(" | ") + " |");
    const table = [header, separator, ...rows].join("\n");
    const source = `before\n\n${table}\n\nafter`;
    await reset(source);
    const originalMarkdown = await markdown.inputValue();
    const first = dialog.getByRole("button", { name: "First table rows", exact: true });
    const last = dialog.getByRole("button", { name: "Last table rows", exact: true });
    writeFileSync(join(out, "page-navigation-entry.json"), JSON.stringify({
      columns: 10, dataRows: rows.length, visibleDataRows: await dialog.locator("tbody tr").count(),
      mountedCells: await dialog.locator("th,td").count(),
      firstButtons: await first.count(), lastButtons: await last.count(),
      sourceUnchanged: await page.evaluate(source => window.tableGate.source() === source, source),
    }, null, 2));
    await page.screenshot({ path: join(out, "page-navigation-first-desktop-light.png") });
    assert.equal(await last.count(), 1, "Large tables need a direct last-page command");
    await expect(last).toBeVisible();
    await expect(first).toBeDisabled();
    await last.focus();
    await last.press("Enter");
    await expect(dialog.getByText("3994–4000 / 4000", { exact: true })).toBeVisible();
    await expect(last).toBeDisabled();
    await expect(first).toBeEnabled();
    const keyboardFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName, label: active?.getAttribute("aria-label"),
        insideDialog: Boolean(active?.closest("[data-testid='source-editor-table-tool']")),
      };
    });
    writeFileSync(join(out, "page-navigation-keyboard.json"), JSON.stringify(keyboardFocus, null, 2));
    assert.equal(keyboardFocus.insideDialog, true, "Boundary navigation must not lose keyboard focus outside the dialog");
    await expect(dialog.getByRole("button", { name: "Previous table rows", exact: true })).toBeFocused();
    await expect(markdown).toHaveValue(originalMarkdown);
    await dialog.getByRole("button", { name: "Row 4000, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("tail|🙂");
    await expect(markdown).toHaveValue(originalMarkdown.replace("| R4000C1 |", "| tail\\|🙂 |"));
    await first.click();
    await expect(dialog.locator("td").first()).toHaveText("R1C1");
    await expect(first).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Next table rows", exact: true })).toBeFocused();
    await last.click();
    await expect(dialog.getByRole("button", { name: "Row 4000, column 1", exact: true })).toHaveText("tail|🙂");
    assert.ok(await dialog.locator("th,td").count() <= 120);
    await expect(apply()).toBeEnabled();
    await page.screenshot({ path: join(out, "page-navigation-last-desktop-light.png") });
    await apply().click();
    assert.deepEqual(await page.evaluate(() => window.applied), [source.replace("| R4000C1 |", "| tail\\|🙂 |")]);
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await run("row boundary navigation disappears for a single page and clamps a smaller Markdown draft", async () => {
    const source = "| A | B |\n| --- | --- |\n" + Array.from({ length: 85 }, (_, row) => `| row${row + 1} | 2 |`).join("\n");
    await reset(source);
    await dialog.getByRole("button", { name: "Last table rows", exact: true }).click();
    await expect(dialog.getByText("61–85 / 85", { exact: true })).toBeVisible();
    const smaller = "| A | B |\n| --- | --- |\n| retained | 2 |";
    await markdown.fill(smaller);
    await expect(dialog.locator("td").first()).toHaveText("retained");
    await expect(dialog.getByRole("group", { name: "Table row pages", exact: true })).toHaveCount(0);
    await expect(apply()).toBeEnabled();
    assert.equal(await page.evaluate(() => window.tableGate.source()), source);
    await apply().click();
    assert.deepEqual(await page.evaluate(() => window.applied), [smaller]);
    await reset(smaller);
    await expect(dialog.getByRole("group", { name: "Table row pages", exact: true })).toHaveCount(0);
  });
  await run("wide-table row edges stay pointer-reachable at every horizontal scroll position", async () => {
    const columns = 200;
    const header = "| " + Array.from({ length: columns }, (_, column) => `H${column + 1}`).join(" | ") + " |";
    const separator = "| " + Array(columns).fill("---").join(" | ") + " |";
    const rows = Array.from({ length: 40 }, (_, row) =>
      "| " + Array.from({ length: columns }, (_, column) => `R${row + 1}C${column + 1}`).join(" | ") + " |");
    const empty = "| " + Array(columns).fill("").join(" | ") + " |";
    await reset([header, separator, ...rows].join("\n"));
    for (const position of [0, 0.5, 1]) {
      await scrollPreview(page, position);
      const observation = await checkRowEdges(page, `desktop-200-columns-scroll-${position}`);
      const edge = observation.edges.find(edge => edge.position === "after");
      await page.mouse.move(edge.x, edge.y);
      await expect(dialog.getByTestId("source-editor-table-add-row-after")).toHaveCSS("opacity", "1");
    }
    await page.screenshot({ path: join(out, "wide-edges-desktop-light.png") });
    const after = (await checkRowEdges(page, "desktop-before-pointer-append")).edges[1];
    await page.mouse.click(after.x, after.y);
    await expect(dialog.getByRole("button", { name: "Row 41, column 1", exact: true })).toBeFocused();
    await expect(dialog.getByText("41–41 / 41")).toBeVisible();
    await scrollPreview(page, 0.5);
      const before = (await checkRowEdges(page, "desktop-before-pointer-prepend")).edges[0];
      await page.mouse.click(before.x, before.y);
      await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
    await expect(markdown).toHaveValue([header, separator, empty, ...rows, empty].join("\n"));
    await dialog.getByTestId("source-editor-table-add-row-after").focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Row 43, column 1", exact: true })).toBeFocused();
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
  await run("all four edges remain pointer-reachable while a long wide preview scrolls on both axes", async () => {
    const line = "| " + Array(12).fill("cell").join(" | ") + " |";
    await reset([line, "| " + Array(12).fill("---").join(" | ") + " |", ...Array(30).fill(line)].join("\n"));
    const preview = dialog.getByTestId("source-editor-table-preview");
    assert.ok(await preview.evaluate(node => node.scrollHeight > node.clientHeight));
    for (const position of [0, 0.5, 1]) {
      await scrollPreview(page, position, position);
      await checkRowEdges(page, `desktop-vertical-scroll-${position}`);
      await checkColumnEdges(page, `desktop-column-edges-scroll-${position}`);
    }
    const edges = (await checkColumnEdges(page, "desktop-before-column-append")).edges;
    await page.mouse.move(edges[1].x, edges[1].y);
    await page.screenshot({ path: join(out, "scrolling-edges-desktop-light.png") });
    await page.mouse.click(edges[1].x, edges[1].y);
    await expect(dialog.getByRole("button", { name: "Column 13 header", exact: true })).toBeFocused();
    await scrollPreview(page, 0.5, 0.5);
    const before = (await checkColumnEdges(page, "desktop-before-column-prepend")).edges[0];
    await page.mouse.click(before.x, before.y);
    await expect(dialog.getByRole("button", { name: "Column 1 header", exact: true })).toBeFocused();
    await expect(dialog.locator("th")).toHaveCount(14);
    const lines = (await markdown.inputValue()).split("\n");
    assert.equal(lines.length, 32);
    for (const line of [lines[0], ...lines.slice(2)]) {
      assert.equal(line, "|  | " + Array(12).fill("cell").join(" | ") + " |  |");
    }
  });
  await run("375px touch row edges stay reachable across a 200-column table and focus the appended row", async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
    try {
      const mobilePage = await mobileContext.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.tableGate));
      const line = "| " + Array(200).fill("cell").join(" | ") + " |";
      await mobilePage.evaluate(source => {
        document.documentElement.dataset.theme = "dark";
        window.tableGate.reset(source, true);
      }, [line, "| " + Array(200).fill("---").join(" | ") + " |", line].join("\n"));
      await mobilePage.locator("#open").tap();
      const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
      await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
      for (const position of [0, 0.5, 1]) {
        await scrollPreview(mobilePage, position);
        await checkRowEdges(mobilePage, `touch-200-columns-scroll-${position}`);
      }
      await mobilePage.screenshot({ path: join(out, "wide-edges-mobile-dark.png") });
      const after = (await checkRowEdges(mobilePage, "touch-before-append")).edges[1];
      await mobilePage.touchscreen.tap(after.x, after.y);
      await expect(mobileDialog.getByRole("button", { name: "第 2 行第 1 列", exact: true })).toBeFocused();
      await expect(mobileDialog.getByText("2–2 / 2")).toBeVisible();
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mobilePage.setViewportSize({ width: 667, height: 375 });
      await scrollPreview(mobilePage, 1, 1);
      await checkRowEdges(mobilePage, "touch-landscape-scroll-end-top", ["before"]);
      // The short landscape dialog legitimately scrolls its whole working
      // area. Move only that vertical document viewport; never auto-reveal an
      // offscreen target or alter the table's horizontal scroll for this check.
      await mobileDialog.getByTestId("source-editor-table-grid").evaluate(async grid => {
        const body = grid.parentElement;
        body.scrollTop += Math.max(0, grid.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom);
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      await checkRowEdges(mobilePage, "touch-landscape-scroll-end-bottom", ["after"]);
      await mobilePage.screenshot({ path: join(out, "wide-edges-mobile-landscape-dark.png") });
      await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeInViewport();
    } finally {
      await mobileContext.close();
    }
  });
  await run("375px touch can append a column without finding the full table's vertical midpoint", async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
    try {
      const mobilePage = await mobileContext.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.tableGate));
      const line = "| " + Array(12).fill("cell").join(" | ") + " |";
      await mobilePage.evaluate(source => {
        document.documentElement.dataset.theme = "dark";
        window.tableGate.reset(source, true);
      }, [line, "| " + Array(12).fill("---").join(" | ") + " |", ...Array(30).fill(line)].join("\n"));
      await mobilePage.locator("#open").tap();
      const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
      await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
      for (const position of [0, 0.5, 1]) {
        await scrollPreview(mobilePage, position, position);
        await checkRowEdges(mobilePage, `touch-tall-row-edges-${position}`);
        await checkColumnEdges(mobilePage, `touch-tall-column-edges-${position}`);
      }
      await mobilePage.screenshot({ path: join(out, "scrolling-edges-mobile-dark.png") });
      const after = (await checkColumnEdges(mobilePage, "touch-before-column-append")).edges[1];
      await mobilePage.touchscreen.tap(after.x, after.y);
      await expect(mobileDialog.getByRole("button", { name: "第 13 列表头", exact: true })).toBeFocused();
      await expect(mobileDialog.locator("th")).toHaveCount(13);
      assert.equal((await mobileDialog.getByTestId("source-editor-table-markdown").inputValue()).split("\n").length, 32);
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally {
      await mobileContext.close();
    }
  });
  await run("375px touch/dark and 768px tablet layouts contain overflow and preserve touch targets", async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", error => errors.push(error.message));
    mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
    await mobilePage.waitForFunction(() => Boolean(window.tableGate));
    await mobilePage.evaluate(source => { document.documentElement.dataset.theme = "dark"; window.tableGate.reset(source, true); }, small);
    await mobilePage.locator("#open").tap();
    const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
    const mobileMarkdown = mobileDialog.getByTestId("source-editor-table-markdown");
    await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const targets = await mobileDialog.locator("[data-testid^='source-editor-table-add-']").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return [rect.width, rect.height, getComputedStyle(node).opacity];
    }));
    assert.ok(targets.every(([width, height, opacity]) => width >= 44 && height >= 44 && Number(opacity) === 1));
    await expect(mobileMarkdown).toHaveCSS("font-size", "16px");
    await mobilePage.screenshot({ path: join(out, "mobile-dark.png") });
    await mobileDialog.getByTestId("source-editor-table-add-row-after").tap();
    await expect(mobileDialog.locator("tbody tr")).toHaveCount(2);
    await mobilePage.setViewportSize({ width: 667, height: 375 });
    await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeInViewport();
    await expect(mobileDialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobileContext.close();
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    await page.setViewportSize({ width: 768, height: 1024 });
    await reset(small, true);
    await expect(apply()).toBeInViewport();
    await page.screenshot({ path: join(out, "tablet-dark.png") });
  });
  await run("Escape closes once and restores the logical opener", async () => {
    await markdown.focus();
    await markdown.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#open")).toBeFocused();
  });
  await run("pending raw parsing cannot apply the old verified table and keeps only the latest Markdown", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await reset(small);
    await holdDraftParse("parse-held");
    try {
      await markdown.fill("| New | B |\n| --- | --- |\n| parse-held first | 2 |");
      await page.waitForFunction(() => window.tableDraftParseHold.entries > 0);
      await expect(markdown).toHaveValue(/parse-held first/);
      await expect(dialog.locator("th").first()).toHaveText("A");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "true");
      await expect(dialog.getByRole("status")).toHaveText("Updating table preview…");
      await expect(apply()).toBeDisabled();
      await expect(dialog.locator("[data-table-cell]:enabled")).toHaveCount(0);
      await expect(dialog.locator("[data-testid^='source-editor-table-add-']:enabled")).toHaveCount(0);
      await apply().evaluate(button => button.click());
      assert.deepEqual(await page.evaluate(() => window.applied), []);
      assert.equal(await page.evaluate(() => window.tableGate.source()), small);
      const latest = "| Updated | B | C |\n| --- | --- | --- |\n| parse-held final | 2 | 3 |";
      await markdown.fill(latest);
      await expect(markdown).toHaveValue(latest);
      await expect(apply()).toBeDisabled();
      await page.screenshot({ path: join(out, "draft-parse-pending-desktop-light.png") });
      await releaseDraftParse();
      await expect(dialog.locator("th")).toHaveCount(3);
      await expect(dialog.locator("td").first()).toHaveText("parse-held final");
      await expect(apply()).toBeEnabled();
      await apply().click();
      assert.deepEqual(await page.evaluate(() => window.applied), [`before\n${latest}\nafter`]);
    } finally { await releaseDraftParse(); }
  });
  await run("invalid raw text supersedes a suspended parser without restoring its obsolete table", async () => {
    await reset(small);
    await holdDraftParse("parse-obsolete");
    try {
      await markdown.fill("| A | B |\n| --- | --- |\n| parse-obsolete | 2 |");
      await page.waitForFunction(() => window.tableDraftParseHold.entries > 0);
      await markdown.fill("incomplete newest draft");
      await releaseDraftParse();
      await expect(markdown).toHaveValue("incomplete newest draft");
      await expect(markdown).toHaveAttribute("aria-invalid", "true");
      await expect(apply()).toBeDisabled();
      await expect(dialog.locator("[data-table-cell]:enabled")).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.tableGate.source()), small);
      await markdown.fill("| Fixed | B |\n| --- | --- |\n| recovered | 2 |");
      await expect(dialog.locator("td").first()).toHaveText("recovered");
      await expect(apply()).toBeEnabled();
    } finally { await releaseDraftParse(); }
  });
  await run("pending source previews cannot edit old cells or Apply, and catch up to the latest draft", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await reset(small);
    // Keep this fixture on the rich fallback path: the plain-table fast path
    // intentionally has no Markdown parser to suspend.
    await holdPreview("pending *latest*");
    try {
      await markdown.fill("| New | B |\n| --- | --- |\n| pending *latest* first | 2 |");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "true");
      const latest = "| Updated | B | C |\n| --- | --- | --- |\n| pending *latest* final | 2 | 3 |";
      await markdown.fill(latest);
      await expect(markdown).toHaveValue(latest);
      await expect(apply()).toBeDisabled();
      await expect(dialog.locator("[data-table-cell]:enabled")).toHaveCount(0);
      await expect(dialog.locator("[data-testid^='source-editor-table-add-']:enabled")).toHaveCount(0);
      await expect(page.getByTestId("unexpected-preview-fallback")).toHaveCount(0);
      await apply().evaluate(button => button.click());
      assert.deepEqual(await page.evaluate(() => window.applied), []);
      await page.screenshot({ path: join(out, "preview-pending-desktop-light.png") });
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(apply()).toBeInViewport();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await expect(dialog.getByRole("status")).toHaveText("Updating table preview…");
      await page.screenshot({ path: join(out, "preview-pending-mobile-light.png") });
      await page.setViewportSize({ width: 1440, height: 900 });
      await releasePreview();
      await expect(dialog.locator("th")).toHaveCount(3);
      await expect(dialog.locator("td").first()).toHaveText("pending latest final");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "false");
      await expect(apply()).toBeEnabled();
      await apply().click();
      assert.deepEqual(await page.evaluate(() => window.applied), [`before\n${latest}\nafter`]);
    } finally { await releasePreview(); }
  });
  await run("pending grid previews retain active typing and Escape returns focus to Markdown", async () => {
    await reset(small);
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await holdPreview("pending *input*");
    try {
      await input.fill("pending *input*");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "true");
      await input.pressSequentially("123");
      await expect(input).toHaveValue("pending *input*123");
      await expect(input).toBeFocused();
      await expect(markdown).toHaveValue(/\| pending \*input\*123 \|/);
      await input.press("Enter");
      await expect(input).toBeFocused();
      assert.equal(await page.evaluate(() => window.submits), 0);
      await input.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(markdown).toBeFocused();
      await releasePreview();
      await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toHaveText("pending input123");
      await expect(apply()).toBeEnabled();
    } finally { await releasePreview(); }
  });
  await run("invalid Markdown entered during a pending preview cannot be overwritten by the older valid draft", async () => {
    await reset(small);
    await holdPreview("pending *invalid*");
    try {
      await markdown.fill("| A | B |\n| --- | --- |\n| pending *invalid* | 2 |");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "true");
      await markdown.fill("incomplete current draft");
      await releasePreview();
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "false");
      await expect(markdown).toHaveValue("incomplete current draft");
      await expect(markdown).toHaveAttribute("aria-invalid", "true");
      await expect(apply()).toBeDisabled();
      await expect(dialog.locator("[data-table-cell]:enabled")).toHaveCount(0);
      await markdown.fill("| Fixed | B |\n| --- | --- |\n| recovered | 2 |");
      await expect(dialog.locator("td").first()).toHaveText("recovered");
      await expect(apply()).toBeEnabled();
    } finally { await releasePreview(); }
  });
  await run("explicit source refresh drops a suspended old table preview", async () => {
    await reset(small);
    await holdPreview("pending *obsolete*");
    try {
      await markdown.fill("| A | B |\n| --- | --- |\n| pending *obsolete* | 2 |");
      await expect(dialog.getByTestId("source-editor-table-preview")).toHaveAttribute("aria-busy", "true");
      await page.evaluate(() => window.tableGate.externalChange("before\n| A | B |\n| --- | --- |\n| external latest | 2 |\nafter"));
      await expect(apply()).toBeDisabled();
      await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
      await releasePreview();
      await expect(markdown).toHaveValue(/\| external latest \|/);
      await expect(dialog.locator("td").first()).toHaveText("external latest");
      await expect(apply()).toBeEnabled();
    } finally { await releasePreview(); }
  });
  await run("renderer updates cell callbacks without reparsing unchanged Markdown", async () => {
    await page.evaluate(() => window.startPreviewProbe());
    const probe = page.getByTestId("table-renderer-probe");
    await expect(probe.locator("[data-probe-cell]")).toHaveCount(4);
    await expect(probe.locator(".katex")).toHaveCount(1);
    const before = await page.evaluate(() => window.tableMarkdownParseCount);
    await probe.getByRole("button", { name: "Update cell callback" }).click();
    await expect(probe.locator("[data-probe-cell][data-probe-tick='1']")).toHaveCount(4);
    assert.equal(await page.evaluate(() => window.tableMarkdownParseCount), before);
    await probe.getByRole("button", { name: "Update preview source" }).click();
    await expect(probe.locator("td").last()).toHaveText("changed");
    assert.ok(await page.evaluate(() => window.tableMarkdownParseCount) > before);
    await expect(probe.locator(".katex")).toHaveCount(1);
  });
  const workspaceSource = "before\n\n| A | B |\n| --- |\n| 1 | 2 |\n\nafter";
  const workspace = page.getByTestId("floating-source-workspace");
  const cm = workspace.locator(".cm-content[contenteditable='true']");
  const startWorkspace = async (source = workspaceSource, zh = false) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(({ source, zh }) => {
      document.documentElement.dataset.theme = "light";
      window.startWorkspace(source, zh);
    }, { source, zh });
    await expect(cm).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
  };
  const openWorkspaceTable = async (ready = true) => {
    await workspace.getByTestId("source-editor-tools-toggle").click();
    await workspace.locator("[data-source-toolbar-command='table']").click();
    await expect(dialog).toBeVisible();
    if (ready) await expect(apply()).toBeEnabled();
  };
  await run("actual workspace: a table applies to CodeMirror, then one toolbar Undo restores the exact source", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("edited");
    await apply().click();
    await expect(dialog).toHaveCount(0);
    await expect(cm).toBeFocused();
    const expected = "before\n\n| A | B |\n| --- | --- |\n| edited | 2 |\n\nafter";
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(expected);
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(workspaceSource);
    await expect(workspace.getByTestId("source-editor-create-version")).toBeDisabled();
    await workspace.getByTestId("source-editor-redo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(expected);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: deeply quoted prose does not block table discovery or change surrounding source", async () => {
    const prefix = "> ".repeat(32) + "ordinary quoted prose\n\n";
    const source = prefix + "| A | B |\n| --- |\n| 1 | 2 |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("edited");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      prefix + "| A | B |\n| --- | --- |\n| edited | 2 |\n\nafter",
    );
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: quote/list-looking closers cannot expose code examples to automatic editing", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    for (const source of [
      "```md\n> ```\n" + table + "\n```",
      "```md\n- ```\n" + table + "\n```",
      "> ```md\n> > ```\n" + table.split("\n").map(line => "> " + line).join("\n") + "\n> ```",
      "    " + table.replaceAll("\n", "\n    "),
    ]) {
      await startWorkspace(source);
      await openWorkspaceTable(false);
      await expect(apply()).toHaveCount(0);
      await expect(markdown).toHaveCount(0);
      await expect(dialog.getByText("Select the complete table to try again, including code or HTML examples.")).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
      assert.deepEqual(await page.evaluate(() => window.tableContextParseInputs), []);
    }
  });
  await run("actual workspace: leaving quoted/list code restores outside tables without reparsing source", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    for (const prefix of ["> ```md\n> sample\n\n", "- ```md\n  sample\n\n", "- item\n  ```md\n  sample\n\n"]) {
      const source = prefix + table + "\n\nafter";
      await startWorkspace(source);
      await openWorkspaceTable();
      await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
      await dialog.getByTestId("source-editor-table-cell-input").fill("outside");
      await apply().click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
        prefix + table.replace("| 1 | 2 |", "| outside | 2 |") + "\n\nafter",
      );
      assert.deepEqual(await page.evaluate(() => window.tableContextParseInputs), []);
      await workspace.getByTestId("source-editor-undo").click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    }
  });
  await run("actual workspace: nested-list table preview is editable without losing its indentation", async () => {
    const source = "- item\n\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    await expect(dialog.locator("table")).toHaveCount(1);
    await expect(markdown).toHaveValue("    | A | B |\n    | --- | --- |\n    | 1 | 2 |");
    await page.screenshot({ path: join(out, "nested-list-desktop-light.png") });
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("nested");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| nested | 2 |"));
    assert.deepEqual(await page.evaluate(() => window.tableContextParseInputs), []);
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: an explicit code-table selection can edit the example without removing its fence", async () => {
    const source = "```md\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n```";
    await startWorkspace(source);
    const from = source.indexOf("\n") + 1, to = source.lastIndexOf("\n");
    await page.evaluate(({ from, to }) => window.workspaceGate.select(from, to), { from, to });
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("example");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| example | 2 |"));
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: raw HTML blocks cannot masquerade as automatically repairable tables", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    for (const [before, prefix, after] of [
      ["<div>", "", "</div>"],
      ["<!--", "", "-->"],
      ["<?instruction", "", "?>"],
      ["<script>", "", "</script>"],
      ["> <div>", "> ", "> </div>"],
      ["- <div>", "  ", "  </div>"],
    ]) {
      const source = before + "\n" + table.split("\n").map(line => prefix + line).join("\n") + "\n" + after;
      await startWorkspace(source);
      await workspace.getByTestId("source-editor-preview-toggle").click();
      await expect(workspace.getByTestId("source-editor-rich-preview")).toBeVisible();
      await expect(workspace.getByTestId("source-editor-rich-preview").locator("table")).toHaveCount(0);
      await openWorkspaceTable(false);
      await expect(apply()).toHaveCount(0);
      await expect(markdown).toHaveCount(0);
      await expect(dialog.locator("table")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.tableContextParseInputs), []);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    }
    await page.screenshot({ path: join(out, "html-context-blocked-desktop-light.png") });
    await startWorkspace("<!--\n" + table + "\n-->", true);
    await page.setViewportSize({ width: 375, height: 812 });
    await openWorkspaceTable(false);
    await expect(apply()).toHaveCount(0);
    await expect(dialog.getByText("请完整选中表格后重试；代码或 HTML 示例也需明确选中。")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "返回源码", exact: true })).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(out, "html-context-blocked-mobile-light.png") });
  });
  await run("actual workspace: real tables outside HTML remain editable and render after Apply and Undo", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    for (const [before, after] of [
      ["<div>\n\n", "\n\n</div>"],
      ["<!-- hidden -->\n", "\n\nafter"],
      ["> <div>\n", "\n\nafter"],
    ]) {
      const source = before + table + after;
      await startWorkspace(source);
      await workspace.getByTestId("source-editor-preview-toggle").click();
      const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
      await expect(sourcePreview.locator("table")).toHaveCount(1);
      await openWorkspaceTable();
      await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
      await dialog.getByTestId("source-editor-table-cell-input").fill("outside");
      await apply().click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| outside | 2 |"));
      await expect(sourcePreview.locator("table")).toHaveCount(1);
      await expect(sourcePreview.locator("td").first()).toHaveText("outside");
      assert.deepEqual(await page.evaluate(() => window.tableContextParseInputs), []);
      await workspace.getByTestId("source-editor-undo").click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      await expect(sourcePreview.locator("td").first()).toHaveText("1");
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    }
  });
  await run("actual workspace: explicit HTML sample editing preserves the wrapper rather than changing its rendering policy", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const source = "<!--\n" + table + "\n-->";
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview).toBeVisible();
    await expect(sourcePreview.locator("table")).toHaveCount(0);
    await page.evaluate(({ from, to }) => window.workspaceGate.select(from, to), { from: 5, to: 5 + table.length });
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("example");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| example | 2 |"));
    await expect(sourcePreview.locator("table")).toHaveCount(0);
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: textarea raw text across blank lines cannot become an automatic table", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    for (const source of [
      "<textarea>\n\n" + table + "\n</textarea>",
      "> <textarea>\n>\n" + table.split("\n").map(line => "> " + line).join("\n") + "\n> </textarea>",
    ]) {
      await startWorkspace(source);
      await workspace.getByTestId("source-editor-preview-toggle").click();
      await expect(workspace.getByTestId("source-editor-rich-preview").locator("table")).toHaveCount(0);
      await openWorkspaceTable(false);
      await expect(apply()).toHaveCount(0);
      await expect(dialog.locator("table")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    }
    await page.screenshot({ path: join(out, "textarea-protected-desktop-light.png") });
  });
  await run("actual workspace: a blank quote payload ends ordinary HTML before a real table", async () => {
    const source = "> <div>\n>\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n> </div>";
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("table")).toHaveCount(1);
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("quoted");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| quoted | 2 |"));
    await expect(sourcePreview.locator("td").first()).toHaveText("quoted");
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    await expect(sourcePreview.locator("td").first()).toHaveText("1");
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: textarea examples never lend definitions to an outside table", async () => {
    const source = "<textarea>\n\n[hidden]: /not-an-actual-reference\n</textarea>\n\n"
      + "| A | B |\n| --- | --- |\n| [label][hidden] | [actual][kept] |\n\n[kept]: /kept";
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("td").first()).toHaveText("[label][hidden]");
    await expect(sourcePreview.locator("td").nth(1)).toHaveText("actual");
    await openWorkspaceTable();
    await expect(dialog.locator("td").first()).toHaveText("[label][hidden]");
    await expect(dialog.locator("td").nth(1)).toHaveText("actual");
    await page.screenshot({ path: join(out, "textarea-reference-desktop-light.png") });
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    await expect(sourcePreview.locator("td").first()).toHaveText("[label][hidden]");
    await expect(sourcePreview.locator("td").nth(1)).toHaveText("actual");
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: HTML source proof is reused across bidirectional table edits", async () => {
    const source = "<div>\n\n| A | B |\n| --- | --- |\n| [linked][kept] | 2 |\n\n</div>\n\n[kept]: /kept";
    await startWorkspace(source);
    await openWorkspaceTable();
    const count = await page.evaluate(() => window.tableSourceProbeCount);
    assert.ok(count > 0, "the actual renderer must establish the HTML context");
    for (let edit = 0; edit < 3; edit++) {
      await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).click();
      await dialog.getByTestId("source-editor-table-cell-input").fill(`grid${edit}`);
      await markdown.fill((await markdown.inputValue()).replace(`grid${edit}`, `markdown${edit}`));
      await expect(dialog.locator("td").nth(1)).toHaveText(`markdown${edit}`);
      await expect(dialog.locator("td").first()).toHaveText("linked");
    }
    assert.equal(await page.evaluate(() => window.tableSourceProbeCount), count, "cell/Markdown edits must not reparse the frozen full source");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 2 |", "| markdown2 |"));
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: a stale HTML proof cannot survive refreshing to textarea content", async () => {
    const source = "<div>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n</div>";
    await startWorkspace(source);
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("unapplied");
    const changed = source.replace("<div>", "<textarea>").replace("</div>", "</textarea>");
    await page.evaluate(changed => window.workspaceGate.replace(changed), changed);
    await expect(apply()).toBeDisabled();
    await expect(markdown).toHaveValue(/unapplied/);
    await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await expect(apply()).toHaveCount(0);
    await expect(dialog.getByText("Select the complete table to try again, including code or HTML examples.")).toBeVisible();
    await expect(dialog.locator("table")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(changed);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: display-math and rich-layout offsets cannot displace a quoted table proof", async () => {
    const source = "🙂 lead\\[\n\\left[x\\right]\n\\]tail\n\n<box><text>intro</text></box>\n\n"
      + "> <div>\n>\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n> </div>";
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("table")).toHaveCount(1);
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("position kept");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| 1 | 2 |", "| position kept | 2 |"));
    await expect(sourcePreview.locator("td").first()).toHaveText("position kept");
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: oversized HTML context fails closed without truncation and permits explicit selection", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const source = "<!-- closed -->\n\n" + table + "\n\n" + "x".repeat(1_048_576);
    await startWorkspace(source);
    await openWorkspaceTable(false);
    await expect(dialog.getByText("HTML context exceeds the check limits. Select the complete table to try again.")).toBeVisible();
    await expect(apply()).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.tableSourceProbeCount), 0, "oversized context must not enter the full renderer");
    assert.equal(await page.evaluate(source => window.workspaceGate.source() === source, source), true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const from = source.indexOf("| A"), to = from + table.length;
    await page.evaluate(({ from, to }) => window.workspaceGate.select(from, to), { from, to });
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("selected");
    await apply().click();
    const expected = source.replace("| 1 | 2 |", "| selected | 2 |");
    assert.equal(await page.evaluate(expected => window.workspaceGate.source() === expected, expected), true);
    await workspace.getByTestId("source-editor-undo").click();
    assert.equal(await page.evaluate(source => window.workspaceGate.source() === source, source), true);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: nested table editing owns shortcuts instead of opening tools behind it", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("draft");
    await input.press("Control+Alt+c");
    await expect(input).toBeFocused();
    await expect(workspace.getByTestId("source-editor-command-panel")).toHaveCount(0);
  });
  await run("actual workspace: the command names the Table tool rather than promising empty-table insertion", async () => {
    for (const zh of [false, true]) {
      await startWorkspace(workspaceSource, zh);
      await workspace.getByTestId("source-editor-tools-toggle").click();
      await expect(workspace.locator("[data-source-toolbar-command='table']")).toHaveAccessibleName(zh ? "表格工具" : "Table tool");
    }
  });
  await run("actual workspace: table Enter cannot save; Escape preserves the underlying source preview", async () => {
    await startWorkspace();
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview).toBeVisible();
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("draft");
    await input.press("Enter");
    await page.evaluate(() => window.workspaceGate.requestSubmit());
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    await input.press("Escape");
    await expect(dialog).toBeVisible();
    await markdown.focus();
    await markdown.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(sourcePreview).toBeVisible();
    await expect(cm).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(workspaceSource);
  });
  await run("actual workspace: late CodeMirror changes invalidate rather than overwrite a table draft", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    await markdown.fill("| A | B |\n| --- | --- |\n| table draft | 2 |");
    await page.evaluate(() => window.workspaceGate.insert(window.workspaceGate.source().length, "\nlate source"));
    await expect(apply()).toBeDisabled();
    await expect(markdown).toHaveValue(/table draft/);
    await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await expect(apply()).toBeEnabled();
    await expect(markdown).not.toHaveValue(/table draft/);
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\nlate source",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: Apply changes only the draft and Save sends one canonical client payload", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    await markdown.fill("| Updated | B |\n| --- |\n| kept | 2 | extra |");
    await apply().click();
    const expected = "before\n\n| Updated | B |  |\n| --- | --- | --- |\n| kept | 2 | extra |\n\nafter";
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(expected);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    await workspace.getByTestId("source-editor-create-version").click();
    await expect.poll(() => page.evaluate(() => window.workspaceWrites.length)).toBe(1);
    const [write] = await page.evaluate(() => window.workspaceWrites);
    assert.equal(write.payload.contentMarkdown, expected);
    assert.equal(write.payload.saveMode, "create_version");
    assert.equal(write.payload.baseVersionId, "synthetic-version");
    await expect(workspace.getByTestId("source-editor-create-version")).toHaveText("Create v3");
    await expect(workspace.getByTestId("source-editor-create-version")).toBeDisabled();
    await page.screenshot({ path: join(out, "workspace-desktop-light.png") });
  });
  await run("actual workspace: 375px touch can open, edit and apply the nested table", async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const mobilePage = await context.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.startWorkspace));
      await mobilePage.evaluate(source => window.startWorkspace(source, true), workspaceSource);
      const mobileWorkspace = mobilePage.getByTestId("floating-source-workspace");
      await expect(mobileWorkspace.locator(".cm-content")).toBeVisible();
      await mobileWorkspace.getByTestId("source-editor-tools-toggle").tap();
      await mobileWorkspace.getByRole("button", { name: "表格工具", exact: true }).tap();
      const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
      await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
      await mobileDialog.getByRole("button", { name: "第 1 行第 1 列", exact: true }).tap();
      await mobileDialog.getByTestId("source-editor-table-cell-input").fill("触摸编辑");
      await mobilePage.screenshot({ path: join(out, "workspace-mobile-light.png") });
      await mobileDialog.getByRole("button", { name: "应用", exact: true }).tap();
      await expect(mobileDialog).toHaveCount(0);
      await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toContain("触摸编辑");
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await mobilePage.evaluate(() => window.workspaceWrites), []);
    } finally {
      await context.close();
    }
  });
  await run("actual workspace: cell syntax validation survives alternating grid and Markdown edits", async () => {
    await startWorkspace();
    await openWorkspaceTable();
      await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
      const input = dialog.getByTestId("source-editor-table-cell-input");
      await input.fill("[draft");
      await expect(apply()).toBeDisabled();
      await expect(input).toBeFocused();
      await expect(markdown).toHaveValue(/\[draft/);
      await expect(markdown).toHaveAttribute("aria-invalid", "true");
      await input.fill("[draft]");
    await expect(apply()).toBeEnabled();
    await markdown.fill("| Raw | B |\n| --- |\n| kept | value | extra |");
    await expect(apply()).toBeEnabled();
    await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("grid|value");
    await expect(markdown).toHaveValue("| Raw | B |  |\n| --- | --- | --- |\n| kept | grid\\|value | extra |");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| Raw | B |  |\n| --- | --- | --- |\n| kept | grid\\|value | extra |\n\nafter",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: rich Markdown stays rendered while its cell remains editable", async () => {
    const source = "before\n\n| A | B |\n| --- | --- |\n| plain | 2 |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    const rich = "| A | B |\n| --- | --- |\n| **rich** | 2 |";
    await markdown.fill(rich);
    await expect(dialog.locator("strong")).toHaveText("rich");
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await expect(input).toHaveValue("**rich**");
    await input.fill("**changed**");
    await expect(input).toBeFocused();
    await expect(markdown).toHaveValue(/\*\*changed\*\*/);
    await input.press("Escape");
    await expect(dialog.locator("strong")).toHaveText("changed");
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| A | B |\n| --- | --- |\n| **changed** | 2 |\n\nafter",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: plain cells can gain rich syntax without losing typing or Escape focus", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("");
    await input.pressSequentially("**new bold**");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("**new bold**");
    await expect(markdown).toHaveValue(/\| \*\*new bold\*\* \|/);
    await expect(apply()).toBeEnabled();
    await input.press("Escape");
    await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
    await expect(dialog.locator("strong")).toHaveText("new bold");
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await input.fill("www.example.test");
    await input.press("Escape");
    await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeFocused();
    await expect(dialog.locator("td").first().locator(".underline")).toHaveText("www.example.test");
    await expect(dialog.locator("a")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: repeated Unicode raw/grid edits retain latest values after CRLF paste", async () => {
    // The live CodeMirror document uses LF; direct dialog CRLF preservation is
    // exercised separately. Pasting CRLF into the textarea must not change it.
    const source = "before\n\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    for (const [row, column, value] of [[2, 1, "末行🙂"], [1, 2, "中"], [2, 2, "last"], [1, 1, "头🙂"]]) {
      await dialog.getByRole("button", { name: `Row ${row}, column ${column}`, exact: true }).click();
      await input.fill(value);
      await expect(input).toHaveValue(value);
      await input.press("Escape");
      await expect(apply()).toBeEnabled();
    }
    const raw = "| Header🙂 | B |\n| --- | --- |\n| 头🙂 | 中 |\n| 末行🙂 | last |";
    await markdown.fill(raw.replaceAll("\n", "\r\n"));
    await expect(apply()).toBeEnabled();
    await dialog.getByRole("button", { name: "Row 2, column 2", exact: true }).click();
    await input.fill("tail|done");
    // Native textarea values expose LF, matching this editor document.
    await expect(markdown).toHaveValue(raw.replace("last", "tail\\|done"));
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n" + raw.replace("last", "tail\\|done") + "\n\nafter",
    );
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: Unicode cell spacing survives grid, Markdown, Apply and one Undo", async () => {
    const source = "before\n\n| A | B |\n| --- | --- |\n| \u00a0kept\u00a0 | \u2003中\u2003 |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    const cell = dialog.getByRole("button", { name: "Row 1, column 1", exact: true });
    await cell.click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await expect(input).toHaveValue("\u00a0kept\u00a0");
    await input.fill("\u00a0edited\u00a0");
    await input.press("Escape");
    assert.equal(await cell.textContent(), "\u00a0edited\u00a0");
    const raw = "| A | B |\n| --- | --- |\n| \u00a0edited\u00a0 | \ufeffraw\ufeff |";
    await markdown.fill(raw);
    await expect(apply()).toBeEnabled();
    assert.equal(await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).textContent(), "\ufeffraw\ufeff");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe("before\n\n" + raw + "\n\nafter");
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: horizontal grid boundaries retain editing and Escape returns focus", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    const first = dialog.getByRole("button", { name: "Row 1, column 1", exact: true });
    const last = dialog.getByRole("button", { name: "Row 1, column 2", exact: true });
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await first.click();
    await input.press("Home");
    await input.press("ArrowLeft");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("1");
    await input.press("End");
    await input.press("ArrowRight");
    await expect(last).toBeFocused();
    await last.press("Enter");
    await input.press("End");
    await input.press("ArrowRight");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("2");
    await input.press("Escape");
    await expect(last).toBeFocused();
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: real delimiter-valued headers and rows open, apply and undo without loss", async () => {
    const tables = [
      "| --- | --- |\n| --- | --- |\n| one | two |",
      "| A | B |\n| :--- | ---: |\n| --- | --- |\n| :---: | ---: |",
      "| --- |\n| --- |\n| --- |",
    ];
    for (const [index, table] of tables.entries()) {
      const source = "before\n\n" + table + "\n\nafter";
      await startWorkspace(source);
      await workspace.getByTestId("source-editor-preview-toggle").click();
      await expect(workspace.getByTestId("source-editor-rich-preview").locator("table")).toHaveCount(1);
      await openWorkspaceTable(false);
      if (index === 0) await page.screenshot({ path: join(out, "delimiter-content-desktop-light.png") });
      await expect(markdown).toBeVisible();
      await expect(apply()).toBeEnabled();
      await expect(markdown).toHaveValue(table);
      const input = dialog.getByTestId("source-editor-table-cell-input");
      await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
      await input.fill("edited");
      await apply().click();
      // Header and body can have equal source text; use the exact raw draft
      // rather than String.replace to determine the selected data row.
      const rows = table.split("\n");
      rows[2] = rows[2].replace(/^(\| )[^|]*/, "$1edited ");
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe("before\n\n" + rows.join("\n") + "\n\nafter");
      await workspace.getByTestId("source-editor-undo").click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    }
  });
  await run("actual workspace: grid and raw delimiter-valued edits survive edge additions and final Apply", async () => {
    const source = "before\n\n| A | B |\n| --- | --- |\n| one | two |\n\nafter";
    await startWorkspace(source);
    await openWorkspaceTable();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    for (const [label, value] of [["Column 1 header", "---"], ["Column 2 header", "---"], ["Row 1, column 1", "---"], ["Row 1, column 2", "---"]]) {
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await input.fill(value);
      await input.press("Escape");
      await expect(apply()).toBeEnabled();
    }
    await dialog.getByTestId("source-editor-table-add-row-after").click();
    await expect(markdown).toHaveValue("| --- | --- |\n| --- | --- |\n| --- | --- |\n|  |  |");
    await markdown.fill("| :---: | ---: |\n| --- | --- |\n| --- | --- |\n| tail | kept |");
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| :---: | ---: |\n| --- | --- |\n| --- | --- |\n| tail | kept |\n\nafter",
    );
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: delimiter-valued rows never absorb surrounding pipe prose", async () => {
    const source = "Intro | prose\n| A | B |\n| --- | --- |\n| --- | --- |\nAfter | prose";
    await startWorkspace(source);
    const cursor = source.indexOf("| A") + 2;
    await page.evaluate(cursor => window.workspaceGate.select(cursor, cursor), cursor);
    await openWorkspaceTable();
    await expect(markdown).toHaveValue("| A | B |\n| --- | --- |\n| --- | --- |");
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("kept");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "Intro | prose\n| A | B |\n| --- | --- |\n| kept | --- |\nAfter | prose",
    );
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: 375px touch can edit delimiter-valued rows and Undo once", async () => {
    const source = "before\n\n| A | B |\n| --- | --- |\n| --- | --- |\n\nafter";
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const mobilePage = await context.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.startWorkspace));
      await mobilePage.evaluate(source => window.startWorkspace(source, true), source);
      const mobileWorkspace = mobilePage.getByTestId("floating-source-workspace");
      await expect(mobileWorkspace.locator(".cm-content")).toBeVisible();
      await mobileWorkspace.getByTestId("source-editor-tools-toggle").tap();
      await mobileWorkspace.getByRole("button", { name: "表格工具", exact: true }).tap();
      const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
      await expect(mobileDialog.getByRole("button", { name: "应用", exact: true })).toBeEnabled();
      await mobileDialog.getByRole("button", { name: "第 1 行第 2 列", exact: true }).tap();
      await mobileDialog.getByTestId("source-editor-table-cell-input").fill("已核对🙂");
      await mobilePage.screenshot({ path: join(out, "delimiter-content-mobile-zh.png") });
      await mobileDialog.getByRole("button", { name: "应用", exact: true }).tap();
      await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| --- | --- |\n\n", "| --- | 已核对🙂 |\n\n"));
      await mobileWorkspace.getByTestId("source-editor-undo").tap();
      await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await mobilePage.evaluate(() => window.workspaceWrites), []);
    } finally {
      await context.close();
    }
  });
  await run("actual workspace: oversized cell input is rejected without truncating the accepted draft", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    const before = await markdown.inputValue();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    for (const value of ["x".repeat(1_048_576), "![".repeat(600_000) + "|tail"]) {
      await input.fill(value);
      await expect(input).toHaveValue("1");
      await expect(markdown).toHaveValue(before);
      await expect(dialog.getByRole("alert")).toContainText("size limit");
    }
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: large unclosed image nesting stays editable and recovers without changing source", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    const malformed = "| A | B |\n| --- | --- |\n| " + "![".repeat(120_000) + " | 2 |";
    await markdown.fill(malformed);
    assert.equal(await markdown.evaluate((node, expected) => node.value === expected, malformed), true);
    await expect(markdown).toHaveAttribute("aria-invalid", "true");
    await expect(apply()).toBeDisabled();
    await expect(dialog.locator("[data-table-cell]:enabled")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.workspaceGate.source()), workspaceSource);
    await markdown.fill("| A | B |\n| --- | --- |\n| repaired | 2 |");
    await expect(dialog.locator("td").first()).toHaveText("repaired");
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| A | B |\n| --- | --- |\n| repaired | 2 |\n\nafter",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
    await run("actual workspace: long cells use a bounded display preview without changing Markdown or Apply", async () => {
      const longValue = "x".repeat(40_000);
      const source = `| A | B |\n| --- | --- |\n| ${longValue} | kept |`;
    await startWorkspace(source);
    await openWorkspaceTable();
      await expect(dialog.getByTestId("source-editor-table-large-cell-notice")).toHaveText(
        "1 cell is long on this page, so the preview is simplified; Markdown and Apply remain unchanged.",
      );
      await expect(dialog.locator("tbody td").first()).toContainText("…");
      await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true }))
        .toHaveAttribute("title", "Long content; full value remains in the Markdown editor below");
      await expect(markdown).toHaveValue(source);
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await expect.poll(async () => (await input.inputValue()).length).toBe(longValue.length);
    await input.fill("short");
    await expect(dialog.getByTestId("source-editor-table-large-cell-notice")).toHaveCount(0);
    await expect(dialog.locator("tbody td").first()).toContainText("short");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace(longValue, "short"));
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: math bars remain one cell and absolute values do not become norms", async () => {
    const source = "before\n\n" + String.raw`| k | \(|p_k-p_{k-1}|\) |
| --- |
| 1 | \(10^{-1}\) |` + "\n\nafter";
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    await openWorkspaceTable();
    await expect(dialog.locator("th")).toHaveCount(2);
    await expect(dialog.locator("td")).toHaveCount(2);
    await expect(dialog.locator(".katex")).toHaveCount(2);
    await expect(dialog.locator("th").nth(1).locator("math")).toContainText("∣");
    await expect(dialog.locator("th").nth(1).locator("math")).not.toContainText("∥");
    await expect(markdown).toHaveValue(/\\vert p_k-p_\{k-1\}\\vert /);
    await page.screenshot({ path: join(out, "math-desktop-light.png") });
    await dialog.getByRole("button", { name: "Column 2 header", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await expect(input).toHaveValue(String.raw`\(|p_k-p_{k-1}|\)`);
    await input.fill(String.raw`\(\|p_k-p_{k-1}\|\)`);
    await expect(markdown).toHaveValue(/\\\(\\\|p_k-p_\{k-1\}\\\|\\\)/);
    await expect(dialog.locator("th").nth(1).locator("math")).toContainText("∥");
    await apply().click();
    const expected = "before\n\n" + String.raw`| k | \(\|p_k-p_{k-1}\|\) |
| --- | --- |
| 1 | \(10^{-1}\) |` + "\n\nafter";
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(expected);
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("th")).toHaveCount(2);
    await expect(sourcePreview.locator("th").nth(1).locator("math")).toContainText("∥");
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: code backslashes and separate currency columns survive normalization", async () => {
    const source = "| A | B | Note |\n| --- | --- | --- |\n| USD $20 | USD $30 | kept |\n| `x"
      + "\\".repeat(2) + String.raw`|y` + "` | " + String.raw`\(\|x\|\)` + " | kept |";
    await startWorkspace(source);
    await openWorkspaceTable();
    await expect(dialog.locator("th")).toHaveCount(3);
    await expect(dialog.locator("td")).toHaveCount(6);
    await expect(dialog.locator("code").filter({ hasText: "x" }).first()).toHaveText("x" + "\\".repeat(2) + "|y");
    await expect(dialog.locator("tbody tr").first()).toContainText("USD $20");
    await expect(dialog.locator("tbody tr").first()).toContainText("USD $30");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      source.replace("\\".repeat(2) + "|y", "\\".repeat(3) + "|y"),
      );
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    });
  await run("actual workspace: applying an untouched long cell preserves the exact original source", async () => {
    const longValue = "x".repeat(40_000);
    const source = `| A | B |\n| --- | --- |\n| ${longValue} | kept |`;
    await startWorkspace(source);
    await openWorkspaceTable();
    await expect(dialog.getByTestId("source-editor-table-large-cell-notice")).toContainText("1 cell");
    await expect(markdown).toHaveValue(source);
    await expect(dialog.locator("tbody td").first()).toContainText("…");
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: oversized math is omitted from rich parsing but remains exact in Markdown", async () => {
    const formula = String.raw`\(${ "x".repeat(40_000) }\)`;
    const source = `| A | B |\n| --- | --- |\n| ${formula} | kept |`;
    await startWorkspace(source);
    await openWorkspaceTable();
    await expect(dialog.getByTestId("source-editor-table-large-cell-notice")).toContainText("1 cell");
    await expect(dialog.locator("tbody td").first()).toContainText("…");
    await expect(dialog.locator("tbody td").first().locator(".katex")).toHaveCount(0);
    await expect(markdown).toHaveValue(source);
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
  });
  await run("actual workspace: ambiguous TeX remains editable but cannot apply until repaired", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    for (const formula of [String.raw`\(\text{a|b}\)`, "\\(\\char`|\\)", String.raw`\(\colorbox{red}{|}\)`]) {
      const unsupported = "| A | B |\n| --- | --- |\n| " + formula + " | kept |";
      await markdown.fill(unsupported);
      await expect(apply()).toBeDisabled();
      await expect(markdown).toHaveValue(unsupported);
      await expect(dialog.getByRole("button", { name: "Row 1, column 1", exact: true })).toBeDisabled();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(workspaceSource);
    }
    await markdown.fill("| A | B |\n| --- | --- |\n| " + String.raw`\(|x|\)` + " | kept |");
    await expect(apply()).toBeEnabled();
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill(String.raw`\(\text{a|b}\)`);
    await expect(apply()).toBeDisabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(String.raw`\(\text{a|b}\)`);
    await input.fill(String.raw`\(|y|\)`);
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      "before\n\n| A | B |\n| --- | --- |\n| " + String.raw`\(\vert y\vert \)` + " | kept |\n\nafter",
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: image alt and reference IDs stay literal without remote requests", async () => {
    const reference = String.raw`\(\|x\|\)`;
    const source = "| A | B |\n| --- | --- |\n| " + String.raw`![\(|x|\)](https://example.invalid/image.png)`
      + " | kept |\n| [label][" + reference + "] | kept |\n| " + String.raw`[a\|b][]` + " | kept |\n| "
      + String.raw`![img\|id]` + " | kept |\n| " + String.raw`![img\|id][]` + " | kept |\n\n["
      + reference + "]: https://example.invalid/target\n" + String.raw`[a\|b]: https://example.invalid/collapsed "Original title"`
      + "\n" + String.raw`[img\|id]: https://example.invalid/image.png`;
    const remoteRequests = [];
    const onRequest = request => { if (request.url().startsWith("https://example.invalid/")) remoteRequests.push(request.url()); };
    page.on("request", onRequest);
    await page.route("https://example.invalid/**", route => route.abort());
    try {
      await startWorkspace(source);
      await workspace.getByTestId("source-editor-preview-toggle").click();
      await openWorkspaceTable();
      await expect(dialog.locator("th")).toHaveCount(2);
      await expect(dialog.locator("td")).toHaveCount(10);
      await expect(dialog.locator("tbody tr").first()).toContainText("(|x|)");
      await expect(dialog.locator("tbody tr").nth(1).locator("td").first()).toHaveText("label");
      await expect(dialog.locator("tbody tr").nth(2).locator("td").first()).toHaveText("a|b");
      await expect(dialog.locator("tbody tr").nth(3).locator("td").first()).toHaveText("img|id");
      await expect(dialog.locator("tbody tr").nth(4).locator("td").first()).toHaveText("img|id");
      await expect(dialog.locator(".katex,img")).toHaveCount(0);
      assert.ok(!(await markdown.inputValue()).includes("]: https://example.invalid/target"));
      await expect(dialog.getByTestId("source-editor-table-reference-notice")).toHaveCount(0);
      await apply().click();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
        source.replace(String.raw`![\(|x|\)]`, String.raw`![\(\|x\|\)]`),
      );
      const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
      await expect(sourcePreview.getByRole("link", { name: "label", exact: true })).toHaveAttribute("href", "https://example.invalid/target");
      await expect(sourcePreview.getByRole("link", { name: "a|b", exact: true })).toHaveAttribute("href", "https://example.invalid/collapsed");
      await expect(sourcePreview.locator(".katex,img")).toHaveCount(0);
      assert.deepEqual(remoteRequests, []);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    } finally {
      page.off("request", onRequest);
      await page.unroute("https://example.invalid/**");
    }
  });
  await run("actual workspace: bounded reference context warns without changing definitions outside the table", async () => {
    const table = "| A | B |\n| --- | --- |\n| [label][ref0] | kept |";
    const definitions = Array.from({ length: 257 }, (_, index) => `[ref${index}]: /target${index} "Original title ${index}"`).join("\n");
    const source = table + "\n\n" + definitions;
    await startWorkspace(source);
    await openWorkspaceTable();
    await expect(dialog.locator("tbody td").first()).toHaveText("label");
    await expect(dialog.getByTestId("source-editor-table-reference-notice")).toHaveText(
      "Reference previews may be incomplete. Check the source preview; original definitions stay unchanged.",
    );
    await expect(markdown).toHaveValue(table);
    await page.screenshot({ path: join(out, "reference-context-desktop-light.png") });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(apply()).toBeInViewport();
    const noticeBox = await dialog.getByTestId("source-editor-table-reference-notice").boundingBox();
    assert.ok(noticeBox && noticeBox.x >= 0 && noticeBox.x + noticeBox.width <= 375);
    await page.screenshot({ path: join(out, "reference-context-mobile-light.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole("button", { name: "Row 1, column 2", exact: true }).click();
    await dialog.getByTestId("source-editor-table-cell-input").fill("edited");
    await expect(markdown).toHaveValue(table.replace("kept", "edited"));
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      table.replace("kept", "edited") + "\n\n" + definitions,
    );
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("unavailable tables show recovery without a fake editor or dead Apply action", async () => {
    const observations = [];
    for (const [source, zh, width] of [
      ["ordinary source without a table", false, 1440],
      ["<textarea>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n</textarea>", true, 375],
    ]) {
      await startWorkspace(source, zh);
      // startWorkspace deliberately resets desktop geometry for other cases.
      // Set this case's viewport afterwards, then verify the actual surface.
      await page.setViewportSize({ width, height: 812 });
      assert.equal(await page.evaluate(() => innerWidth), width);
      await openWorkspaceTable(false);
      await expect(dialog.getByText(zh
        ? "请完整选中表格后重试；代码或 HTML 示例也需明确选中。"
        : "Select the complete table to try again, including code or HTML examples.")).toBeVisible();
      await expect(markdown).toHaveCount(0);
      await expect(dialog.locator("table,input,textarea")).toHaveCount(0);
      await expect(apply()).toHaveCount(0);
      await expect(dialog).toHaveAttribute("aria-describedby", "source-editor-table-unavailable");
      const recovery = dialog.getByRole("button", { name: zh ? "返回源码" : "Back to source", exact: true });
      await expect(recovery).toBeInViewport();
      const size = await dialog.locator("section").boundingBox();
      assert.ok(size.height < 300, "the unavailable state must not retain an empty editor-sized area");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await recovery.focus();
      await recovery.press("Tab");
      assert.equal(await dialog.evaluate(root => root.contains(document.activeElement)), true, "compact-state Tab stays in the modal");
      await page.screenshot({ path: join(out, zh ? "unavailable-mobile-zh.png" : "unavailable-desktop-en.png") });
      await recovery.click();
      await expect(dialog).toHaveCount(0);
      await expect(cm).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
      assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
      observations.push({ locale: zh ? "zh-CN" : "en-US", actual_viewport_width: await page.evaluate(() => innerWidth),
        dialog_width: size.width, dialog_height: size.height, source_unchanged: true, writes: 0, focus_returned: true });
    }
    writeFileSync(emptyStateObservationPath, JSON.stringify({ date, startedAt, status: "passed", observations }, null, 2));
  });
  await run("actual workspace: composing Escape preserves the cell draft and enclosing table", async () => {
    await startWorkspace();
    await openWorkspaceTable();
    const cell = dialog.getByRole("button", { name: "Row 1, column 1", exact: true });
    await cell.click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("未应用的中文草稿");
    await input.dispatchEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
    await page.screenshot({ path: join(out, "composing-escape-state.png") });
    writeFileSync(join(out, "composition-observations.json"), JSON.stringify({
      method: "Chrome DOM-dispatched isComposing key, not a physical IME candidate session",
      dialog_count: await dialog.count(), input_count: await input.count(),
      writes: await page.evaluate(() => window.workspaceWrites.length),
    }, null, 2));
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("未应用的中文草稿");
    await expect(markdown).toHaveValue(/未应用的中文草稿/);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: native Chrome composing Escape keeps cell and Markdown input ownership", async () => {
    const observations = [];
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const field of ["cell", "markdown"]) {
        await startWorkspace();
        await openWorkspaceTable();
        let input = markdown;
        if (field === "cell") {
          await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
          input = dialog.getByTestId("source-editor-table-cell-input");
          await input.fill("保留");
        } else {
          await markdown.focus();
          await markdown.evaluate(node => {
            const offset = node.value.lastIndexOf("1") + 1;
            node.setSelectionRange(offset, offset);
          });
        }
        await page.evaluate(() => {
          window.tableImeEvents = [];
          window.tableImeListener = event => window.tableImeEvents.push({
            type: event.type, key: event.key, keyCode: event.keyCode,
            isComposing: event.isComposing, isTrusted: event.isTrusted,
            target: event.target.tagName,
          });
          for (const type of ["keydown", "compositionstart", "compositionupdate", "compositionend"])
            document.addEventListener(type, window.tableImeListener, true);
        });
        try {
          await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 0, selectionEnd: 2 });
          await expect(input).toHaveValue(/中文/);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeVisible();
          await expect(input).toBeFocused();
          await expect(input).toHaveValue(/中文/);
          const trace = await page.evaluate(() => window.tableImeEvents);
          assert.ok(trace.some(event => event.type === "keydown" && event.key === "Escape"
            && event.isTrusted && event.isComposing), "a trusted composing Escape must actually occur");
          assert.equal(await page.evaluate(() => window.workspaceGate.source()), workspaceSource);
          assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
          observations.push({ field, dialog_count: await dialog.count(), focused: true, writes: 0, trace });
          await page.screenshot({ path: join(out, `native-composing-escape-${field}.png`) });
          // End this CDP composition before checking ordinary Escape semantics.
          // No physical Windows/mobile candidate window is involved in this gate.
          await cdp.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
          await input.press("Escape");
          if (field === "cell") {
            await expect(dialog).toBeVisible();
            await expect(dialog.getByTestId("source-editor-table-cell-input")).toHaveCount(0);
            await page.keyboard.press("Escape");
          }
          await expect(dialog).toHaveCount(0);
        } finally {
          await page.evaluate(() => {
            for (const type of ["keydown", "compositionstart", "compositionupdate", "compositionend"])
              document.removeEventListener(type, window.tableImeListener, true);
            delete window.tableImeListener;
            delete window.tableImeEvents;
          });
        }
      }
    } finally {
      writeFileSync(join(out, "native-composition-observations.json"), JSON.stringify({
        method: "Chrome CDP composition with trusted Escape; no physical IME candidate window",
        observations,
      }, null, 2));
      await cdp.detach();
    }
  });
  await run("actual workspace: literal HTML table examples remain editable without enabling raw HTML", async () => {
    const table = '| Example | Value |\n| --- | --- |\n| `<td colspan="2">` | kept |';
    const source = `before\n\n${table}\n\nafter`;
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("table")).toHaveCount(1);
    await expect(sourcePreview.locator("code")).toHaveText('<td colspan="2">');
    await openWorkspaceTable(false);
    writeFileSync(join(out, "html-cell-observations.json"), JSON.stringify({
      source_preview_tables: await sourcePreview.locator("table").count(),
      tool_tables: await dialog.locator("table").count(),
      source_unchanged: await page.evaluate(() => window.workspaceGate.source()) === source,
      writes: await page.evaluate(() => window.workspaceWrites.length),
    }, null, 2));
    await page.screenshot({ path: join(out, "literal-html-cell.png") });
    await expect(dialog.locator("table")).toHaveCount(1);
    await expect(dialog.locator("code")).toHaveText('<td colspan="2">');
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill('`<th rowspan="2">`');
    await expect(apply()).toBeEnabled();
    await expect(markdown).toHaveValue(table.replace('`<td colspan="2">`', '`<th rowspan="2">`'));
    await input.fill('<th rowspan="2">');
    await expect(apply()).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText("HTML table structures are not supported");
    await expect(markdown).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    assert.equal(await page.evaluate(() => window.workspaceGate.source()), source);
    await input.fill('colspan="2" is literal text');
    await expect(apply()).toBeEnabled();
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(
      source.replace('`<td colspan="2">`', 'colspan="2" is literal text'),
    );
    await expect(sourcePreview.locator("table")).toHaveCount(1);
    await expect(sourcePreview.locator("td").first()).toHaveText('colspan="2" is literal text');
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
  });
  await run("actual workspace: literal unpaired backticks retain live table editing, Apply and Undo", async () => {
    const cell = "`left ` inner \\| right`";
    const table = `| A | B |\n| --- | --- |\n| ${cell} | tail |`;
    const source = `before\n\n${table}\n\nafter`;
    await startWorkspace(source);
    await workspace.getByTestId("source-editor-preview-toggle").click();
    const sourcePreview = workspace.getByTestId("source-editor-rich-preview");
    await expect(sourcePreview.locator("table")).toHaveCount(1);
    await expect(sourcePreview.locator("td")).toHaveCount(2);
    await openWorkspaceTable(false);
    await expect(dialog.locator("table")).toHaveCount(1);
    await expect(dialog.locator("td")).toHaveCount(2);
    await expect(markdown).toHaveValue(table);
    await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
    const input = dialog.getByTestId("source-editor-table-cell-input");
    await input.fill("`unfinished");
    await expect(apply()).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(markdown).toHaveValue(table.replace(cell, "`unfinished"));
    await input.fill("`literal | edited");
    await expect(apply()).toBeEnabled();
    await expect(markdown).toHaveValue(table.replace(cell, "`literal \\| edited"));
    assert.equal(await page.evaluate(() => window.workspaceGate.source()), source);
    await input.press("Escape");
    await expect(dialog).toBeVisible();
    const rawCell = "\\`left \\| typed``";
    const rawTable = table.replace(cell, rawCell);
    await markdown.fill(rawTable);
    await expect(apply()).toBeEnabled();
    await expect(dialog.locator("td")).toHaveCount(2);
    await page.screenshot({ path: join(out, "literal-backtick-cell.png") });
    await apply().click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source.replace(table, rawTable));
    await expect(sourcePreview.locator("td").first()).toHaveText("`left | typed``");
    await workspace.getByTestId("source-editor-undo").click();
    await expect.poll(() => page.evaluate(() => window.workspaceGate.source())).toBe(source);
    assert.deepEqual(await page.evaluate(() => window.workspaceWrites), []);
    writeFileSync(join(out, "literal-backtick-observations.json"), JSON.stringify({
      rendered_columns: 2, grid_editable_with_unpaired_tick: true,
      grid_pipe_serialized: true, raw_edit_retains_columns: true,
      source_unchanged_until_apply: true, one_undo_restores_source: true, writes: 0,
    }, null, 2));
  });
  await run("actual workspace: 375px touch can correct unsupported HTML cell markup without losing its draft", async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const mobilePage = await context.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.startWorkspace));
      const source = '| Example | Value |\n| --- | --- |\n| `<td>` | kept |';
      await mobilePage.evaluate(source => window.startWorkspace(source, true), source);
      const mobileWorkspace = mobilePage.getByTestId("floating-source-workspace");
      await mobileWorkspace.getByTestId("source-editor-tools-toggle").tap();
      await mobileWorkspace.getByRole("button", { name: "表格工具", exact: true }).tap();
      const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
      const mobileApply = mobileDialog.getByRole("button", { name: "应用", exact: true });
      await expect(mobileApply).toBeEnabled();
      await mobileDialog.getByRole("button", { name: "第 1 行第 1 列", exact: true }).tap();
      const input = mobileDialog.getByTestId("source-editor-table-cell-input");
      await input.fill("`literal");
      await expect(mobileApply).toBeEnabled();
      await expect(input).toBeFocused();
      await expect(mobileDialog.getByTestId("source-editor-table-markdown")).toHaveValue(source.replace("`<td>`", "`literal"));
      await mobilePage.screenshot({ path: join(out, "literal-backtick-cell-mobile-zh.png") });
      await input.fill('<td colspan="2">');
      await expect(input).toHaveValue('<td colspan="2">');
      await expect(mobileApply).toBeDisabled();
      const error = mobileDialog.getByRole("alert");
      await expect(error).toHaveText("请检查单元格标记；不支持 HTML 表格结构。");
      await error.scrollIntoViewIfNeeded();
      await expect(error).toBeInViewport();
      const rect = await error.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 375);
      assert.equal(await mobilePage.evaluate(() => innerWidth), 375);
      assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mobilePage.screenshot({ path: join(out, "unsupported-html-cell-mobile-zh.png") });
      assert.equal(await mobilePage.evaluate(() => window.workspaceGate.source()), source);
      assert.deepEqual(await mobilePage.evaluate(() => window.workspaceWrites), []);
      await input.fill('`<td colspan="2">`');
      await expect(mobileApply).toBeEnabled();
      await expect(error).toHaveCount(0);
      await mobileApply.tap();
      await expect(mobileDialog).toHaveCount(0);
      await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toBe(
        source.replace("`<td>`", '`<td colspan="2">`'),
      );
      assert.deepEqual(await mobilePage.evaluate(() => window.workspaceWrites), []);
      writeFileSync(join(out, "html-cell-mobile-observations.json"), JSON.stringify({
        locale: "zh-CN", actual_viewport_width: 375, error_width: rect.width,
        accepted_literal_after_correction: true, source_unchanged_before_apply: true, writes: 0,
      }, null, 2));
    } finally {
      await context.close();
    }
  });
  await run("actual workspace: 320px and 375px touch row boundaries preserve tail editing and one Undo", async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const mobilePage = await context.newPage();
      mobilePage.on("pageerror", error => errors.push(error.message));
      mobilePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await mobilePage.goto(`http://127.0.0.1:${server.address().port}`);
      await mobilePage.waitForFunction(() => Boolean(window.startWorkspace));
      const source = [
        "| " + Array.from({ length: 10 }, (_, index) => `H${index + 1}`).join(" | ") + " |",
        "| " + Array(10).fill("---").join(" | ") + " |",
        ...Array.from({ length: 4_000 }, (_, row) =>
          "| " + Array.from({ length: 10 }, (_, column) => `R${row + 1}C${column + 1}`).join(" | ") + " |"),
      ].join("\n");
      const observations = [];
      for (const width of [320, 375]) {
        await mobilePage.setViewportSize({ width, height: 812 });
        await mobilePage.evaluate(source => window.startWorkspace(source, true), source);
        const mobileWorkspace = mobilePage.getByTestId("floating-source-workspace");
        await mobileWorkspace.getByTestId("source-editor-tools-toggle").tap();
        await mobileWorkspace.getByRole("button", { name: "表格工具", exact: true }).tap();
        const mobileDialog = mobilePage.getByTestId("source-editor-table-tool");
        const mobileApply = mobileDialog.getByRole("button", { name: "应用", exact: true });
        await expect(mobileApply).toBeEnabled();
        const first = mobileDialog.getByRole("button", { name: "首批表格行", exact: true });
        const last = mobileDialog.getByRole("button", { name: "末批表格行", exact: true });
        await expect(last).toBeInViewport();
        await last.tap();
        await expect(mobileDialog.getByText("3994–4000 / 4000", { exact: true })).toBeVisible();
        await expect(mobileApply).toBeEnabled();
        const bounds = await mobileDialog.getByRole("group", { name: "表格行分页", exact: true }).evaluate(element =>
          [...element.querySelectorAll("button")].map(button => {
            const r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
              label: button.getAttribute("aria-label"), left: r.left, right: r.right,
              top: r.top, bottom: r.bottom, width: r.width, height: r.height,
              hit: hit === button || button.contains(hit),
            };
          }));
        for (const button of bounds) {
          assert.ok(button.width >= 44 && button.height >= 44);
          assert.ok(button.left >= 0 && button.right <= width && button.top >= 0 && button.bottom <= 812);
          assert.equal(button.hit, true);
        }
        assert.equal(await mobilePage.evaluate(() => innerWidth), width);
        assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await mobilePage.screenshot({ path: join(out, `page-navigation-last-mobile-${width}-zh.png`) });
        await first.tap();
        await expect(mobileDialog.getByText("1–11 / 4000", { exact: true })).toBeVisible();
        await last.tap();
        await mobileDialog.getByRole("button", { name: "第 4000 行第 1 列", exact: true }).tap();
        await mobileDialog.getByTestId("source-editor-table-cell-input").fill("末行🙂");
        await expect(mobileApply).toBeEnabled();
        assert.equal(await mobilePage.evaluate(() => window.workspaceGate.source()), source);
        await mobileApply.tap();
        await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toBe(source.replace("| R4000C1 |", "| 末行🙂 |"));
        await mobileWorkspace.getByTestId("source-editor-undo").tap();
        await expect.poll(() => mobilePage.evaluate(() => window.workspaceGate.source())).toBe(source);
        assert.deepEqual(await mobilePage.evaluate(() => window.workspaceWrites), []);
        observations.push({ viewport: width, controls: bounds, appliedTailOnly: true, oneUndo: true, writes: 0 });
      }
      writeFileSync(join(out, "page-navigation-mobile.json"), JSON.stringify(observations, null, 2));
    } finally { await context.close(); }
  });
  // Opt-in observations, not a hardware-dependent pass threshold. Measure real
  // cell input through the following painted Markdown update, not a TS microbench.
  if (profileEnabled) {
    const cdp = await page.context().newCDPSession(page);
    const observations = [];
    const cpuHotspots = [];
    const markProfilePhase = phase => page.evaluate(phase => {
      window.tablePerformance.phaseMarks.push({ name: phase, at: performance.now() });
    }, phase);
    const watchCellInput = tail => page.evaluate(tail => {
      const paintedKey = tail ? "tailPaintedInputMs" : "paintedInputMs";
      const settledKey = tail ? "tailSettledPreviewMs" : "settledPreviewMs";
      window.tablePerformance[paintedKey] = [];
      window.tablePerformance[settledKey] = [];
      document.querySelector("[data-testid='source-editor-table-cell-input']").addEventListener("input", event => {
        const start = performance.now();
        const expected = event.target.value;
        const painted = () => {
          if (!document.querySelector("[data-testid='source-editor-table-markdown']").value.includes(expected)) {
            requestAnimationFrame(painted);
            return;
          }
          requestAnimationFrame(() => window.tablePerformance[paintedKey].push(performance.now() - start));
        };
        requestAnimationFrame(painted);
        const previewSettled = () => {
          const preview = document.querySelector("[data-testid='source-editor-table-preview']");
          if (preview?.getAttribute("aria-busy") !== "false") {
            requestAnimationFrame(previewSettled);
            return;
          }
          requestAnimationFrame(() => window.tablePerformance[settledKey].push(performance.now() - start));
        };
        requestAnimationFrame(previewSettled);
      });
    }, tail);
    for (const [name, columns, rows, longCellLength = 0] of [
      ["small", 6, 20], ["typical", 12, 80],
      ["large-narrow", 10, 4_000], ["cell-limit-wide", 200, 248],
      ["single-long-cell", 6, 20, 40_000],
    ]) {
      const source = [
        "| " + Array.from({ length: columns }, (_, index) => `H${index}`).join(" | ") + " |",
        "| " + Array(columns).fill("---").join(" | ") + " |",
        ...Array.from({ length: rows }, (_, row) =>
          "| " + Array.from({ length: columns }, (_, column) =>
            longCellLength && row === 0 && column === 0 ? "x".repeat(longCellLength) : `r${row}c${column}`).join(" | ") + " |"),
      ].join("\n");
      await startWorkspace(source);
      const openStart = performance.now();
      await openWorkspaceTable();
      const openMs = performance.now() - openStart;
      await dialog.getByRole("button", { name: "Row 1, column 1", exact: true }).click();
      const input = dialog.getByTestId("source-editor-table-cell-input");
      await input.press("End");
      await cdp.send("HeapProfiler.collectGarbage");
      const before = await cdp.send("Runtime.getHeapUsage");
      const parserEntriesBeforeGrid = await page.evaluate(() => window.tableMarkdownParseCount ?? 0);
      await page.evaluate(() => {
        window.tablePerformanceObserver?.disconnect();
        window.tablePerformance = {
          paintedInputMs: [], settledPreviewMs: [], longTasksMs: [],
          longTasksByPhaseMs: { grid: [], source: [], tail: [], navigation: [], gc: [], unclassified: [] },
          phaseMarks: [{ name: "grid", at: performance.now() }],
        };
        const record = entries => {
          for (const entry of entries) {
            const data = window.tablePerformance;
            const phase = data.phaseMarks.findLast(mark => mark.at <= entry.startTime)?.name ?? "unclassified";
            data.longTasksMs.push(entry.duration);
            data.longTasksByPhaseMs[phase].push(entry.duration);
          }
        };
        window.tablePerformanceObserver = new PerformanceObserver(list => record(list.getEntries()));
        window.flushTablePerformance = () => record(window.tablePerformanceObserver.takeRecords());
        window.tablePerformanceObserver.observe({ type: "longtask" });
      });
      await watchCellInput(false);
      const captureCpu = process.env.TABLE_TOOL_CPU_PROFILE === "1" && name === "cell-limit-wide";
      if (captureCpu) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
      }
      for (let key = 0; key < 5; key++) {
        await input.press("x");
        await expect.poll(() => page.evaluate(() => window.tablePerformance.paintedInputMs.length)).toBe(key + 1);
        await expect.poll(() => page.evaluate(() => window.tablePerformance.settledPreviewMs.length)).toBe(key + 1);
        await expect(input).toBeFocused();
      }
      const richMarkdownParsesForGridInputs = (await page.evaluate(() => window.tableMarkdownParseCount ?? 0)) - parserEntriesBeforeGrid;
      if (captureCpu) {
        const { profile } = await cdp.send("Profiler.stop");
        const nodeById = new Map(profile.nodes.map(node => [node.id, node]));
        const sampleCounts = new Map();
        for (const nodeId of profile.samples ?? []) sampleCounts.set(nodeId, (sampleCounts.get(nodeId) ?? 0) + 1);
        cpuHotspots.push(...[...sampleCounts.entries()]
          .map(([nodeId, samples]) => ({ ...(nodeById.get(nodeId)?.callFrame ?? {}), samples }))
          .sort((left, right) => right.samples - left.samples)
          .slice(0, 20));
        await cdp.send("Profiler.disable");
      }
      let sourceMarkdownInputMs = [];
      let sourceTextareaValueMs = [];
      if (name === "large-narrow" || name === "cell-limit-wide") {
        await markProfilePhase("source");
        const markdownInput = dialog.getByTestId("source-editor-table-markdown");
        await markdownInput.evaluate(element => {
          element.focus();
          element.setSelectionRange(4, 4);
        });
        await page.evaluate(() => {
          window.sourceMarkdownPerformance = { paintedInputMs: [], textareaValueMs: [] };
          document.querySelector("[data-testid='source-editor-table-markdown']").addEventListener("input", event => {
            if (!event.inputType.startsWith("insert")) return;
            const start = performance.now();
            const expectedValue = event.target.value;
            const valueObserved = () => {
              if (document.querySelector("[data-testid='source-editor-table-markdown']").value !== expectedValue) {
                requestAnimationFrame(valueObserved);
                return;
              }
              requestAnimationFrame(() => window.sourceMarkdownPerformance.textareaValueMs.push(performance.now() - start));
            };
            requestAnimationFrame(valueObserved);
            const expected = event.target.value.split("\n", 1)[0].split("|")[1]?.trim() ?? "";
            const painted = () => {
              if (document.querySelector("[data-testid='source-editor-table-tool'] th button")?.textContent.trim() !== expected) {
                requestAnimationFrame(painted);
                return;
              }
              requestAnimationFrame(() => window.sourceMarkdownPerformance.paintedInputMs.push(performance.now() - start));
            };
            requestAnimationFrame(painted);
          });
        });
        for (let key = 0; key < 5; key++) {
          await markdownInput.evaluate(element => element.setSelectionRange(4, 4));
          await markdownInput.press("x");
          await expect.poll(() => page.evaluate(() => window.sourceMarkdownPerformance.paintedInputMs.length)).toBe(key + 1);
          await expect.poll(() => page.evaluate(() => window.sourceMarkdownPerformance.textareaValueMs.length)).toBe(key + 1);
          sourceMarkdownInputMs.push((await page.evaluate(() => window.sourceMarkdownPerformance.paintedInputMs)).at(-1));
          sourceTextareaValueMs.push((await page.evaluate(() => window.sourceMarkdownPerformance.textareaValueMs)).at(-1));
          await markdownInput.press("Backspace");
          await expect(dialog.locator("th button").first()).toContainText("H0");
        }
        await expect(apply()).toBeEnabled();
      }
      if (rows > 30 && !longCellLength) {
        await markProfilePhase("navigation");
        await dialog.getByRole("button", { name: "Last table rows", exact: true }).click();
        await expect(apply()).toBeEnabled();
        await dialog.getByRole("button", { name: `Row ${rows}, column 1`, exact: true }).click();
        const tailInput = dialog.getByTestId("source-editor-table-cell-input");
        await tailInput.press("End");
        await markProfilePhase("tail");
        await watchCellInput(true);
        for (let key = 0; key < 5; key++) {
          await tailInput.press("x");
          await expect.poll(() => page.evaluate(() => window.tablePerformance.tailPaintedInputMs.length)).toBe(key + 1);
          await expect.poll(() => page.evaluate(() => window.tablePerformance.tailSettledPreviewMs.length)).toBe(key + 1);
          await expect(tailInput).toBeFocused();
        }
      }
      await markProfilePhase("gc");
      await cdp.send("HeapProfiler.collectGarbage");
      const after = await cdp.send("Runtime.getHeapUsage");
      await page.evaluate(() => window.flushTablePerformance());
      const observation = {
        name, columns, rows, cellsIncludingDelimiter: columns * (rows + 2),
        longCellLength,
        utf8Bytes: Buffer.byteLength(source), openMs,
        mountedCells: await dialog.locator("th,td").count(),
        richMarkdownParsesForGridInputs,
        ...(sourceMarkdownInputMs.length ? { sourceMarkdownInputMs, sourceTextareaValueMs } : {}),
        ...await page.evaluate(() => window.tablePerformance),
        retainedJsHeapBefore: before.usedSize, retainedJsHeapAfter: after.usedSize,
      };
      assert.equal(observation.longTasksMs.length,
        Object.values(observation.longTasksByPhaseMs).reduce((count, entries) => count + entries.length, 0));
      observations.push(observation);
      console.log("PROFILE " + JSON.stringify(observation));
    }
    await page.evaluate(() => window.tablePerformanceObserver?.disconnect());
    writeFileSync(performancePath, JSON.stringify({
      date, startedAt, status: "observed", observedAt: new Date().toISOString(), browser: browser.version(),
      profileSchemaVersion: 2,
      boundary: "local headless Chrome, unthrottled, synthetic plain cells, actual workspace; JS heap after explicit GC covers all workload phases and is not RSS or server memory; five samples per exercised input/position, no performance pass threshold",
      metricScope: "longTasksMs spans the entire observation, not only grid typing. longTasksByPhaseMs assigns by entry.startTime, not observer callback delivery; source includes insert and restoring Backspace. sourceTextareaValueMs waits for the exact DOM value plus the next animation frame; sourceMarkdownInputMs waits for the rendered header plus the next frame. Neither is an INP or physical display measurement.",
      observations,
      ...(cpuHotspots.length ? { cpuHotspots } : {}),
    }, null, 2));
    await cdp.detach();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  writeFileSync(resultPath, JSON.stringify({
    date, startedAt, status: "passed",
    boundary: "local Chrome real dialog/workspace/form/CodeMirror/MarkdownRenderer core; explicit API/Next-loader/assistant-ui source-forwarding and unrelated rich-view/cleanup adapters; no authenticated server acceptance",
    passed: results, pageErrors: errors, consoleErrors, browser: browser.version(),
  }, null, 2));
  console.log(`PASS ${results.length} browser scenarios; evidence: ${out}`);
} finally {
  await browser?.close();
  await new Promise(yes => server.close(yes));
}
