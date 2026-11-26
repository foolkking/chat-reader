// Synthetic package-writer input only: no browser, source adapter, credentials or network.
// Use the real ReaderArchive writer and retain its exact source hashes in the fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {execFileSync} = require("node:child_process");

const [forkArg, outputArg] = process.argv.slice(2);
assert.ok(forkArg && outputArg && process.argv.length === 4);
const fork = fs.realpathSync(forkArg);
const output = path.resolve(outputArg);
assert.ok(!fs.existsSync(output), "Use a new fixture directory");
assert.ok(["e:\\chat-reader-temp\\", "c:\\users\\86182\\desktop\\wkkk\\"]
  .some(root => output.toLowerCase().startsWith(root)), "Unapproved scratch root");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const inputs = ["reader/package.js", "reader/sha256.js", "reader/vendor/fflate-0.8.3.js"];
const sourceHashes = Object.fromEntries(inputs.map(name => {
  const file = path.join(fork, name);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  return [name, hash(fs.readFileSync(file))];
}));
globalThis.fflate = require(path.join(fork, inputs[2]));
require(path.join(fork, inputs[1]));
require(path.join(fork, inputs[0]));

function directory() {
  // The browser OPFS surface is replaced, not the package implementation.
  const files = new Map();
  return {
    async getFileHandle(name) {
      return {
        async getFile() { assert.ok(files.has(name)); return files.get(name); },
        async createWritable() {
          const chunks = [];
          return {
            async write(chunk) { chunks.push(chunk); },
            async close() { files.set(name, new Blob(chunks)); },
            async abort() { chunks.length = 0; },
          };
        },
      };
    },
  };
}

async function build(name, meta, rows, media) {
  const dir = directory(), handles = new Map();
  for (const [filename, bytes] of media) {
    const handle = await dir.getFileHandle(filename);
    const writer = await handle.createWritable();
    await writer.write(bytes); await writer.close();
    handles.set(filename, handle);
  }
  const file = await ReaderArchive.build(dir, meta, () => rows, handles);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(meta.zipDigest, hash(bytes), "Real writer digest differs from the emitted ZIP");
  fs.writeFileSync(path.join(output, name + ".zip"), bytes, {flag: "wx"});
  return {
    name, zip_bytes: bytes.length, zip_sha256: hash(bytes), partial: !!meta.partial, source_id: meta.id,
    rows: rows.map(({id, role, body, sourcePath}) => ({id, role, body, source_path: sourcePath})),
    assets: [...media].map(([filename, body]) => ({path: filename, bytes: body.length, sha256: hash(body)})),
  };
}

(async () => {
  fs.mkdirSync(output);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  // ZIP_STORED assets force more than one 4-MiB server chunk without an enormous Markdown DOM.
  const csv = Buffer.from("station,depth\nG1,42\n".repeat(280000));
  assert.ok(csv.length > 4 * 1024 ** 2);
  const complete = await build("complete", {
    id: "synthetic-g1-complete", title: "Synthetic backend G1 complete", lineage: "tree",
    images: ["assets/pixel.png"], partial: false,
  }, [
    {id: "g1-question", role: "user", sourcePath: ["g1-question-node"], at: null,
      body: "Synthetic question 中文𠜎\n\n[report](assets/report.csv)", assets: ["assets/report.csv"]},
    {id: "g1-answer", role: "assistant", sourcePath: ["g1-answer-node"], at: null,
      body: "Synthetic answer\n\n```md\n## User\nnot another message\n```\n\n![pixel](assets/pixel.png)", assets: ["assets/pixel.png"]},
  ], new Map([["assets/report.csv", csv], ["assets/pixel.png", image]]));
  const partial = await build("partial", {
    id: "synthetic-g1-partial", title: "Synthetic backend G1 missing image", lineage: "tree",
    images: [], partial: true,
  }, [
    {id: "g1-partial-question", role: "user", sourcePath: ["g1-partial-question-node"], at: null,
      body: "Synthetic image question", assets: []},
    {id: "g1-partial-answer", role: "assistant", sourcePath: ["g1-partial-answer-node"], at: null,
      body: "> Image unavailable: synthetic missing-image marker", assets: []},
  ], new Map());
  for (const name of inputs) assert.equal(hash(fs.readFileSync(path.join(fork, name))), sourceHashes[name], "Writer input changed during generation");
  const result = {
    schema_version: 1,
    scope: "Real package.js with synthetic normalized rows; in-memory OPFS substitute. No parser/source/browser acceptance.",
    fork_head: execFileSync("git", ["-C", fork, "rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
    source_hashes: sourceHashes, cases: [complete, partial],
  };
  fs.writeFileSync(path.join(output, "fixtures.json"), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  console.log(JSON.stringify({files: 2, complete_bytes: complete.zip_bytes, partial_bytes: partial.zip_bytes, source_hashes: sourceHashes}));
})().catch(error => {
  // Do not serialize arbitrary fixture data or executable arguments.
  console.error(JSON.stringify({failed: true, type: error.name}));
  process.exitCode = 1;
});
