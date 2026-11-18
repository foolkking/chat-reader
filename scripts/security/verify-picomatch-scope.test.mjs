import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectRuntimeSources, NEXT_PATTERN_SOURCES, verifyPicomatchScope } from "./verify-picomatch-scope.mjs";

const advisory = {
  github_advisory_id: "GHSA-fc5q-39xc-vjpf",
  module_name: "picomatch",
  severity: "high",
  vulnerable_versions: "<=4.0.7",
  patched_versions: "<0.0.0",
  findings: [
    {
      version: "2.3.2",
      paths: [
        "apps\\web > tailwindcss@3.4.19 > fast-glob@3.3.3 > micromatch@4.0.8 > picomatch@2.3.2",
      ],
    },
    {
      version: "4.0.5",
      paths: [
        "apps\\web > typescript-eslint@8.63.0 > @typescript-eslint/parser@8.63.0 > tinyglobby@0.2.17 > picomatch@4.0.5",
      ],
    },
  ],
};

const input = () => ({
  audit: { advisories: { picomatch: structuredClone(advisory) } },
  productionTree: [{ name: "web", dependencies: { next: { name: "next", version: "16.4.5" } } }],
  webPackage: {
    dependencies: { next: "16.4.5" },
    devDependencies: { tailwindcss: "3.4.19", "typescript-eslint": "8.63.0" },
  },
  exceptions: {
    exceptions: [{
      advisory_id: "GHSA-fc5q-39xc-vjpf",
      package: "picomatch",
      disposition: "EXPLICIT_TEMPORARY_EXCEPTION",
      evidence: "scripts/security/verify-picomatch-scope.mjs",
    }],
  },
  runtimeSources: [{ file: "apps/web/app/page.tsx", source: "export default function Page() { return null; }" }],
  nextPatternEvidence: { ...NEXT_PATTERN_SOURCES },
});

test("accepts the reviewed dev-only dependency paths when absent from the production tree", () => {
  const result = verifyPicomatchScope(input());
  assert.equal(result.status, "verified-audited-dev-only-and-bundled-static-patterns");
  assert.equal(result.production_instances, 0);
  assert.equal(result.audit_paths, 2);
});

test("rejects missing production evidence and changed bundled/configuration sources", () => {
  for (const tree of [null, [], [{}]]) {
    assert.throws(() => verifyPicomatchScope({ ...input(), productionTree: tree }), /production dependency tree/);
  }
  const stale = input();
  stale.productionTree[0].dependencies.next.version = "16.4.1";
  assert.throws(() => verifyPicomatchScope(stale), /runtime reachability/);
  for (const file of Object.keys(NEXT_PATTERN_SOURCES)) {
    const options = input();
    options.nextPatternEvidence[file] = "0".repeat(64);
    assert.throws(() => verifyPicomatchScope(options), /runtime reachability/);
  }
});

test("rejects direct bundled and side-effect runtime matcher imports", () => {
  for (const source of ['import "picomatch";', 'import { makeRe } from "next/dist/compiled/picomatch";',
    'export * from "micromatch";', 'const glob = import(/* split chunk */ `picomatch`);',
    'import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";']) {
    assert.throws(() => verifyPicomatchScope({ ...input(), runtimeSources: [{ file: "runtime.ts", source }] }), /Runtime source now imports/);
  }
  const options = input();
  options.runtimeSources[0].source = '// import "picomatch";';
  assert.equal(verifyPicomatchScope(options).runtime_imports, 0);
});

test("rejects picomatch anywhere in the production dependency tree", () => {
  const options = input();
  options.productionTree[0].dependencies.next.dependencies = {
    picomatch: { name: "picomatch", version: "4.0.5" },
  };
  assert.throws(() => verifyPicomatchScope(options), /present in the production dependency tree/);
});

test("rejects an audit path rooted in a production dependency", () => {
  const options = input();
  options.audit.advisories.picomatch.findings[0].paths[0] =
    "apps\\web > next@16.4.1 > picomatch@2.3.2";
  assert.throws(() => verifyPicomatchScope(options), /no longer confined/);
});

test("rejects versions outside the exact reviewed lockfile set", () => {
  const options = input();
  options.audit.advisories.picomatch.findings[0].version = "2.3.3";
  assert.throws(() => verifyPicomatchScope(options), /Unexpected audited picomatch version/);
});

test("rejects direct runtime imports of glob matchers", () => {
  const options = input();
  options.runtimeSources = [{ file: "apps/web/lib/runtime.ts", source: 'import picomatch from "picomatch";' }];
  assert.throws(() => verifyPicomatchScope(options), /Runtime source now imports/);
});

test("rejects a general or unverifiable exception", () => {
  const options = input();
  options.exceptions.exceptions[0].evidence = "README.md";
  assert.throws(() => verifyPicomatchScope(options), /exact automated, time-limited scope exception/);
});

test("accepts Linux audit paths but rejects an empty source inventory or a new upstream fix", () => {
  const options = input();
  for (const finding of options.audit.advisories.picomatch.findings) {
    finding.paths = finding.paths.map(value => value.replaceAll("\\", "/"));
  }
  assert.equal(verifyPicomatchScope(options).audit_paths, 2);
  for (const runtimeSources of [undefined, [], null, [{}]]) {
    assert.throws(() => verifyPicomatchScope({ ...options, runtimeSources }), /runtime source inventory/);
  }
  options.audit.advisories.picomatch.patched_versions = ">=4.0.8";
  assert.throws(() => verifyPicomatchScope(options), /upstream fix range changed/);
  const changed = input();
  changed.audit.advisories.picomatch.vulnerable_versions = "*";
  assert.throws(() => verifyPicomatchScope(changed), /affected range/);
});

test("collects actual Pages Router, public scripts, root and src entry points", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "picomatch-runtime-control-"));
  const sources = ["app/page.tsx", "pages/api/route.ts", "proxy.ts", "instrumentation.ts",
    "public/worker.js", "src/app/page.jsx", "lib/utility.cjs", "lib/module.mts", "lib/common.cts", "types/models.d.ts"];
  for (const directory of ["docs", "e2e", "e2e-release-f-csp", "node_modules", "test-results", ".next", ".next-pwa-negative", ".next-ux-release-settings"]) {
    fs.mkdirSync(path.join(root, "apps/web", directory), { recursive: true });
  }
  for (const file of sources) {
    const full = path.join(root, "apps/web", file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file === "pages/api/route.ts" ? 'import("picomatch");' : "export const safe = true;");
  }
  const runtimeSources = collectRuntimeSources(root);
  assert.deepEqual(runtimeSources.map(({ file }) => file.replaceAll("\\", "/")).sort(),
    sources.map(file => `apps/web/${file}`).sort());
  assert.throws(() => verifyPicomatchScope({ ...input(), runtimeSources }), /Runtime source now imports/);
  fs.mkdirSync(path.join(root, "apps/web/server"));
  assert.throws(() => collectRuntimeSources(root), /Unreviewed Web source directory/);
});
