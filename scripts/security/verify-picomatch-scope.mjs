import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ADVISORY_ID = "GHSA-fc5q-39xc-vjpf";
const EXPECTED_VERSIONS = new Set(["2.3.2", "4.0.5"]);
const ALLOWED_DEV_ROOTS = new Set(["tailwindcss", "typescript-eslint"]);
const EXPECTED_EVIDENCE = "scripts/security/verify-picomatch-scope.mjs";
const REVIEWED_NEXT = "16.4.5";
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
// Next also vendors this matcher; pnpm's production tree alone cannot prove
// runtime non-reachability. Bind the reviewed static image-pattern call sites.
export const NEXT_PATTERN_SOURCES = Object.freeze({
  "apps/web/next.config.mjs": "49d6c2bf6dee9aff4d7f3bc12cf3ac959a40f41c891b276fe78746e2a1a69803",
  "apps/web/node_modules/next/dist/compiled/picomatch/index.js": "607dc79784c1161c33076903769dba23e63d9d9ccfe3c4695a32ebe3a5ab892d",
  "apps/web/node_modules/next/dist/shared/lib/match-remote-pattern.js": "badb6bbe2005556fcb6ed70e39b2327475bf6da0e7ac5ccf32e9983e5ee18c20",
  "apps/web/node_modules/next/dist/shared/lib/match-local-pattern.js": "cc23677cf4fc74d286018f8d5f045e51e443942f3856c3f050d5ba911e3333f4",
  "apps/web/node_modules/next/dist/shared/lib/image-config.js": "09c02c6af29186533555a17d6ab67dcb0ef508d3e4d1157c392e41444dafa415",
});

