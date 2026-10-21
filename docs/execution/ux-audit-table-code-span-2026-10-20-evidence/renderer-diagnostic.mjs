import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = process.cwd();
const require = createRequire(new URL('./apps/web/package.json', `file://${root.replaceAll('\\','/')}/`));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { default: ReactMarkdown } = await import(pathToFileURL(require.resolve('react-markdown')).href);
const { default: remarkGfm } = await import(pathToFileURL(require.resolve('remark-gfm')).href);
const sourcePath = `${root}/apps/web/features/editing/markdown-table-tools.ts`;
const source = readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(sourcePath); loaded.filename=sourcePath; loaded.paths=Module._nodeModulePaths(`${root}/apps/web`); loaded._compile(compiled,sourcePath);
const { inspectMarkdownTableDraft, applyMarkdownTableAction }=loaded.exports;
const slash='\\';
const cases=[
  {id:'unmatched-backtick-middle', cell:'`left ` inner '+slash+'| right`'},
  {id:'leading-escaped-backtick', cell:slash+'`left '+slash+'| right``'},
  {id:'escaped-backtick-inside', cell:'`left '+slash+'` inner '+slash+'| right`'},
  {id:'unmatched-backtick-hides-raw-pipe', cell:'`left | right'},
  {id:'balanced-control', cell:'``left ` inner '+slash+'| right``'},
];
const render = text => renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkGfm],skipHtml:true,children:text}));
const observations=cases.map(({id,cell})=>{
  const source=`| A | B |\n| --- | --- |\n| ${cell} | tail |`;
  const html=render(source);
  const model=inspectMarkdownTableDraft(source);
  const transformed=applyMarkdownTableAction(source,0,0,{type:'normalize'});
  return {id,cell,tableCount:(html.match(/<table>/g)||[]).length,headers:(html.match(/<th>/g)||[]).length,cells:(html.match(/<td>/g)||[]).length,parserAccepted:!!model,parserCellCount:model?.rows[0]?.length??null,normalizationAccepted:!!transformed,actualHtml:html,normalizedHtml:transformed?render(transformed.insert):null,normalizationByteEqual:transformed?.insert===source??null};
});
console.log(JSON.stringify(observations,null,2));
