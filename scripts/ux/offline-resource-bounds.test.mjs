import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), { zipSync, unzipSync, strToU8 } = require("fflate");
const source = ts.createSourceFile("offline-db.ts",
  readFileSync(new URL("../../apps/web/lib/offline-db.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true);
function compile(name, scope) {
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  const js = ts.transpileModule(node.getText(source).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), js + `\nreturn ${name};`)(...Object.values(scope));
}

test("a reused verified attachment URL does not materialize another response Blob", async () => {
  let reads = 0, allocations = 0, checks = 0;
  const record = { id: "synthetic", sha256: "synthetic-checksum" };
  const get = compile("getOfflineAttachment", {
    captureOfflineAccess: () => 1, assertOfflineAccess: () => { checks++; },
    offlineDb: { attachments: { get: async () => record } },
    readVerifiedCachedAttachment: async () => ({ blob: async () => { reads++; return new Blob(["synthetic"]); } }),
    attachmentObjectUrlsByKey: new Map(), attachmentObjectUrls: new Set(),
    URL: { createObjectURL: () => { allocations++; return "blob:synthetic"; } },
    offlineAttachmentRead: (item, url, available) => ({ ...item, url, available }),
  });
  for (let index = 0; index < 20; index++) assert.equal((await get(record.id)).url, "blob:synthetic");
  assert.equal(reads, 1); assert.equal(allocations, 1); assert.ok(checks >= 20);
});

test("synthetic offline decompression and Blob paths retain hard capacity limits", () => {
  // Characterization, not a device-independent speed threshold or a production
  // capacity claim. Existing per-conversation bounds remain authoritative.
  const bytes = strToU8(JSON.stringify({ synthetic: true, text: "Synthetic text ".repeat(600_000) }));
  const packed = zipSync({ "package.json": bytes }, { level: 1 });
  const started = performance.now();
  const expanded = unzipSync(packed);
  const elapsed = performance.now() - started;
  assert.deepEqual(expanded["package.json"], bytes);
  assert.match(source.text, /MAX_OFFLINE_ARCHIVE_ENTRY_BYTES = 256 \* 1024 \* 1024/);
  assert.match(source.text, /MAX_OFFLINE_ARCHIVE_EXPANDED_BYTES = 512 \* 1024 \* 1024/);
  console.log(JSON.stringify({ probe: "synthetic-fflate", compressed_bytes: packed.byteLength,
    expanded_bytes: bytes.byteLength, unzip_ms: Number(elapsed.toFixed(2)) }));
});
