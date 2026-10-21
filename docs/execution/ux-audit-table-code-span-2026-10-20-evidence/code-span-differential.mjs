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
const render = text => renderToStaticMarkup(React.createElement(ReactMarkdown,{remarkPlugins:[remarkGfm],skipHtml:true,children:text}));
const failures=[];let checked=0, accepted=0;
for(let slashes=0;slashes<=4;slashes++)
for(let opening=1;opening<=3;opening++)
for(let middle=0;middle<=3;middle++)
for(let closing=0;closing<=4;closing++)
for(let middleSlashes=0;middleSlashes<=2;middleSlashes++) {
  const value='\\'.repeat(slashes)+'`'.repeat(opening)+'left '+'\\'.repeat(middleSlashes)+'`'.repeat(middle)+' inner \\| right'+'`'.repeat(closing);
  const source=`| A | B |\n| --- | --- |\n| ${value} | tail |`;
  const before=render(source);
  const result=applyMarkdownTableAction(source,0,0,{type:'normalize'});
  const shape=(before.match(/<table>/g)||[]).length===1&&(before.match(/<th>/g)||[]).length===2&&(before.match(/<td>/g)||[]).length===2;
  const model=inspectMarkdownTableDraft(source);
  const renderEqual=!!result&&render(result.insert)===before;
  const idempotent=!!result&&applyMarkdownTableAction(result.insert,0,0,{type:'normalize'})?.insert===result.insert;
  checked++;if(result)accepted++;
  if(!shape||!result||!renderEqual||!idempotent||model?.rows[0].length!==2)failures.push({value,shape,accepted:!!result,renderEqual,idempotent,modelColumns:model?.rows[0].length??null});
}
console.log(JSON.stringify({checked,accepted,failures:failures.slice(0,12),failureCount:failures.length,scope:'actual installed GFM static rendering, synthetic escaped-pipe/backtick/backslash combinations; not browser, arbitrary Markdown, timing or resource acceptance'},null,2));
assert.equal(checked,900);assert.equal(failures.length,0);
