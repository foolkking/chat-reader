import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./image-base-sources.sh", import.meta.url)).replaceAll("\\", "/");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const tempRoot = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
assert.ok(process.env.RUNNER_TEMP || process.env.TEMP, "Use the explicit task temporary directory");
if (process.platform === "win32") {
  assert.match(tempRoot.toLowerCase().replaceAll("\\", "/"), /^c:\/users\/86182\/desktop\/wkkk\/[^/]+/);
}
const pins = {
  python: "public.ecr.aws/docker/library/python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce",
  node: "public.ecr.aws/docker/library/node:22.13.1-alpine@sha256:e2b39f7b64281324929257d0f8004fb6cb4bf0fdfb9aa8cedb235a766aec31da",
};
const fallback = source => source.replace("public.ecr.aws/docker/", "docker.io/");

// Execute the actual shell; all Docker/timeout/sleep calls are controlled
// functions. No daemon, registry, real wait, build or production path is used.
const harness = `
python_pulls=0
node_pulls=0
exec 3>&2
docker() {
  printf 'DOCKER %s\\n' "$*" >&3
  case "$1" in
    pull)
      local source="\${*: -1}" mode pulls
      if [[ "$source" == */python:* ]]; then
        python_pulls=$((python_pulls + 1)); pulls="$python_pulls"; mode="$MOCK_PYTHON"
      else
        node_pulls=$((node_pulls + 1)); pulls="$node_pulls"; mode="$MOCK_NODE"
      fi
      case "$mode" in
        primary) return 0 ;;
        retry) test "$pulls" -gt 1 ;;
        fallback) [[ "$source" == docker.io/* ]] ;;
        fallback-retry) [[ "$source" == docker.io/* && "$pulls" -gt 4 ]] ;;
        none) return 1 ;;
        *) return 99 ;;
      esac ;;
    image)
      [[ "$2" == inspect ]] || return 99
      [[ "$MOCK_INSPECT" == ok ]] || return 1
      printf '%s\\n' "$MOCK_PLATFORM" ;;
    *) echo 'Unexpected Docker operation' >&2; return 99 ;;
  esac
}
sleep() { printf 'SLEEP %s\\n' "$*" >&2; }
timeout() {
  [[ "$1" == --kill-after=10s && "$2" == 60s ]] || return 99
  shift 2
  [[ "$MOCK_TIMEOUT" == no ]] || return 124
  "$@"
}
script="$1"; shift
source "$script" "$@"
`;

function run(env = {}, args = []) {
  const directory = mkdtempSync(join(tempRoot, "image-base-test-"));
  const envFile = join(directory, "github-env");
  const shellEnvFile = process.platform === "win32"
    ? `/c/${envFile.slice(3).replaceAll("\\", "/")}`
    : envFile;
  const original = "EXISTING=value\n";
  writeFileSync(envFile, original);
  try {
    const result = spawnSync(bash, ["-s", "--", script, ...args], {
      input: harness,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        GITHUB_ACTIONS: "true", GITHUB_JOB: "build-images", GITHUB_RUN_ID: "101",
        GITHUB_ENV: shellEnvFile,
        PYTHON_BASE_IMAGE: pins.python, NODE_BASE_IMAGE: pins.node,
        MOCK_PYTHON: "primary", MOCK_NODE: "primary", MOCK_PLATFORM: "linux/amd64",
        MOCK_INSPECT: "ok", MOCK_TIMEOUT: "no",
        ...env,
      },
    });
    assert.ifError(result.error);
    return { ...result, env: readFileSync(envFile, "utf8"),
      calls: result.stderr.split(/\r?\n/).filter(line => line.startsWith("DOCKER ")), original };
  } finally {
    // These are the only two created paths; no recursive workspace cleanup.
    unlinkSync(envFile);
    rmdirSync(directory);
  }
}

test("both primary pins are pulled, platform-checked and published without changing any digest", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, Object.values(pins).flatMap(pin => [
    `DOCKER pull --platform linux/amd64 ${pin}`,
    `DOCKER image inspect --format {{.Os}}/{{.Architecture}} ${pin}`,
  ]));
  assert.equal(result.env, `${result.original}PYTHON_BASE_IMAGE=${pins.python}\nNODE_BASE_IMAGE=${pins.node}\n`);
});

