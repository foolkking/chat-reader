// Synthetic only. Exercise the installed source writer, not a hand-written ZIP.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const [forkArg,outputArg]=process.argv.slice(2),fork=fs.realpathSync(forkArg),out=path.resolve(outputArg);
assert.equal(process.argv.length,4);
assert.ok(out.toLowerCase().startsWith("e:\\chat-reader-temp\\"));
assert.ok(!fs.existsSync(out));
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const inputs=["reader/package.js","reader/sha256.js","reader/vendor/fflate-0.8.3.js"];
const source_hashes=Object.fromEntries(inputs.map(name=>[name,hash(fs.readFileSync(path.join(fork,name)))]));
globalThis.fflate=require(path.join(fork,inputs[2]));require(path.join(fork,inputs[1]));require(path.join(fork,inputs[0]));
const files=new Map(),dir={async getFileHandle(name){return{
  async getFile(){return files.get(name);},async createWritable(){const chunks=[];return{
    async write(bytes){chunks.push(bytes);},async close(){files.set(name,new Blob(chunks));},async abort(){chunks.length=0;},
  };},
};}};
(async()=>{
  const count=1001,meta={id:"synthetic-range-1001",title:"Synthetic range append",lineage:"tree",images:[],partial:false};
  const rows=Array.from({length:count},(_,i)=>({id:`synthetic-range-${i}`,role:i%2?"assistant":"user",
    sourcePath:[`synthetic-range-node-${i}`],at:null,assets:[],body:`Synthetic ranged HTTP row ${i}\n\n### Heading ${i}\n\n${"Bounded synthetic text. ".repeat(40)}`}));
  const zip=await ReaderArchive.build(dir,meta,()=>rows,new Map()),bytes=Buffer.from(await zip.arrayBuffer());
  assert.equal(hash(bytes),meta.zipDigest);
  fs.mkdirSync(out);fs.writeFileSync(path.join(out,"range-1001.zip"),bytes,{flag:"wx"});
  for(const name of inputs)assert.equal(hash(fs.readFileSync(path.join(fork,name))),source_hashes[name]);
  fs.writeFileSync(path.join(out,"expected.json"),JSON.stringify({
    synthetic_only:true,count,source_hashes,zip_sha256:hash(bytes),zip_bytes:bytes.length,
    body_hashes:rows.map(row=>hash(row.body)),roles:rows.map(row=>row.role),
    scope:"Real package.js; synthetic normalized inputs and in-memory OPFS substitute, not a real capture",
  },null,2),{flag:"wx"});
  console.log(JSON.stringify({count,zip_bytes:bytes.length,zip_sha256:hash(bytes),source_hashes}));
})().catch(error=>{console.error(JSON.stringify({failed:true,type:error.name}));process.exitCode=1;});
