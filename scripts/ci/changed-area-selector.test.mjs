import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./changed-area-selector.mjs", import.meta.url));

function fixture(t) {
  const explicitRoot = process.env.RUNNER_TEMP ?? process.env.TEMP;
  assert.ok(explicitRoot && isAbsolute(explicitRoot), "Use an explicit task temporary directory");
  const tempRoot = realpathSync(explicitRoot);
  assert.ok(lstatSync(tempRoot).isDirectory());
  if (process.platform === "win32") {
    assert.match(tempRoot.toLowerCase().replaceAll("\\", "/"),
      /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
  }
  const directory = mkdtempSync(join(tempRoot, "changed-area-selector-"));
  t.after(() => {
    // Only remove this test's direct child after checking its absolute/link boundary.
    assert.equal(realpathSync(directory), directory);
    assert.equal(dirname(directory), tempRoot);
    assert.match(basename(directory), /^changed-area-selector-/);
    function rejectLinks(path) {
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, `Refusing linked fixture path: ${path}`);
      if (stat.isDirectory()) {
        for (const name of readdirSync(path)) rejectLinks(join(path, name));
      }
    }
    rejectLinks(directory);
    rmSync(directory, { recursive: true });
  });
  // Do not inherit a user's Git worktree/index, global config, signing or hooks.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = join(directory, ".git", "fixture-global-config");
  const options = { cwd: directory, encoding: "utf8", env, timeout: 10_000 };
  const git = (...args) => execFileSync("git", [
    "-c", "core.autocrlf=false",
    "-c", `core.hooksPath=${join(directory, ".git", "fixture-hooks")}`,
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Synthetic Selector Fixture",
    "-c", "user.email=synthetic-selector@example.invalid",
    ...args,
  ], options).trim();
  const write = (path, content) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  };
  git("init", "--quiet", "--template=", "--initial-branch=fixture");
  write(".git/fixture-global-config", "");
  mkdirSync(join(directory, ".git", "fixture-hooks"));
  write("docs/fixture.md", "Synthetic documentation fixture.\n");
  write("scripts/fixture.mjs", "// Synthetic tooling fixture.\n");
  git("add", "--", "docs", "scripts");
  git("commit", "--quiet", "-m", "Synthetic selector baseline");
  assert.equal(git("status", "--porcelain"), "");
  return {
    git, write,
    run: (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], options)),
    capture: (...args) => spawnSync(process.execPath, [script, ...args], options),
  };
}

test("changed-area selector always keeps the full release gate", (t) => {
  const result = fixture(t).run("--base", "HEAD", "--head", "HEAD");
  assert.equal(result.changed_files, 0);
  assert.deepEqual(result.areas, []);
  assert.equal(result.full_gate_required, true);
});

test("selector classifies a synthetic worktree without duplicate commands", (t) => {
  const worktree = fixture(t);
  worktree.write("docs/fixture.md", "Synthetic tracked documentation change.\n");
  worktree.write("scripts/untracked.mjs", "// Synthetic untracked tooling change.\n");
  const result = worktree.run();
  assert.ok(result.areas.includes("tooling") || result.areas.includes("docs"));
  assert.deepEqual(result.areas, ["docs", "tooling"]);
  assert.equal(result.changed_files, 2);
  assert.deepEqual(result.recommended_commands, ["git diff --check"]);
  assert.equal(new Set(result.recommended_commands).size, result.recommended_commands.length);
  assert.equal(result.full_gate_required, true);
  assert.match(result.note, /complete quality gate/i);
});

test("a clean checkout is valid and still requires the complete release gate", (t) => {
  const result = fixture(t).run();
  assert.equal(result.changed_files, 0);
  assert.deepEqual(result.areas, []);
  assert.deepEqual(result.recommended_commands, []);
  assert.equal(result.full_gate_required, true);
  assert.match(result.note, /complete quality gate/i);
});

test("staged and unstaged versions of one tracked file are counted only once", (t) => {
  const worktree = fixture(t);
  worktree.write("docs/fixture.md", "Synthetic staged change.\n");
  worktree.git("add", "--", "docs/fixture.md");
  worktree.write("docs/fixture.md", "Synthetic additional unstaged change.\n");
  worktree.write("scripts/untracked.mjs", "// Synthetic untracked change.\n");
  const result = worktree.run();
  assert.equal(result.changed_files, 2);
  assert.deepEqual(result.areas, ["docs", "tooling"]);
  assert.deepEqual(result.recommended_commands, ["git diff --check"]);
  assert.equal(result.full_gate_required, true);
});

test("an explicit committed range does not include unrelated untracked files", (t) => {
  const worktree = fixture(t);
  const base = worktree.git("rev-parse", "HEAD");
  worktree.write("docs/fixture.md", "Synthetic committed documentation change.\n");
  worktree.write("scripts/fixture.mjs", "// Synthetic committed tooling change.\n");
  worktree.git("add", "--", "docs", "scripts");
  worktree.git("commit", "--quiet", "-m", "Synthetic selector change");
  const head = worktree.git("rev-parse", "HEAD");
  worktree.write("apps/api/untracked.py", "# Outside the selected committed range.\n");
  const result = worktree.run("--base", base, "--head", head);
  assert.deepEqual(result.source, { base, head });
  assert.equal(result.changed_files, 2);
  assert.deepEqual(result.areas, ["docs", "tooling"]);
  assert.deepEqual(result.recommended_commands, ["git diff --check"]);
  assert.equal(result.full_gate_required, true);
});

test("all local feedback areas preserve unique commands and the full release gate", (t) => {
  const worktree = fixture(t);
  for (const path of [
    "apps/web/features/conversations/fixture.ts",
    "apps/web/features/attachments/fixture.ts",
    "apps/web/features/offline/fixture.ts",
    "apps/web/components/fixture.ts",
    "apps/api/fixture.py",
    "deploy/fixture.yml",
    "docs/untracked.md",
    "scripts/untracked.mjs",
    "unclassified.txt",
  ]) worktree.write(path, "Synthetic classification fixture.\n");
  const result = worktree.run();
  assert.equal(result.changed_files, 9);
  assert.deepEqual(result.areas,
    ["api", "attachments", "deployment", "docs", "offline", "other", "reader", "tooling", "web"]);
  assert.deepEqual([...result.recommended_commands].sort(), [
    "corepack pnpm --filter web build",
    "corepack pnpm --filter web test:pwa --grep Reader",
    "corepack pnpm --filter web test:pwa --grep attachment",
    "corepack pnpm --filter web test:pwa --grep offline",
    "corepack pnpm run lint && corepack pnpm run typecheck",
    "corepack pnpm run test:api",
    "git diff --check",
  ].sort());
  assert.equal(new Set(result.recommended_commands).size, result.recommended_commands.length);
  assert.equal(result.full_gate_required, true);
  assert.match(result.note, /complete quality gate/i);
});

test("an invalid Git revision returns an error rather than a release bypass", (t) => {
  const worktree = fixture(t);
  const result = worktree.capture("--base", "synthetic-missing-revision", "--head", "HEAD");
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unable to inspect changed files:/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.full_gate_required, true);
  assert.equal(report.changed_files, 0);
  assert.deepEqual(report.areas, []);
  assert.equal(worktree.git("status", "--porcelain"), "");
});
