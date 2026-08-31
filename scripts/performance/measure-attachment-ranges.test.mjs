import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { measureAttachmentRanges } from "./measure-attachment-ranges.mjs";

test("measures bounded ranges and retry cost by media type without retaining content", async (t) => {
  const attempts = new Map();
  const server = createServer((request, response) => {
    const mediaType = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
    const key = `${mediaType}:${request.headers.range ?? "none"}`;
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    if (mediaType === "video/mp4" && count === 1) {
      response.writeHead(503);
      response.end();
      return;
    }
    const body = Buffer.alloc(4096, 7);
    response.writeHead(206, {
      "Content-Type": mediaType,
      "Content-Range": `bytes 0-${body.length - 1}/${body.length}`,
      "Content-Length": body.length,
    });
    response.end(body);
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
  const base = `http://127.0.0.1:${address.port}`;

  const report = await measureAttachmentRanges([
    { media_type: "image/png", url: `${base}/image/png` },
    { media_type: "application/pdf", url: `${base}/application/pdf` },
    { media_type: "video/mp4", url: `${base}/video/mp4`, retries: 1 },
    { media_type: "text/plain", url: `${base}/text/plain` },
  ]);

  assert.deepEqual(report.map((entry) => entry.media_type), ["image/png", "application/pdf", "video/mp4", "text/plain"]);
  assert.equal(report.find((entry) => entry.media_type === "video/mp4")?.failures, 1);
  assert.equal(report.find((entry) => entry.media_type === "video/mp4")?.retry_successes, 1);
  assert.equal(report.find((entry) => entry.media_type === "image/png")?.bytes, 4096);
  assert.ok(report.every((entry) => typeof entry.p50_ms === "number" && typeof entry.p95_ms === "number"));
  assert.ok(!JSON.stringify(report).includes("7777777"));
});
