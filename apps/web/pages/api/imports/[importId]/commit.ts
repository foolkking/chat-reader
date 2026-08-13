import process from "node:process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { NextApiRequest, NextApiResponse } from "next";

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const UPSTREAM_TIMEOUT_MS = 300_000;

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(request: NextApiRequest, response: NextApiResponse): Promise<void> {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-chat-reader-proxy", "import-commit-route");

  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    response.status(405).json({ detail: "Method not allowed." });
    return;
  }

  const importId = Array.isArray(request.query.importId) ? request.query.importId[0] : request.query.importId;
  if (!importId) {
    response.status(400).json({ detail: "Import ID is required." });
    return;
  }

  const upstreamUrl = `${API_INTERNAL_URL}/api/imports/${encodeURIComponent(importId)}/commit`;

  try {
    const upstream = await requestImportCommit(
      upstreamUrl,
      request.headers.accept ?? "application/json",
    );
    const contentTypeHeader = upstream.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    if (contentType) response.setHeader("content-type", contentType);
    response.status(upstream.statusCode).send(upstream.body);
  } catch (error) {
    console.error("Import commit upstream request failed", error);
    response.status(502).json({ detail: "Import commit service is temporarily unavailable." });
  }
}

type UpstreamResponse = {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
};

function requestImportCommit(urlValue: string, accept: string): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const upstreamRequest = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "POST",
        headers: { accept },
      },
      (upstreamResponse) => {
        const chunks: Uint8Array[] = [];
        upstreamResponse.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: upstreamResponse.headers,
            statusCode: upstreamResponse.statusCode ?? 502,
          });
        });
      },
    );

    upstreamRequest.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstreamRequest.destroy(new Error("Import commit upstream request timed out."));
    });
    upstreamRequest.on("error", reject);
    upstreamRequest.end();
  });
}