test("a transient failure retries the same immutable official source", () => {
  const result = run({ MOCK_PYTHON: "retry" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(call => call.includes("pull") && call.endsWith(pins.python)).length, 2);
  assert.ok(!result.calls.some(call => call.includes("docker.io/")));
  assert.match(result.stderr, /SLEEP 2/);
});

for (const [name, env] of [
  ["Python", { MOCK_PYTHON: "fallback" }],
  ["Node", { MOCK_NODE: "fallback" }],
  ["both", { MOCK_PYTHON: "fallback", MOCK_NODE: "fallback" }],
]) {
  test(`${name} ECR exhaustion falls back to the identical Docker Hub digest`, () => {
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    for (const [repository, pin] of Object.entries(pins)) {
      const useFallback = env[`MOCK_${repository.toUpperCase()}`] === "fallback";
      const pulls = result.calls.filter(call => call.startsWith("DOCKER pull") && call.includes(`/${repository}:`));
      assert.deepEqual(pulls, useFallback ? [
        ...Array(3).fill(`DOCKER pull --platform linux/amd64 ${pin}`),
        `DOCKER pull --platform linux/amd64 ${fallback(pin)}`,
      ] : [`DOCKER pull --platform linux/amd64 ${pin}`]);
      assert.ok(result.env.includes(`${repository.toUpperCase()}_BASE_IMAGE=${useFallback ? fallback(pin) : pin}\n`));
    }
  });
}

test("a transient fallback failure is also bounded and retried", () => {
  const result = run({ MOCK_PYTHON: "fallback-retry" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(call => call.startsWith("DOCKER pull") && call.endsWith(fallback(pins.python))).length, 2);
});

for (const repository of ["PYTHON", "NODE"]) {
  test(`both ${repository} sources failing cannot publish a partial build environment`, () => {
    const result = run({ [`MOCK_${repository}`]: "none" });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.filter(call => call.startsWith("DOCKER pull") && call.includes(`/${repository.toLowerCase()}:`)).length, 6);
    assert.equal(result.env, result.original);
    assert.match(result.stderr, /Both pinned official base sources failed/);
  });
}

for (const env of [
  { PYTHON_BASE_IMAGE: "python:3.11-slim" },
  { NODE_BASE_IMAGE: "public.ecr.aws/docker/library/node:latest" },
  { PYTHON_BASE_IMAGE: pins.node },
  { NODE_BASE_IMAGE: pins.node.replace("public.ecr.aws", "untrusted.invalid") },
  { PYTHON_BASE_IMAGE: `${pins.python}\nINJECT=value` },
  { PYTHON_BASE_IMAGE: pins.python.replace(/.$/, "g") },
  { GITHUB_ACTIONS: "" }, { GITHUB_JOB: "production" },
  { GITHUB_RUN_ID: "invalid" }, { GITHUB_ENV: "" },
]) {
  test(`invalid pin/CI context is rejected before any Docker call: ${JSON.stringify(env)}`, () => {
    const result = run(env);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.equal(result.env, result.original);
  });
}

test("unexpected CLI arguments cannot change the selected image sources", () => {
  const result = run({}, ["untrusted"]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

for (const env of [{ MOCK_PLATFORM: "linux/arm64" }, { MOCK_PLATFORM: "windows/amd64" }, { MOCK_INSPECT: "failed" }]) {
  test(`unverifiable platform fails closed without publishing or selecting another pin: ${JSON.stringify(env)}`, () => {
    const result = run(env);
    assert.notEqual(result.status, 0);
    assert.equal(result.env, result.original);
    assert.equal(result.calls.filter(call => call.startsWith("DOCKER pull")).length, 1);
  });
}

test("hung pulls exhaust only the bounded attempts and publish nothing", () => {
  const result = run({ MOCK_TIMEOUT: "yes" });
  assert.notEqual(result.status, 0);
  assert.equal(result.env, result.original);
  assert.deepEqual(result.calls, []);
  assert.equal((result.stderr.match(/Official base pull failed/g) ?? []).length, 6);
});
