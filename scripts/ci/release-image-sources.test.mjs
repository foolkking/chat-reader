import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const workflow = read(".github/workflows/build-release-images.yml");
const apiDockerfile = read("apps/api/Dockerfile");
const webDockerfile = read("apps/web/Dockerfile");
const postgresService = read("scripts/ci/postgres-service.sh");

// These immutable indexes were compared with Docker Hub and their amd64 configs.
// Update pins only with new same-source evidence; see CI_REGISTRY_SOURCE_2026-10-10.md.
const sources = {
  postgres: "public.ecr.aws/docker/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
  python: "public.ecr.aws/docker/library/python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce",
  node: "public.ecr.aws/docker/library/node:22.13.1-alpine@sha256:e2b39f7b64281324929257d0f8004fb6cb4bf0fdfb9aa8cedb235a766aec31da",
};

function job(name) {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing job ${name}`);
  return workflow.slice(start + marker.length).split(/\n  [a-z][a-z0-9-]*:\n/, 1)[0];
}

for (const name of ["api-quality", "web-quality", "settings-quality"]) {
  test(`${name} starts the pinned PostgreSQL fixture with bounded official-source fallback`, () => {
    const body = job(name);
    assert.doesNotMatch(body, /^    services:/m);
    assert.match(body, /id: postgres\n        timeout-minutes: 10\n        run: bash scripts\/ci\/postgres-service\.sh start/);
    assert.match(body, /if: \$\{\{ always\(\) && steps\.postgres\.outcome == 'success' \}\}\n        run: bash scripts\/ci\/postgres-service\.sh stop/);
    assert.ok(body.indexOf("actions/checkout@v4") < body.indexOf("postgres-service.sh start"));
    assert.ok(body.indexOf("postgres-service.sh start") < body.indexOf("python -m alembic upgrade head"));
  });
}

test("PostgreSQL fallback keeps the previously verified digest, health probe and ports", () => {
  const digest = sources.postgres.split("@")[1];
  assert.ok(postgresService.includes(`digest="${digest}"`));
  assert.ok(postgresService.includes('"public.ecr.aws/docker/library/postgres:16-alpine@$digest"'));
  assert.ok(postgresService.includes('"docker.io/library/postgres:16-alpine@$digest"'));
  assert.match(postgresService, /--health-cmd "pg_isready -U chat_reader -d chat_reader"/);
  assert.match(postgresService, /docker pull --platform linux\/amd64 "\$source"/);
  assert.match(postgresService, /--publish "127\.0\.0\.1:\$\{port\}:5432"/);
  assert.match(job("settings-quality"), /CI_POSTGRES_PORT: "65438"/);
  assert.doesNotMatch(postgresService, /docker (?:system|volume|network) prune|compose down/);
});

test("API base argument preserves the existing Python default", () => {
  assert.match(apiDockerfile, /^ARG PYTHON_BASE_IMAGE=python:3\.11-slim\nFROM \$\{PYTHON_BASE_IMAGE\} AS runtime\n/);
});

test("both Web base stages share the argument and preserve the existing Node default", () => {
  assert.match(webDockerfile, /^ARG NODE_BASE_IMAGE=node:22\.13\.1-alpine\nFROM \$\{NODE_BASE_IMAGE\} AS dependencies\n/);
  assert.deepEqual([...webDockerfile.matchAll(/^FROM (.+)$/gm)].map((match) => match[1]), [
    "${NODE_BASE_IMAGE} AS dependencies", "dependencies AS builder", "${NODE_BASE_IMAGE} AS runtime",
  ]);
});

for (const [argument, source] of [["PYTHON_BASE_IMAGE", sources.python], ["NODE_BASE_IMAGE", sources.node]]) {
  test(`CI passes the verified ${argument} pin to docker build`, () => {
    const build = job("build-images");
    assert.ok(build.includes(`      ${argument}: ${source}\n`));
    assert.ok(build.includes(`--build-arg ${argument}="\$\{${argument}\}"`));
  });
}

test("builder setup uses Docker's built-in driver without a BuildKit container pull", () => {
  assert.match(job("build-images"), /- uses: docker\/setup-buildx-action@v3\n        with:\n          driver: docker(?:\n|$)/);
});

test("both image builds explicitly select the accepted Linux amd64 platform", () => {
  assert.equal([...job("build-images").matchAll(/--platform linux\/amd64/g)].length, 2);
});

test("the registry source contract runs as an additive CI check", () => {
  assert.match(job("web-quality"), /run: node --test scripts\/ci\/release-image-sources\.test\.mjs scripts\/ci\/postgres-service\.test\.mjs(?:\n|$)/);
});

test("the complete API suite stays PostgreSQL-enabled, bounded and diagnosable", () => {
  assert.match(job("api-quality"), /- name: API full suite\n        timeout-minutes: 45\n/);
  assert.match(job("api-quality"), /SETTINGS_POSTGRES_INTEGRATION: "1"/);
  assert.match(job("api-quality"), /run: cd apps\/api && pytest -vv -o faulthandler_timeout=120(?:\n|$)/);
});

for (const [name, prefix] of [["web-quality", "release-a-quality-evidence"], ["settings-quality", "settings-quality-evidence"]]) {
  test(`${name} preserves separate evidence for each retry attempt`, () => {
    assert.ok(job(name).includes(`name: ${prefix}-\${{ github.sha }}-\${{ github.run_attempt }}`));
    assert.doesNotMatch(job(name), /overwrite:\s*true/);
  });
}
