import assert from "node:assert/strict";
import { test } from "node:test";
import recovery from "./fixtures/context-return-recovery.mjs";
const { contextReturnRecovery, contextReturnFailureMessage } = recovery;
const task = (reason, hint) => ({ job_type: "context_return", status: "failed", error_message: reason,
  result: hint ? { context_return_recovery: hint } : {} });
for (const reason of ["CONTEXT_RETURN_EXPIRED", "CONTEXT_RETURN_UNAVAILABLE", "CONTEXT_RETURN_INVALID",
  "CONTEXT_RETURN_TOO_LARGE", "CONTEXT_MEMBER_TOO_LARGE", "CONTEXT_BASE_CHANGED", "CONTEXT_MEMBER_INVALID"]) {
  test(`legacy ${reason} cannot offer blind retry`, () => {
    const row = task(reason);
    assert.equal(contextReturnRecovery(row).action, "update_files");
    assert.equal(contextReturnRecovery(row).conversation_id, null);
    for (const zh of [true, false]) {
      const text = contextReturnFailureMessage(row, zh);
      assert.ok(text.length > 10);
      assert.ok(!text.includes(reason));
    }
  });
}
test("a current server hint overrides a stale error while unknown content is never echoed", () => {
  const row = task("private details", { action: "update_files", reason: "CONTEXT_RETURN_EXPIRED", conversation_id: "synthetic-owned" });
  assert.equal(contextReturnRecovery(row).conversation_id, "synthetic-owned");
  assert.match(contextReturnFailureMessage(row, false), /expired/);
  assert.doesNotMatch(contextReturnFailureMessage(task("private details"), false), /private details/);
});
test("temporary failures retain explicit retry, and nonfailed/other tasks get no Context controls", () => {
  assert.equal(contextReturnRecovery(task("TASK_FAILED")).action, "retry");
  assert.equal(contextReturnRecovery({ ...task("CONTEXT_RETURN_EXPIRED"), status: "processing" }), null);
  assert.equal(contextReturnRecovery({ ...task("CONTEXT_RETURN_EXPIRED"), job_type: "import" }), null);
  assert.equal(contextReturnRecovery(undefined), null);
});
