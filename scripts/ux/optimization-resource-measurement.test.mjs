import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/offline-search.worker.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

test("NX-PERF-01: actual worker full rebuild baseline at fixed corpus sizes within its existing deadline", () => {
  const measurements = [];
  for (const count of [100, 1000, 5000]) {
    let handler, reply;
    new Function("require", "exports", "self", compiled)(name => require(name), {}, {
      addEventListener: (_name, callback) => { handler = callback; },
      postMessage: value => { reply = value; },
    });
    const documents = Array.from({ length: count }, (_, index) => ({
      id: `synthetic-${index}`, conversation_id: "synthetic", document_type: index === count - 1 ? "notebook" : "message",
      title: "Synthetic resource corpus", plain_text: (`synthetic-${index} searchable bounded text `).repeat(24), metadata: {},
    }));
    const bytes = Buffer.byteLength(JSON.stringify(documents));
    const start = performance.now();
    handler({ data: { type: "init", requestId: "initial", documents: structuredClone(documents) } });
    const initializedMs = performance.now() - start;
    assert.equal(reply.requestId, "initial");
    documents[count - 1] = { ...documents[count - 1], plain_text: "syntheticreplacementneedle" };
    const edited = performance.now();
    handler({ data: { type: "init", requestId: "single-edit", documents: structuredClone(documents) } });
    const smallEditMs = performance.now() - edited;
    handler({ data: { type: "search", requestId: "verify", query: "syntheticreplacementneedle", limit: 10 } });
    assert.deepEqual(reply.items.map(item => item.id), [`synthetic-${count - 1}`]);
    assert.ok(initializedMs < 10_000 && smallEditMs < 10_000, "Do not increase the established worker deadline.");
    measurements.push({ count, bytes, initialTransferredDocuments: count, singleEditTransferredDocuments: count,
      rebuilds: 2, initializedMs, smallEditMs, heapUsed: process.memoryUsage().heapUsed });
  }
  // This characterizes worker + clone costs, not browser/Dexie/production.
  const evidence = { schema: 1, fixture: "synthetic-fixed-corpus-v1", baseline: "full-rebuild",
    boundary: "Actual worker and FlexSearch with controlled transport; browser main-thread/IndexedDB still separately measured.",
    measurements };
  if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, "optimization-resource-measurement.json"), JSON.stringify(evidence, null, 2));
  console.info(JSON.stringify(evidence));
});
