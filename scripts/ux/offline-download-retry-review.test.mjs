import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const source = fs.readFileSync(
  new URL("../../apps/web/lib/offline-downloads.ts", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /const needsTargetReview = record\?\.error === "UNAVAILABLE_TARGET";/,
  "The retry path must identify unavailable-target failures before the generic retry guard.",
);
assert.match(
  source,
  /offlineFailureCanRetry\(record\.error\) && !needsTargetReview/,
  "Confirmed unavailable-target reviews must bypass the ordinary retry guard.",
);
assert.match(
  source,
  /if \(needsTargetReview && !options\.confirmedTargetIds\) return;/,
  "Unavailable-target retries must still require explicit scope confirmation.",
);
assert.match(
  source,
  /const rebuild = legacy \|\| needsTargetReview \|\| record\.state === "cancelled"/,
  "Confirmed scope review must rebuild the target list, cursor and child receipts.",
);

// Exercise the real coordinator with controlled I/O. These are behavior tests,
// not browser/Dexie/production proof; no import of the live offline database.
const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const ast = ts.createSourceFile("offline-downloads.ts", source, ts.ScriptTarget.Latest, true);
const coordinator = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "retryOfflineDownloadWithReview");
assert.ok(coordinator);
const compiled = ts.transpileModule(coordinator.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function reviewFixture(targetConversationIds) {
  let generation = 1, confirmations = 0;
  const retries = [];
  const module = { exports: {} };
  new Function("module", "exports", "PREFIX", "captureOfflineAccess", "assertOfflineAccess",
    "offlineDb", "inspectOfflineDownloadRetryScope", "retryOfflineDownload", compiled)(
    module, module.exports, "synthetic:",
    () => generation,
    captured => { if (captured !== generation) throw new Error("ACCOUNT_CHANGED"); },
    { settings: { get: async () => ({ value: { error: "UNAVAILABLE_TARGET" } }) } },
    async () => ({ targetConversationIds, previousTargetCount: 2, currentScopeCount: 1, unavailableCount: 1, newlyIncludedCount: 0 }),
    async (id, options) => { retries.push({ id, options }); },
  );
  return {
    retries, confirmations: () => confirmations,
    changeAccount: () => { generation++; },
    run: confirm => module.exports.retryOfflineDownloadWithReview("synthetic-job", async review => {
      confirmations++;
      return confirm(review);
    }),
  };
}
test("an empty reviewed plan never opens confirmation or restarts the batch", async () => {
  const f = reviewFixture([]);
  await assert.rejects(f.run(() => true), /OFFLINE_TARGET_SCOPE_EMPTY/);
  assert.equal(f.confirmations(), 0);
  assert.deepEqual(f.retries, []);
});
test("review cancellation retains the old batch, while confirmation freezes exactly the reviewed targets", async () => {
  const f = reviewFixture(["synthetic-target"]);
  await f.run(() => false);
  assert.deepEqual(f.retries, []);
  await f.run(() => true);
  assert.deepEqual(f.retries, [{ id: "synthetic-job", options: { confirmedTargetIds: ["synthetic-target"] } }]);
});
test("an account change while confirming cannot restart a batch", async () => {
  const f = reviewFixture(["synthetic-target"]);
  await assert.rejects(f.run(() => { f.changeAccount(); return true; }), /ACCOUNT_CHANGED/);
  assert.deepEqual(f.retries, []);
});
