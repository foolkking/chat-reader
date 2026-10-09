import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const workflow = read(".github/workflows/build-release-images.yml");
const apiDockerfile = read("apps/api/Dockerfile");
const webDockerfile = read("apps/web/Dockerfile");

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
  test(`${name} pulls the verified immutable official PostgreSQL index`, () => {
    const imageLines = [...job(name).matchAll(/^        image: (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(imageLines, [sources.postgres]);
    assert.match(job(name), /--health-cmd "pg_isready -U chat_reader -d chat_reader"/);
  });
}

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
  assert.match(job("web-quality"), /run: node --test scripts\/ci\/release-image-sources\.test\.mjs(?:\n|$)/);
});