export function collectNextPatternEvidence(root) {
  return Object.fromEntries(Object.keys(NEXT_PATTERN_SOURCES).map(file => [file,
    createHash("sha256").update(fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n")).digest("hex")]));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function packageNameAndVersion(value) {
  const separator = value.lastIndexOf("@");
  return separator > 0 ? [value.slice(0, separator), value.slice(separator + 1)] : [value, ""];
}

function productionPicomatchInstances(tree) {
  if (!Array.isArray(tree) || tree.length !== 1 || tree[0]?.name !== "web" || !tree[0]?.dependencies?.next) {
    throw new Error("Missing or unexpected Web production dependency tree.");
  }
  const found = [];
  const visit = (node, fallbackName, chain) => {
    if (!node || typeof node !== "object") return;
    const name = typeof node.name === "string" ? node.name : fallbackName;
    const version = typeof node.version === "string" ? node.version : "";
    if (name === "picomatch") found.push({ version, chain: [...chain, `${name}@${version}`] });
    for (const [childName, child] of Object.entries({ ...node.dependencies, ...node.optionalDependencies })) {
      visit(child, childName, [...chain, `${name}@${version}`]);
    }
  };
  visit(tree[0], "web", []);
  return found;
}

function sourceImportsMatcher(source) {
  // Use the locked Web compiler's import scanner: comments are not imports,
  // and multiline re-exports and literal dynamic imports are real edges.
  const ts = requireWeb("typescript");
  return ts.preProcessFile(source, true, true).importedFiles.some(({ fileName }) =>
    /^(?:next\/dist\/compiled\/)?(?:picomatch|micromatch|fast-glob|tinyglobby|chokidar)(?:\/|$)/.test(fileName)
    || /^next\/dist\/(?:esm\/)?shared\/lib\/match-(?:local|remote)-pattern(?:\.js)?$/.test(fileName));
}

export function verifyPicomatchScope({ audit, productionTree, webPackage, exceptions, runtimeSources = [], nextPatternEvidence }) {
  const findings = Object.values(audit?.advisories ?? {}).filter(
    (item) => item.module_name === "picomatch" && item.github_advisory_id === ADVISORY_ID,
  );

  if (findings.length === 0) return { status: "no-current-advisory", advisory_id: ADVISORY_ID };
  if (findings.length !== 1) throw new Error(`Expected one ${ADVISORY_ID} advisory, found ${findings.length}.`);

  const finding = findings[0];
  if (finding.severity !== "high" || finding.patched_versions !== "<0.0.0" || finding.vulnerable_versions !== "<=4.0.7") {
    throw new Error("The advisory severity, affected range or upstream fix range changed; review the exception before proceeding.");
  }

  const versions = new Set();
  let pathCount = 0;
  for (const item of finding.findings ?? []) {
    if (!EXPECTED_VERSIONS.has(item.version)) {
      throw new Error(`Unexpected audited picomatch version: ${item.version}.`);
    }
    versions.add(item.version);
    if (!Array.isArray(item.paths) || item.paths.length === 0) {
      throw new Error(`The audit did not provide dependency paths for picomatch ${item.version}.`);
    }
    for (const rawPath of item.paths) {
      const segments = String(rawPath).replaceAll("\\", "/").split(/\s*>\s*/);
      if (segments[0] !== "apps/web") throw new Error(`Unexpected workspace in audit path: ${rawPath}`);
      const [rootName] = packageNameAndVersion(segments[1] ?? "");
      if (!ALLOWED_DEV_ROOTS.has(rootName)) {
        throw new Error(`picomatch is no longer confined to reviewed development tools: ${rawPath}`);
      }
      const [leafName, leafVersion] = packageNameAndVersion(segments.at(-1) ?? "");
      if (leafName !== "picomatch" || leafVersion !== item.version) {
        throw new Error(`Audit path does not terminate at its reported picomatch version: ${rawPath}`);
      }
      pathCount++;
    }
  }

  if (versions.size !== EXPECTED_VERSIONS.size || [...EXPECTED_VERSIONS].some((version) => !versions.has(version))) {
    throw new Error(`Audited versions changed: ${[...versions].sort().join(", ")}.`);
  }
  for (const rootName of ALLOWED_DEV_ROOTS) {
    if (!webPackage.devDependencies?.[rootName] || webPackage.dependencies?.[rootName]) {
      throw new Error(`${rootName} is no longer an exclusively development dependency.`);
    }
  }
  if (webPackage.dependencies?.picomatch || webPackage.devDependencies?.picomatch) {
    throw new Error("picomatch became a direct dependency; the current scope review no longer applies.");
  }

  const shipped = productionPicomatchInstances(productionTree);
  if (shipped.length) {
    throw new Error(`picomatch is present in the production dependency tree: ${JSON.stringify(shipped)}.`);
  }
  if (webPackage.dependencies?.next !== REVIEWED_NEXT ||
      productionTree[0].dependencies.next.version !== REVIEWED_NEXT ||
      Object.entries(NEXT_PATTERN_SOURCES).some(([file, sha]) => nextPatternEvidence?.[file] !== sha)) {
    throw new Error("Next bundled matcher or static pattern configuration changed; review runtime reachability.");
  }

  if (!Array.isArray(runtimeSources) || runtimeSources.length === 0 || runtimeSources.some(
    (item) => !item || typeof item.file !== "string" || !item.file || typeof item.source !== "string",
  )) {
    throw new Error("Missing or invalid runtime source inventory.");
  }
  const imports = runtimeSources.filter(({ source }) => sourceImportsMatcher(source)).map(({ file }) => file);
  if (imports.length) {
    throw new Error(`Runtime source now imports a vulnerable glob matcher: ${imports.join(", ")}.`);
  }

  const matchingExceptions = (exceptions?.exceptions ?? []).filter(
    (item) => item.advisory_id === ADVISORY_ID && item.package === "picomatch",
  );
  if (matchingExceptions.length !== 1) {
    throw new Error(`Expected exactly one scoped exception for ${ADVISORY_ID}; found ${matchingExceptions.length}.`);
  }
  const exception = matchingExceptions[0];
  if (exception.disposition !== "EXPLICIT_TEMPORARY_EXCEPTION" || exception.evidence !== EXPECTED_EVIDENCE) {
    throw new Error("The advisory must use the exact automated, time-limited scope exception.");
  }

  return {
    status: "verified-audited-dev-only-and-bundled-static-patterns",
    advisory_id: ADVISORY_ID,
    versions: [...versions].sort(),
    reviewed_dev_roots: [...ALLOWED_DEV_ROOTS].sort(),
    audit_paths: pathCount,
    production_instances: 0,
    runtime_imports: 0,
    bundled_next_matcher: "present; reviewed image helpers use fixed configuration patterns, not request-supplied globs",
    next_pattern_source_sha256: nextPatternEvidence,
  };
}

export function collectRuntimeSources(root) {
  const files = [];
  const webRoot = path.join(root, "apps", "web");
  const add = (fullPath) => {
    if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(fullPath)) {
      files.push({ file: path.relative(root, fullPath), source: fs.readFileSync(fullPath, "utf8") });
    }
  };
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else add(fullPath);
    }
  };
  // Pages Router API handlers and proxy/instrumentation entry points are also
  // shipped code, even when most of the application uses the App Router.
  const sourceDirectories = new Set(["app", "pages", "src", "components", "features", "lib", "public", "types"]);
  const nonRuntimeDirectories = new Set(["docs", "e2e", "e2e-release-f-csp", "e2e-release-f-production",
    "node_modules", "test-results", ".next", ".next-pwa-negative", ".next-ux-release-settings",
    ".turbo", "coverage", "playwright-report"]);
  for (const entry of fs.readdirSync(webRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (sourceDirectories.has(entry.name)) visit(path.join(webRoot, entry.name));
    else if (!nonRuntimeDirectories.has(entry.name)) throw new Error(`Unreviewed Web source directory: ${entry.name}.`);
  }
  for (const entry of fs.readdirSync(webRoot, { withFileTypes: true })) {
    if (entry.isFile()) add(path.join(webRoot, entry.name));
  }
  return files;
}

function main() {
  const [auditPath, productionTreePath, webPackagePath, exceptionsPath] = process.argv.slice(2);
  if (!auditPath || !productionTreePath || !webPackagePath || !exceptionsPath) {
    console.error("Usage: node scripts/security/verify-picomatch-scope.mjs <audit.json> <production-tree.json> <web-package.json> <exceptions.json>");
    process.exit(2);
  }
  const repoRoot = process.cwd();
  const report = verifyPicomatchScope({
    audit: readJson(auditPath),
    productionTree: readJson(productionTreePath),
    webPackage: readJson(webPackagePath),
    exceptions: readJson(exceptionsPath),
    runtimeSources: collectRuntimeSources(repoRoot),
    nextPatternEvidence: collectNextPatternEvidence(repoRoot),
  });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`picomatch scope verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
