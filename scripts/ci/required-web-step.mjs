import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSchedule } from "./quality-schedule.mjs";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

// The only permitted conditional is the frozen, required shard assignment.
// YAML/DAG semantics are independently checked by required_web_gates.py.
export function requiredWebStep(name, {
  workflow = read(".github/workflows/web-quality.yml"),
  assignment = loadSchedule().web.assignment,
} = {}) {
  const shard = assignment[name];
  assert.ok(Number.isInteger(shard) && shard > 0, "A required shard assignment is missing.");
  const marker = `      - name: ${name}\n`;
  const pieces = workflow.split(marker);
  assert.equal(pieces.length, 2, "Exactly one required browser step must exist.");
  const step = pieces[1].split(/\n      - (?:name:|uses:)/)[0];
  const condition = `        if: \${{ inputs.shard == ${shard} }}`;
  assert.deepEqual(step.split("\n").filter((line) => /^\s*if:/.test(line)), [condition],
    "Only the exact required shard condition is permitted.");
  assert.doesNotMatch(step, /continue-on-error|\|\| true/, "A browser failure must fail its shard.");
  return { workflow, step: step.replace(`${condition}\n`, "") };
}
