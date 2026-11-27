// Real component logic with explicit React scheduling/API doubles. No browser or layout claim.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";

const require=createRequire(new URL("../../apps/web/package.json",import.meta.url));
const React=require("react"),ts=require("typescript"),{renderToStaticMarkup}=require("react-dom/server");
const compile=(url)=>ts.transpileModule(readFileSync(url,"utf8"),{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,
}}).outputText;
const selection={exports:{}};
new Function("module","exports",compile(new URL("../../apps/web/lib/append-selection.ts",import.meta.url)))(selection,selection.exports);
const code=compile(new URL("../../apps/web/features/import/append-import-workspace.tsx",import.meta.url))+"\nexports.ChooseMessages=ChooseMessages; exports.Workspace=Workspace;";
const noop=()=>{},review={title:"Synthetic destination",tail:{role:"assistant",text:"Synthetic end"},receipt:"a".repeat(64),
  add:1001,skip:0,changed:0,missing:0,partial:false,live_share:false};
class ApiRequestError extends Error{constructor(status=409,code=status===409?"APPEND_REVIEW_CHANGED":undefined){
  super("Synthetic private server text must not render");this.status=status;this.code=code;
  this.details=code==="APPEND_REVIEW_CHANGED"?{review:{...review,receipt:"b".repeat(64)}}:undefined;
}}
function setup({count=1001,ranges=true,excerpt=true,submitted,conflict=false,zh=false,
  failure=null,phase="",statusError=false,rejection,reviewData={},workspace=false,concealed=false}={}){
  let cursor=0;const hooks=[],posts=[],cache=[],effects=[],focus=[],queries=[];
  const hook=(init)=>{const i=cursor++;if(!(i in hooks))hooks[i]=init();return hooks[i];};
  const react={...React,
    useState:init=>{const state=hook(()=>({value:typeof init==="function"?init():init}));return[state.value,value=>{state.value=typeof value==="function"?value(state.value):value;}]},
    useRef:value=>hook(()=>({current:value})),useEffect:(fn,deps)=>{
      const last=hook(()=>({deps:null}));
      if(!last.deps||deps.some((dep,i)=>dep!==last.deps[i])){last.deps=deps;effects.push(fn);}
    },
  };
  const api={
    review:async(_id,body)=>{posts.push({op:"review",body});return{...review,...reviewData,add:body.selected_count??body.indexes.length};},
    confirm:async(_id,body,receipt,checks)=>{posts.push({op:"confirm",body,receipt,checks});if(rejection)throw rejection;if(conflict)throw new ApiRequestError();return{status:"queued"};},
    status:async()=>{posts.push({op:"status"});return meta;},
  };
  const query=({queryKey,enabled,...options})=>{
    queries.push({queryKey,enabled,...options});
    if(enabled===false)return{};
    if(queryKey[0]==="append-source")return{data:meta,isError:!!statusError,error:statusError,refetch:noop};
    if(queryKey[0]==="append-fixed-target")return{data:{display_title:"Synthetic destination"}};
    if(queryKey[0]==="append-choices"){
      const page=queryKey.at(-1),start=page*40;
      return{data:{page_size:40,items:Array.from({length:Math.max(0,Math.min(40,count-start))},(_,i)=>({
        index:start+i,role:i%2?"assistant":"user",text:`Synthetic ${start+i}`,assets:0,
      }))}};
    }
    if(queryKey[0]==="append-recovery")return{data:{...review,...reviewData}};
    return{};
  };
  const module={exports:{}},mock=name=>{
    if(name==="react")return react;
    if(name==="react/jsx-runtime")return require(name);
    if(name==="next/link")return{__esModule:true,default:({children,...props})=>React.createElement("a",props,children)};
    if(name==="next/dynamic")return{__esModule:true,default:()=>()=>null};
    if(name==="next/navigation")return{useRouter:()=>({replace:noop})};
    if(name==="@tanstack/react-query")return{useQuery:query,useQueryClient:()=>({setQueryData:(...args)=>cache.push(args)})};
    if(name==="lucide-react")return{ArrowLeft:()=>null,Check:()=>null,FileInput:()=>null};
    if(name.includes("preferences-provider"))return{usePreferences:()=>({resolvedLocale:zh?"zh-CN":"en"})};
    if(name.endsWith("/api"))return{appendImportApi:api,ApiRequestError,getConversation:noop};
    if(name.endsWith("/append-selection"))return selection.exports;
    if(name.endsWith("/offline-access"))return{authenticationGeneration:()=>1};
    throw new Error(name);
  };
  new Function("require","module","exports","requestAnimationFrame",code)(mock,module,module.exports,fn=>fn());
  const meta={id:"synthetic-source",target:"synthetic-target",edition:"e".repeat(64),excerpt,status:submitted?"failed":"previewed",
    pending_receipt:submitted?"old":null,submitted_selection:submitted,failure,phase,
    sources:[{ordinal:0,count,title:"Synthetic source"}],
    ...(ranges?{selection_capabilities:{ranges:true,max_ranges:4096,legacy_max_indexes:250}}:{}),
  };
  const render=()=>{cursor=0;return workspace?module.exports.Workspace({id:meta.id,epoch:1})
    :module.exports.ChooseMessages({meta,epoch:1,volume:0,count,sourceTitle:"Synthetic source",zh,unavailable:!!statusError,concealed});};
  const find=(tree,predicate)=>{
    if(Array.isArray(tree))return tree.flatMap(item=>find(item,predicate));
    if(!React.isValidElement(tree))return[];
    return[...(predicate(tree)?[tree]:[]),...find(tree.props.children,predicate)];
  };
  const buttons=(tree,label)=>find(tree,node=>node.type==="button"&&node.props.children===label);
  const commit=()=>{
    const tree=render();
    for(const node of find(tree,node=>!!node.props.ref))node.props.ref.current={focus:()=>focus.push(node.props["aria-label"])};
    for(const effect of effects.splice(0))effect();
    return tree;
  };
  return{render,commit,focus,find,buttons,posts,cache,meta,queries,html:()=>renderToStaticMarkup(render())};
}

