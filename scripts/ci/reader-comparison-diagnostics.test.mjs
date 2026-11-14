// Execute the real workflow shell with explicit command adapters. No Git
// checkout, service, application build, browser, signal or CI API is executed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/reading-performance.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const section = workflow.split("      - name: Baseline then candidate on the same isolated runner\n")[1]
  .split("      - name: Preserve comparison measurements\n")[0];
const script = section.split("        run: |\n")[1].split("\n").map(line => {
  if (!line.trim()) return "";
  assert.ok(line.startsWith("          "));
  return line.slice(10);
}).join("\n").replaceAll("${{ github.sha }}", "a".repeat(40));
const parent = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
if (process.platform === "win32") {
  assert.match(parent.replaceAll("\\", "/").toLowerCase(),
    /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
} else assert.ok(process.env.RUNNER_TEMP || process.env.TEMP);
const bash = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../..", "bin/bash.exe")
  : "bash";
if (process.platform === "win32") assert.ok(existsSync(bash), "The controlled shell tests require Git's Bash, not WSL.");
const shellPath = path => process.platform === "win32"
  ? path.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : path;
const baseline = "43a714f2c13f6e6573eb02916c8ff8f78dd2d82e";

const adapters = String.raw`
current_ref=unset
record() {
  printf '%s\t%s\t%s\t%s\n' "$1" "\${PLAYWRIGHT_GATE_ID:-setup}" "$current_ref" "\${E2E_READER_CAPACITY_PROFILE:-0}" >> "$POLICY_EVENT_FILE"
}
git() {
  if [ "$1" = checkout ]; then current_ref="$3"; record checkout; fi
  return 0
}
cp() { record copy; return 0; }
bash() {
  record database
  if [ "\${PLAYWRIGHT_GATE_ID:-setup}" = "reader-capacity-$DATABASE_FAILURE_PHASE" ] && [ "$2" = start ]; then return 31; fi
  return 0
}
python() { return 0; }
pytest() { return 0; }
nohup() { return 0; }
kill() { return 1; }
rm() { return 0; }
curl() { return 0; }
pnpm() {
  case "$*" in
    *"--list"*) record selection; printf 'Total: 9 tests in 1 file\n'; return 0 ;;
    *"playwright test"*)
      record test
      if [ "$PLAYWRIGHT_GATE_ID" = reader-capacity-baseline ] && [ "$BASELINE_FAILED" = 1 ]; then return 1; fi
      if [ "$PLAYWRIGHT_GATE_ID" = reader-capacity-candidate ] && [ "$CANDIDATE_FAILED" = 1 ]; then return 1; fi
      if [ "$PLAYWRIGHT_GATE_ID" = reader-capacity-diagnostic-candidate ] && [ "$DIAGNOSTIC_FAILED" = 1 ]; then return 1; fi
      return 0 ;;
    *"web build"*)
      record build
      if [ "$PLAYWRIGHT_GATE_ID" = "reader-capacity-$BUILD_FAILURE_PHASE" ]; then return 32; fi
      return 0 ;;
  esac
  return 0
}
`.replaceAll("\\${", "${");

function run({
  candidateFailed = false, baselineFailed = true, diagnosticFailed = false,
  diagnosticRef = "", buildFailurePhase = "never", databaseFailurePhase = "never",
  ambientProfile = "0", program = script,
} = {}) {
  const directory = mkdtempSync(join(parent, "reader-comparison-policy-"));
  const runner = join(directory, "runner");
  mkdirSync(join(runner, "reading-comparison"), { recursive: true });
  mkdirSync(join(directory, "apps/api"), { recursive: true });
  const executable = join(directory, "control.sh");
  const eventFile = join(directory, "events.tsv");
  writeFileSync(executable, adapters + "\n" + program, "utf8");
  const result = spawnSync(bash, ["--noprofile", "--norc", shellPath(executable)], {
    cwd: directory, encoding: "utf8", timeout: 20_000,
    env: {
      ...process.env, RUNNER_TEMP: shellPath(runner), POLICY_EVENT_FILE: shellPath(eventFile),
      RUNNER_NAME: "synthetic-policy-runner", READER_DIAGNOSTIC_REF: diagnosticRef,
      E2E_READER_CAPACITY_PROFILE: ambientProfile,
      BASELINE_FAILED: baselineFailed ? "1" : "0",
      CANDIDATE_FAILED: candidateFailed ? "1" : "0",
      DIAGNOSTIC_FAILED: diagnosticFailed ? "1" : "0",
      BUILD_FAILURE_PHASE: buildFailurePhase, DATABASE_FAILURE_PHASE: databaseFailurePhase,
    },
  });
  assert.equal(result.error, undefined, "The controlled workflow shell must actually execute.");
  const events = existsSync(eventFile) ? readFileSync(eventFile, "utf8").trim().split("\n").filter(Boolean)
    .map(line => {
      const [kind, phase, source, profile] = line.replace(/\r$/, "").split("\t");
      return { kind, phase, source, profile };
    }) : [];
  const retained = name => {
    const path = join(runner, "reading-comparison", name);
    return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
  };
  return { exit: result.status, events, retained };
}

function tests(result) { return result.events.filter(event => event.kind === "test"); }
function assertOrdinaryFailure(result) {
  assert.notEqual(result.exit, 0, "A diagnostic pass cannot release a failed primary candidate.");
  assert.equal(result.retained("candidate-result.txt"), "failed");
  const measured = tests(result);
  assert.deepEqual(measured.map(event => event.phase), [
    "reader-capacity-baseline", "reader-capacity-candidate", "reader-capacity-diagnostic-candidate",
  ]);
  assert.deepEqual(measured.map(event => event.source), [baseline, "a".repeat(40), "a".repeat(40)]);
  assert.deepEqual(measured.map(event => event.profile), ["0", "0", "1"]);
}

test("a passing ordinary candidate preserves a failed baseline without profiling or replay", () => {
  const result = run();
  assert.equal(result.exit, 0);
  assert.equal(result.retained("baseline-result.txt"), "failed");
  assert.equal(result.retained("candidate-result.txt"), "passed");
  assert.equal(result.retained("diagnostic-candidate-result.txt"), null);
  assert.deepEqual(tests(result).map(event => event.phase), ["reader-capacity-baseline", "reader-capacity-candidate"]);
  assert.deepEqual(tests(result).map(event => event.profile), ["0", "0"]);
});

test("a failed primary stays failed even when its independent full-sequence CPU replay passes", () => {
  const result = run({ candidateFailed: true });
  assertOrdinaryFailure(result);
  assert.equal(result.retained("diagnostic-candidate-result.txt"), "passed");
  assert.match(result.retained("diagnostic-candidate-only.txt"), /failed primary retained; not release acceptance/);
  assert.deepEqual(result.events.filter(event => event.kind === "selection").map(event => event.phase),
    ["reader-capacity-diagnostic-candidate"]);
});

test("a failed replay cannot replace or erase the original candidate result", () => {
  const result = run({ candidateFailed: true, diagnosticFailed: true });
  assertOrdinaryFailure(result);
  assert.equal(result.retained("diagnostic-candidate-result.txt"), "failed");
});

test("ordinary timing cannot inherit an ambient CPU profiling flag", () => {
  const result = run({ ambientProfile: "1" });
  assert.equal(result.exit, 0);
  assert.deepEqual(tests(result).map(event => event.profile), ["0", "0"]);
});

test("explicit exact-SHA manual diagnostics retain both original profiled phases and never add a third replay", () => {
  const failed = "c".repeat(40);
  const result = run({ diagnosticRef: failed, candidateFailed: true });
  assert.notEqual(result.exit, 0);
  assert.deepEqual(tests(result).map(event => event.source), [baseline, failed]);
  assert.deepEqual(tests(result).map(event => event.profile), ["1", "1"]);
  assert.equal(result.retained("diagnostic-candidate-result.txt"), null);
});

test("invalid manual diagnostic identity fails before any phase or test", () => {
  const result = run({ diagnosticRef: "not-an-exact-source" });
  assert.notEqual(result.exit, 0);
  assert.equal(tests(result).length, 0);
});

for (const [label, options] of [
  ["baseline service", { databaseFailurePhase: "baseline" }],
  ["candidate build", { buildFailurePhase: "candidate" }],
]) {
  test(`${label} infrastructure failure remains fail-closed, not an automatic acceptance retry`, () => {
    const result = run(options);
    assert.notEqual(result.exit, 0);
    assert.equal(result.retained("candidate-result.txt"), null);
    assert.equal(result.retained("diagnostic-candidate-result.txt"), null);
  });
}

test("diagnostic build failure retains the failed primary and cannot reset the job result", () => {
  const result = run({ candidateFailed: true, buildFailurePhase: "diagnostic-candidate" });
  assert.notEqual(result.exit, 0);
  assert.equal(result.retained("candidate-result.txt"), "failed");
  assert.equal(result.retained("diagnostic-candidate-result.txt"), null);
});

test("a mutated success exit is rejected by the executed failure control", () => {
  const result = run({ candidateFailed: true, program: script.replace('exit "$candidate_failed"', "exit 0") });
  assert.equal(result.exit, 0, "The negative control must execute the mutated exit.");
  assert.throws(() => assertOrdinaryFailure(result), /diagnostic pass cannot release/);
});

test("a diagnostic replay accidentally bound to the baseline is rejected by actual phase provenance", () => {
  const result = run({ candidateFailed: true,
    program: script.replace('if [ "$phase" != baseline ]; then ref="$candidate"; fi',
      'if [ "$phase" = candidate ]; then ref="$candidate"; fi') });
  assert.equal(tests(result).at(-1).source, baseline, "The negative control must actually select the wrong source.");
  assert.throws(() => assertOrdinaryFailure(result));
});

test("the shared primary harness, original nine-case sequence, result gate and native bounds remain intact", () => {
  assert.match(script, /for phase in baseline candidate; do\n  run_phase "\$phase"\ndone/);
  assert.match(script, /cp "\$RUNNER_TEMP\/reading-comparison\/harness\.ts" apps\/web\/e2e\/reader-capacity\.spec\.ts/);
  assert.match(script, /grep -q 'Total: 9 tests in 1 file'/);
  assert.doesNotMatch(script, /--grep|--retries|candidate_failed=0[\s\S]*candidate_failed=0|rm -r|docker compose down/);
  assert.match(script, /if \[ "\$phase" = candidate \]; then candidate_failed=1; fi/);
  assert.match(script, /for attempt in \$\(seq 1 60\)/);
  assert.match(script, /for attempt in \$\(seq 1 30\)/);
  assert.match(script, /exit "\$candidate_failed"/);
  assert.doesNotMatch(workflow, /timeout-minutes:/);
});
