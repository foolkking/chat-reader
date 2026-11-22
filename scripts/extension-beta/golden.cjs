// Rebuild the small, synthetic cross-repo fixture. Refuses an unpinned exporter
// or an existing output file. No browser session, credentials or network calls.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),crypto=require("node:crypto");
const [fork,out]=process.argv.slice(2), at="a3f0ebe738a2e69ea5c866bdddb29ce119f08fc5";
if(!out||cp.execFileSync("git",["-C",fork,"rev-parse","HEAD"],{encoding:"utf8"}).trim()!==at)throw Error("Expected pinned Reader fork "+at);
const load=file=>require(path.resolve(fork,file));
globalThis.fflate=load("reader/vendor/fflate-0.8.3.js");load("reader/package.js");load("reader/visible.js");
const parser=load("extension/fast-text.js");load("extension/i18n.js").setLocale("en");
const store=new Map(),dir={async getFileHandle(name){return {
  async getFile(){return store.get(name);},async createWritable(){const a=[];return {
    async write(x){a.push(x);},async close(){store.set(name,new Blob(a));},async abort(){}};}};}};
(async()=>{
  const mapping={},title="Tide contract",file="assets/report.csv";
  for(const [i,role] of ["user","system","assistant","assistant"].entries()){
    mapping["node-"+i]={parent:i?"node-"+(i-1):null,children:i<3?["node-"+(i+1)]:[],
      message:{id:"sample-"+i,author:{role},content:{content_type:"text",parts:[
        ["一条潮汐记录","hidden synthetic plumbing","```md\n## User\n```\n\n[report](assets/report.csv)","Formula $x^2$"][i]]}}};
  }
  const {messages}=parser.parseTree({mapping,title,current_node:"node-3"},undefined,{sourcePaths:true});
  const rows=messages.map((m,i)=>({id:m.id,role:m.role,sourcePath:m.sourcePath,body:ReaderVisible(m,parser).body,at:null,assets:i===1?[file]:[]}));
  store.set("csv",new Blob(["tide,2\n"]));
  const result=await ReaderArchive.build(dir,{id:"synthetic-golden",title,images:[],lineage:"tree"},()=>rows,new Map([[file,await dir.getFileHandle("csv")]]));
  const bytes=Buffer.from(await result.arrayBuffer());fs.writeFileSync(out,bytes,{flag:"wx"});
  console.log("Synthetic fixture SHA-256:",crypto.createHash("sha256").update(bytes).digest("hex"));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
