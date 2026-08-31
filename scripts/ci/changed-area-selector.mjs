#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const outputPath = valueFor("--output");
const base = valueFor("--base");
const head = valueFor("--head");

function changedFiles() {
  const range = base && head ? [base, head] : base ? [base] : [];
  const command = range.length ? ["diff", "--name-only", ...range] : ["diff", "--name-only", "HEAD"];
  try {
    const tracked = execFileSync("git", command, { encoding: "utf8" });
    const untracked = range.length
      ? ""
      : execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
    return `${tracked}\n${untracked}`
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file, index, all) => all.indexOf(file) === index);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Unable to inspect changed files: ${detail}`);
    process.exitCode = 2;
    return [];
  }
}

const rules = [
  [/^apps\/web\/features\/conversations\//, "reader"],
  [/^apps\/web\/features\/(attachments|editing)\//, "attachments"],
  [/^apps\/web\/features\/offline\//, "offline"],
  [/^apps\/web\//, "web"],
  [/^apps\/api\//, "api"],
  [/^deploy\//, "deployment"],
  [/^docker-compose(?:\.[^/]*)?\.yml$/, "deployment"],
  [/^\.github\/workflows\//, "deployment"],
  [/^docs\//, "docs"],
  [/^scripts\//, "tooling"],
  [/^(package\.json|pnpm-lock\.yaml|tsconfig\.json)/, "tooling"],
];

const commandByArea = new Map([
  ["reader", "corepack pnpm --filter web test:pwa --grep Reader"],
  ["attachments", "corepack pnpm --filter web test:pwa --grep attachment"],
  ["offline", "corepack pnpm --filter web test:pwa --grep offline"],
  ["web", "corepack pnpm run lint && corepack pnpm run typecheck"],
  ["api", "corepack pnpm run test:api"],
  ["deployment", "git diff --check"],
  ["docs", "git diff --check"],
  ["tooling", "git diff --check"],
]);

const files = changedFiles();
const areas = new Set();
for (const file of files) {
  const rule = rules.find(([pattern]) => pattern.test(file));
  areas.add(rule?.[1] ?? "other");
}

const recommendedCommands = [...areas]
  .map((area) => commandByArea.get(area))
  .filter(Boolean);
if (areas.has("web") || areas.has("reader") || areas.has("attachments") || areas.has("offline")) {
  recommendedCommands.push("corepack pnpm --filter web build");
}

const result = {
  schema_version: 1,
  source: { base: base ?? null, head: head ?? null },
  changed_files: files.length,
  areas: [...areas].sort(),
  recommended_commands: [...new Set(recommendedCommands)],
  full_gate_required: true,
  note: "Selector is a local feedback aid; release artifacts still require the complete quality gate.",
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, serialized, "utf8");
process.stdout.write(serialized);
