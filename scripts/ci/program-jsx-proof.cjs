// Recognize static presentation edits, not changes to props, effects, handlers,
// selectors, imports or executable code. Unknown changes take full maintenance.
const ts = require(require("node:module").createRequire(require("node:path").resolve(__dirname, "../../apps/web/package.json")).resolve("typescript"));
const [a,b] = JSON.parse(require("node:fs").readFileSync(0,"utf8"));
function shape(src) {
  const file=ts.createSourceFile("surface.tsx",src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  if(file.parseDiagnostics.length) throw Error("invalid syntax");
  const ranges=[];
  const presentation=new Set(["div","span","p","strong","em","small","h1","h2","h3","label","legend","button","summary","li","th","td"]);
  function visit(n) {
    if(ts.isJsxText(n) && n.getText(file).trim() && ts.isJsxElement(n.parent)
       && presentation.has(n.parent.openingElement.tagName.getText(file))) ranges.push([n.pos,n.end," JSX_TEXT "]);
    if(ts.isJsxAttribute(n) && n.name.getText(file)==="className" && n.initializer && ts.isStringLiteral(n.initializer)
        && presentation.has(n.parent.parent.tagName?.getText(file))
        && /^[\w\s :/.\-[\]%()+,#]+$/u.test(n.initializer.text))
      ranges.push([n.initializer.getStart(file),n.initializer.end,'"STATIC_CLASS"']);
    ts.forEachChild(n,visit);
  }
  visit(file);
  for(const [start,end,text] of ranges.reverse()) src=src.slice(0,start)+text+src.slice(end);
  return src;
}
process.exitCode=shape(a)===shape(b)?0:1;
