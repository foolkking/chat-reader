import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("./changed-area-selector.mjs", import.meta.url));

function run(...args) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  }));
}

test("changed-area selector always keeps the full release gate", () => {
  const result = run("--base", "HEAD", "--head", "HEAD");
  assert.equal(result.changed_files, 0);
  assert.deepEqual(result.areas, []);
  assert.equal(result.full_gate_required, true);
});

test("selector classifies the current worktree without duplicate commands", () => {
  const result = run();
  assert.ok(result.areas.includes("tooling") || result.areas.includes("docs"));
  assert.equal(new Set(result.recommended_commands).size, result.recommended_commands.length);
  assert.match(result.note, /complete quality gate/i);
});
