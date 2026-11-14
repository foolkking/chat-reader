import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const workflow = read(".github/workflows/build-release-images.yml");
const comparison = read(".github/workflows/reading-performance.yml");
const settings = workflow.split("\n  settings-quality:\n")[1]?.split(/\n  [a-z][a-z0-9-]*:\n/, 1)[0];
assert.ok(settings, "The existing Settings job is required");

test("the complete release and reusable comparison use platform-default CI timeouts", () => {
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /settings_completion_timing/);
  for (const body of [workflow, comparison]) {
    assert.doesNotMatch(body, /^\s*timeout-minutes:/m);
  }
  assert.equal([...workflow.matchAll(/^  [a-z][a-z0-9-]*:\n/gm)].length, 6);
});

test("platform-default CI timing preserves serial cases and their native deadlines", () => {
  const config = read("apps/web/playwright.config.ts");
  assert.match(config, /timeout: 90_000/);
  assert.match(config, /expect: \{ timeout: 60_000 \}/);
  assert.match(config, /fullyParallel: false/);
  assert.match(config, /workers: 1/);
  assert.doesNotMatch(settings, /continue-on-error:|--(?:grep|grep-invert|workers|retries|max-failures)|globalTimeout/);
  assert.doesNotMatch(comparison, /continue-on-error:|globalTimeout/);
});

test("Settings mode receipt identifies the source, run, attempt and unset CI boundary", () => {
  assert.match(settings, /- name: Record Settings completion timing mode/);
  for (const name of ["mode", "job_timeout_minutes", "source_sha", "workflow_run_id", "workflow_run_attempt", "started_at"]) {
    assert.ok(settings.includes(`${name}=%s`), `Missing mode field ${name}`);
  }
  assert.ok(settings.includes("'platform-default'"));
  assert.ok(settings.includes("'not-set'"));
  assert.ok(settings.includes('tee "$RUNNER_TEMP/settings-completion-mode.txt"'));
});

test("authenticated build timing preserves the original build and browser installation", () => {
  assert.match(settings, /\/usr\/bin\/time -f 'phase=authenticated-web-build\\nelapsed_seconds=%e\\nmax_rss_kb=%M\\nexit_code=%x' \\\n            -o "\$RUNNER_TEMP\/settings-build-timing\.txt" pnpm --filter web build/);
  assert.match(settings, /pnpm --filter web exec playwright install --with-deps chromium/);
});

test("matrix timing retains every original selected file and propagates failure", () => {
  assert.match(settings, /\/usr\/bin\/time -f 'phase=settings-matrix\\nelapsed_seconds=%e\\nmax_rss_kb=%M\\nexit_code=%x' \\\n            -o "\$RUNNER_TEMP\/settings-matrix-timing\.txt" \\\n            pnpm --filter web exec playwright test --config=playwright\.config\.ts 'e2e\/settings-\.\*\\\.spec\\\.ts' e2e\/context-admin-bundles\.spec\.ts/);
  assert.match(settings, /PLAYWRIGHT_EXPECTED_GATES=settings-stages-1-4 node apps\/web\/e2e\/gate-summary\.mjs/);
  assert.doesNotMatch(settings, /pnpm[^\n]+(?:\|\| true|; exit 0)/);
});

test("fresh-instance restore timing preserves the independent restore gate", () => {
  assert.match(settings, /PLAYWRIGHT_GATE_ID=system-archive-new-instance \/usr\/bin\/time -f 'phase=fresh-instance-restore\\nelapsed_seconds=%e\\nmax_rss_kb=%M\\nexit_code=%x' \\\n            -o "\$RUNNER_TEMP\/settings-restore-timing\.txt" \\\n            pnpm --filter web exec playwright test --config=playwright\.config\.ts e2e\/system-archive-new-instance\.spec\.ts/);
  assert.match(settings, /CREATE DATABASE "chat_reader_archive_restore"/);
  assert.match(settings, /PLAYWRIGHT_EXPECTED_GATES=settings-stages-1-4,system-archive-new-instance/);
});

test("fixture shutdown timestamps do not mask the original step exit status", () => {
  assert.equal([...settings.matchAll(/trap 'status=\$\?;/g)].length, 2);
  assert.equal([...settings.matchAll(/exit "\$status"' EXIT/g)].length, 2);
  for (const name of ["settings-fixture-lifecycle", "archive-fixture-lifecycle"]) {
    assert.ok(settings.includes(`"$RUNNER_TEMP/${name}.txt"`));
    assert.ok(settings.includes(`\${{ runner.temp }}/${name}.txt`));
  }
  assert.equal([...settings.matchAll(/fixture_start_at=%s/g)].length, 2);
  assert.equal([...settings.matchAll(/fixture_stop_at=%s\\nstep_exit_code=%s/g)].length, 2);
});

test("Settings timing evidence and its additive source controls are mandatory", () => {
  for (const name of ["completion-mode", "build-timing", "matrix-timing", "restore-timing"]) {
    assert.ok(settings.includes(`\${{ runner.temp }}/settings-${name}.txt`), `Missing timing artifact ${name}`);
  }
  assert.match(workflow, /- name: Settings completion timing source controls\n        run: node --test scripts\/ci\/settings-completion-timing\.test\.mjs/);
  assert.match(settings, /name: settings-quality-evidence-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
});
