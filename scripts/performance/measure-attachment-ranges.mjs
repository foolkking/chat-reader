#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { performance } from "node:perf_hooks";

const RANGE_END = 8 * 1024 * 1024 - 1;

function usage() {
  console.error("Usage: node measure-attachment-ranges.mjs --manifest <json> [--output <json>]");
  process.exitCode = 2;
}

function argumentsFor(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--manifest" || value === "--output") {
      const next = argv[index + 1];
      if (!next) return null;
      options[value.slice(2)] = next;
      index += 1;
    } else {
      return null;
    }
  }
  return options.manifest ? options : null;
}

function percentile(values, rank) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1)];
}

function safeNumber(value, fallback, minimum = 0, maximum = 10) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}

async function measureEntry(entry) {
  const mediaType = typeof entry.media_type === "string" && entry.media_type.trim() ? entry.media_type.trim() : "unknown";
  const attempts = safeNumber(entry.retries, 0);
  const durations = [];
  let bytes = 0;
  let failures = 0;
  let successfulAttempt = null;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const url = new URL(entry.url);
    if (attempt > 0) url.searchParams.set("viewer_retry", String(attempt));
    const started = performance.now();
    try {
      const response = await fetch(url, { headers: { Range: `bytes=0-${RANGE_END}` }, cache: "no-store" });
      const body = new Uint8Array(await response.arrayBuffer());
      durations.push(performance.now() - started);
      if (!response.ok || (response.status !== 200 && response.status !== 206)) throw new Error(`HTTP ${response.status}`);
      bytes += body.byteLength;
      successfulAttempt = attempt;
      break;
    } catch {
      failures += 1;
    }
  }

  return { mediaType, attempts: attempts + 1, failures, successfulAttempt, bytes, durations };
}

export async function measureAttachmentRanges(manifest) {
  if (!Array.isArray(manifest)) throw new Error("Attachment range manifest must be an array.");
  const entries = await Promise.all(manifest.map(measureEntry));
  const grouped = new Map();
  for (const entry of entries) {
    const current = grouped.get(entry.mediaType) ?? { media_type: entry.mediaType, entries: 0, requests: 0, failures: 0, bytes: 0, durations_ms: [], retry_successes: 0 };
    current.entries += 1;
    current.requests += entry.attempts;
    current.failures += entry.failures;
    current.bytes += entry.bytes;
    current.durations_ms.push(...entry.durations);
    if (entry.successfulAttempt && entry.successfulAttempt > 0) current.retry_successes += 1;
    grouped.set(entry.mediaType, current);
  }
  return [...grouped.values()].map((group) => ({
    media_type: group.media_type,
    entries: group.entries,
    requests: group.requests,
    failures: group.failures,
    retry_successes: group.retry_successes,
    bytes: group.bytes,
    p50_ms: percentile(group.durations_ms, 0.5),
    p95_ms: percentile(group.durations_ms, 0.95),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = argumentsFor(process.argv);
  if (!options) {
    usage();
  } else {
    try {
      const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
      const report = {
        schema_version: 1,
        range_bytes: RANGE_END + 1,
        generated_at: new Date().toISOString(),
        media_types: await measureAttachmentRanges(manifest),
      };
      const output = JSON.stringify(report, null, 2) + "\n";
      if (options.output) await writeFile(options.output, output, "utf8");
      else process.stdout.write(output);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
