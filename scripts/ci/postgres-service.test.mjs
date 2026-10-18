import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./postgres-service.sh", import.meta.url)).replaceAll("\\", "/");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const container = "a".repeat(64);
const digest = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const primary = `public.ecr.aws/docker/library/postgres:16-alpine@${digest}`;
const fallback = `docker.io/library/postgres:16-alpine@${digest}`;

// Execute the actual helper with shell functions. No test can reach a real
// Docker daemon, registry, sleep delay, user database or production filesystem.
const harness = `
pulls=0
exec 3>&2
docker() {
  printf 'DOCKER %s\\n' "$*" >&3
  case "$1" in
    pull)
      pulls=$((pulls + 1))
      case "$MOCK_PULL" in
        primary) return 0 ;;
        retry) test "$pulls" -gt 1 ;;
        fallback) [[ "\${*: -1}" == docker.io/* ]] ;;
        none) return 1 ;;
        *) return 99 ;;
      esac ;;
    run)
      test "$MOCK_RUN" = ok || return 1
      printf '%s\\n' "$MOCK_ID" ;;
    container)
      if [[ "$*" == *".State.Health.Status"* ]]; then
        test "$MOCK_HEALTH" != error || return 1
        printf '%s\\n' "$MOCK_HEALTH"
      elif [[ "$*" == *".Config.Labels"* ]]; then
        test "$MOCK_EXISTS" = 1 || return 1
        printf '%s %s\\n' "$MOCK_ID" "$MOCK_OWNER"
      else
        test "$MOCK_EXISTS" = 1
      fi ;;
    logs|rm) return 0 ;;
    *) echo "Unexpected Docker operation" >&2; return 99 ;;
  esac
}
sleep() { printf 'SLEEP %s\\n' "$*" >&2; }
timeout() {
  test "$1" = --kill-after=10s && test "$2" = 60s || return 99
  shift 2
  "$@"
}
source "$@"
`;

function run(action = "start", env = {}) {
  const result = spawnSync(bash, ["-s", "--", script, action], {
    input: harness,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      GITHUB_RUN_ID: "101",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_JOB: "web-quality",
      CI_POSTGRES_PORT: "5432",
      MOCK_PULL: "primary",
      MOCK_RUN: "ok",
      MOCK_HEALTH: "healthy",
      MOCK_EXISTS: "0",
      MOCK_ID: container,
      MOCK_OWNER: "101:2:web-quality",
      ...env,
    },
  });
  assert.ifError(result.error);
  return { ...result, calls: result.stderr.split(/\r?\n/).filter((line) => line.startsWith("DOCKER ")) };
}

test("primary success retains the exact pinned index and a healthy localhost fixture", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.filter((line) => line.startsWith("DOCKER pull")), [`DOCKER pull --platform linux/amd64 ${primary}`]);
  const start = result.calls.find((line) => line.startsWith("DOCKER run"));
  for (const expected of ["--rm --pull=never --platform linux/amd64", "--publish 127.0.0.1:5432:5432", "--label chat-reader.ci-postgres=101:2:web-quality", primary]) {
    assert.ok(start.includes(expected), start);
  }
  assert.match(result.stdout, /is healthy/);
  assert.ok(!result.calls.some((line) => line.startsWith("DOCKER rm")));
});

test("settings uses its existing guarded port", () => {
  const result = run("start", { CI_POSTGRES_PORT: "65438", GITHUB_JOB: "settings-quality" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.some((line) => line.includes("--publish 127.0.0.1:65438:5432")));
});

test("transient primary failure retries without changing registry or digest", () => {
  const result = run("start", { MOCK_PULL: "retry" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter((line) => line.startsWith("DOCKER pull")).length, 2);
  assert.ok(!result.calls.some((line) => line.includes("docker.io/")));
  assert.match(result.stderr, /SLEEP 2/);
});

test("ECR exhaustion falls back only to the same immutable Docker Official Image", () => {
  const result = run("start", { MOCK_PULL: "fallback" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.filter((line) => line.startsWith("DOCKER pull")), [
    ...Array(3).fill(`DOCKER pull --platform linux/amd64 ${primary}`),
    `DOCKER pull --platform linux/amd64 ${fallback}`,
  ]);
  assert.ok(result.calls.find((line) => line.startsWith("DOCKER run")).endsWith(fallback));
  assert.match(result.stderr, /SLEEP 4/);
});

test("both registry failures are bounded and cannot start a substitute database", () => {
  const result = run("start", { MOCK_PULL: "none" });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.filter((line) => line.startsWith("DOCKER pull")).length, 6);
  assert.ok(result.calls.filter((line) => line.startsWith("DOCKER pull")).every((line) => line.endsWith(digest)));
  assert.ok(!result.calls.some((line) => line.startsWith("DOCKER run")));
  assert.match(result.stderr, /Both pinned official PostgreSQL sources failed/);
});

for (const env of [
  { GITHUB_RUN_ID: "" }, { GITHUB_RUN_ID: "../production" },
  { GITHUB_RUN_ATTEMPT: "bad" }, { GITHUB_JOB: "job; false" },
  { CI_POSTGRES_PORT: "5433" },
]) {
  test(`invalid fixture identity/port never reaches Docker: ${JSON.stringify(env)}`, () => {
    const result = run("start", env);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
}

test("an existing name is never replaced or removed by start", () => {
  const result = run("start", { MOCK_EXISTS: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 1);
  assert.match(result.stderr, /refusing to replace/i);
});

for (const health of ["unhealthy", "error", "starting"]) {
  test(`failed readiness (${health}) cleans up only the newly created container`, () => {
    const result = run("start", { MOCK_HEALTH: health });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls.filter((line) => line.startsWith("DOCKER rm")), [`DOCKER rm --force ${container}`]);
    assert.ok(result.calls.includes(`DOCKER logs ${container}`));
    const checks = result.calls.filter((line) => line.includes(".State.Health.Status"));
    assert.equal(checks.length, health === "starting" ? 120 : 1);
    assert.doesNotMatch(result.stdout, /is healthy/);
  });
}

test("a rejected docker run never removes a container it did not create", () => {
  const result = run("start", { MOCK_RUN: "fail" });
  assert.notEqual(result.status, 0);
  assert.ok(!result.calls.some((line) => line.startsWith("DOCKER rm")));
});

test("stop removes the exact job-owned immutable container identity", () => {
  const result = run("stop", { MOCK_EXISTS: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.includes(`DOCKER logs ${container}`));
  assert.deepEqual(result.calls.filter((line) => line.startsWith("DOCKER rm")), [`DOCKER rm --force ${container}`]);
  assert.equal(result.calls.length, 3);
});

test("stop is idempotent when the fixture no longer exists", () => {
  const result = run("stop");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.ok(!result.calls.some((line) => line.startsWith("DOCKER rm")));
});

for (const env of [{ MOCK_OWNER: "another-job" }, { MOCK_ID: "untrusted-id" }]) {
  test(`stop refuses a foreign or invalid container identity: ${JSON.stringify(env)}`, () => {
    const result = run("stop", { MOCK_EXISTS: "1", ...env });
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some((line) => line.startsWith("DOCKER rm")));
  });
}

test("unknown actions are rejected before accessing Docker", () => {
  const result = run("restart");
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});