test("new excerpt 251/1001 defaults to ALL, old unknown server never truncates to 250",()=>{
  for(const count of [251,1001]){
    assert.match(setup({count}).html(),new RegExp(`${count} messages · ${count} selected`));
    assert.match(setup({count,ranges:false}).html(),new RegExp(`${count} messages · 0 selected`));
    assert.doesNotMatch(setup({count,ranges:false}).html(),new RegExp(`Select all ${count}`));
    assert.match(setup({count,excerpt:false}).html(),new RegExp(`${count} messages · 0 selected`));
  }
  assert.match(setup({count:250,ranges:false}).html(),/250 messages · 250 selected/);
});

test("whole-source selection survives page switches and exclusions; one compact review/confirm",async()=>{
  const r=setup({excerpt:false});
  r.buttons(r.render(),"Select all 1001")[0].props.onClick();
  r.buttons(r.render(),"Next")[0].props.onClick();
  const checkbox=r.find(r.render(),node=>node.type==="input"&&node.props["aria-label"]==="41 · User")[0];
  assert.equal(checkbox.props.checked,true);
  checkbox.props.onChange({target:{checked:false}});
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
  assert.deepEqual(r.posts[0].body.ranges,[[0,40],[41,1001]]);
  assert.equal(r.posts[0].body.selected_count,1000);
  r.buttons(r.render(),'Append 1000 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
  assert.equal(r.posts.filter(p=>p.op==="confirm").length,1);
  assert.deepEqual(r.posts[1].body,r.posts[0].body);
});

test("409 keeps selection and shows fresh review, without second automatic submission",async()=>{
  const r=setup({conflict:true});
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
  r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
  assert.match(r.html(),/1001 messages · 1001 selected/);
  assert.match(r.html(),/Your selection is kept/);
  assert.equal(r.posts.filter(p=>p.op==="confirm").length,1);
  r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
  assert.equal(r.posts[2].receipt,"b".repeat(64));
  assert.deepEqual(r.posts[2].checks,{allow_share:false,allow_partial:false,allow_changed:false});
});

test("failed range receipt restores exact exclusions and performs only a recovery read",()=>{
  const submitted={target:"synthetic-target",edition:"e".repeat(64),volume:0,ranges:[[0,500],[600,1001]],selected_count:901};
  const r=setup({submitted});
  assert.match(r.html(),/1001 messages · 901 selected/);
  assert.match(r.html(),/Your selection is kept/);
  assert.equal(r.posts.length,0);
});

test("4096 sparse-range budget preserves prior selection and gives actionable explanation",()=>{
  const submitted={target:"synthetic-target",edition:"e".repeat(64),volume:0,
    ranges:[[0,3],...Array.from({length:4095},(_,i)=>[i*2+5,i*2+6])],selected_count:4098};
  const r=setup({count:9000,submitted});
  const box=r.find(r.render(),node=>node.type==="input"&&node.props["aria-label"]==="2 · Assistant")[0];
  box.props.onChange({target:{checked:false}});
  assert.match(r.html(),/9000 messages · 4098 selected/);
  assert.match(r.html(),/Selection is too fragmented/);
  assert.equal(r.posts.length,0);
});

test("old server explains the limit up front; accumulated page picks remain one ordered legacy request",async()=>{
  const r=setup({count:1001,ranges:false,excerpt:false});
  assert.match(r.html(),/250.*[Uu]pgrade/);
  r.buttons(r.render(),"Select this page")[0].props.onClick();
  r.buttons(r.render(),"Next")[0].props.onClick();
  r.buttons(r.render(),"Select this page")[0].props.onClick();
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
  assert.deepEqual(r.posts[0].body.indexes,Array.from({length:80},(_,i)=>i));
  assert.equal(r.posts.length,1);
});

test("deterministic confirmation rejection preserves editable selection instead of unknown-outcome lock",async()=>{
  for(const [status,code,text] of [[403,undefined,/permission/i],[409,"APPEND_TARGET_READ_ONLY",/read.only|archived/i],
    [409,"APPEND_SOURCE_CHANGED",/source.*changed/i],[422,undefined,/selection/i]]){
    const r=setup({rejection:new ApiRequestError(status,code)});
    r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
    r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
    assert.equal(r.buttons(r.render(),"Check this request").length,0);
    assert.match(r.html(),text);assert.match(r.html(),/1001 messages · 1001 selected/);
    assert.equal(r.find(r.render(),node=>node.type==="input"&&node.props.type==="checkbox")[0].props.disabled,false);
    assert.doesNotMatch(r.html(),/Synthetic private server text/);
  }
});

test("unknown confirmation outcome still locks changes and permits only status reconciliation",async()=>{
  const r=setup({rejection:new Error("Network unavailable")});
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
  r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
  assert.equal(r.find(r.render(),node=>node.type==="input"&&node.props.type==="checkbox")[0].props.disabled,true);
  r.buttons(r.render(),"Check this request")[0].props.onClick();await setImmediate();
  assert.deepEqual(r.posts.map(p=>p.op),["review","confirm","status"]);
});

test("background status outage keeps mounted picker and selection; it does not offer a stale confirmation",()=>{
  const r=setup({workspace:true,statusError:true});
  const children=r.find(r.render(),node=>typeof node.type==="function"&&node.type.name==="ChooseMessages");
  assert.equal(children.length,1,"Polling failure must not unmount the picker");
  assert.equal(children[0].props.unavailable,true);
});

test("authoritative access loss conceals cached content without dropping same-session picker state",()=>{
  const error=new ApiRequestError(403),r=setup({workspace:true,statusError:error});
  r.meta.sources.push({ordinal:1,count:1,title:"Other synthetic source"});
  const root=r.render();
  assert.equal(root.props.back,"/");
  assert.equal(r.find(root,node=>node.type==="select").length,0);
  const picker=r.find(root,node=>typeof node.type==="function"&&node.type.name==="ChooseMessages")[0];
  assert.equal(picker.props.concealed,true);
  const child=setup({statusError:error,concealed:true});
  assert.equal(child.html(),"");
  assert.ok(child.queries.every(q=>q.enabled===false));
});

test("worker waiting is automatic, while integrity failure never auto-reviews or invites same-package replay",()=>{
  const chosen={target:"synthetic-target",edition:"e".repeat(64),volume:0,ranges:[[0,1001]],selected_count:1001};
  const waiting=setup({submitted:chosen,phase:"waiting_resources"});
  waiting.meta.status="queued";
  assert.match(waiting.html(),/automatically/i);
  assert.equal(waiting.posts.length,0);
  const invalid=setup({submitted:chosen,failure:{code:"READER_PACKAGE_INVALID",stage:"commit",recovery:"system_support"}});
  assert.match(invalid.html(),/support|administrator/i);
  assert.equal(invalid.buttons(invalid.render(),"Review append position").length,0);
  assert.ok(invalid.queries.filter(q=>q.queryKey[0]==="append-recovery").every(q=>q.enabled===false));
  assert.match(invalid.html(),/1001 messages · 1001 selected/);
});

test("review and page navigation move focus only after committed content, and running confirmation locks consent",async()=>{
  const r=setup({reviewData:{live_share:true}});
  r.commit();
  r.buttons(r.render(),"Next")[0].props.onClick();r.commit();
  assert.ok(r.focus.includes("Source message selection"));
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();r.commit();
  assert.ok(r.focus.includes("Review append position"));
  const share=r.find(r.render(),node=>node.type==="input"&&node.props.type==="checkbox").at(-1);
  share.props.onChange({target:{checked:true}});
  r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();
  const consent=r.find(r.render(),node=>node.type==="input"&&node.props.type==="checkbox").at(-1);
  assert.equal(consent.props.disabled,true);
  await setImmediate();
});

test("a changed tail requires fresh consent for share, partial source and changed messages",async()=>{
  const needs={live_share:true,partial:true,missing:1,changed:2},rejection=new ApiRequestError();
  rejection.details.review={...rejection.details.review,...needs};
  const r=setup({reviewData:needs,rejection});
  r.buttons(r.render(),"Review append position")[0].props.onClick();await setImmediate();
  const consent=()=>r.find(r.render(),node=>node.type==="input"&&node.props.type==="checkbox"&&!node.props["aria-label"]);
  for(const box of consent())box.props.onChange({target:{checked:true}});
  r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.onClick();await setImmediate();
  assert.equal(consent().length,3);
  assert.ok(consent().every(node=>node.props.checked===false));
  assert.equal(r.buttons(r.render(),'Append 1001 messages to the end of “Synthetic destination”')[0].props.disabled,true);
  assert.deepEqual(r.posts[1].checks,{allow_share:true,allow_partial:true,allow_changed:true});
  assert.equal(r.posts.filter(p=>p.op==="confirm").length,1);
  assert.match(r.html(),/1001 messages · 1001 selected/);
});

test("storage recovery is explicit, unlike automatic resource waiting; generic failures do not assert corruption",()=>{
  const submitted={target:"synthetic-target",edition:"e".repeat(64),volume:0,ranges:[[0,1001]],selected_count:1001};
  const full=setup({submitted,failure:{code:"IMPORT_STORAGE_FULL",stage:"commit",recovery:"free_storage"}});
  assert.match(full.html(),/free space, then review again/);
  assert.equal(full.buttons(full.render(),"Review append position").length,1);
  assert.ok(full.queries.filter(q=>q.queryKey[0]==="append-recovery").every(q=>q.enabled===false));
  const failed=setup({submitted,failure:{code:"TASK_FAILED",stage:"commit",recovery:"system_support"}});
  assert.match(failed.html(),/If the source package is damaged/);
  assert.equal(failed.buttons(failed.render(),"Review append position").length,0);
});
