import process from "node:process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const UPSTREAM_TIMEOUT_MS = 300_000;

export async function POST(
  request: NextRequest,
  { params }: { params: { importId: string } },
): Promise<Response> {
  const upstreamUrl = `${API_INTERNAL_URL}/api/imports/${encodeURIComponent(params.importId)}/commit`;

  try {
    const upstream = await requestImportCommit(
      upstreamUrl,
      request.headers.get("accept") ?? "application/json",
    );

    const headers = new Headers({
      "cache-control": "no-store",
      "x-chat-reader-proxy": "import-commit-route",
    });
    const contentTypeHeader = upstream.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    if (contentType) {
      headers.set("content-type", contentType);
    }

    return new Response(upstream.body, {
      status: upstream.statusCode,
      statusText: upstream.statusMessage,
      headers,
    });
  } catch (error) {
    console.error("Import commit upstream request failed", error);
    return Response.json(
      { detail: "Import commit service is temporarily unavailable." },
      {
        status: 502,
        headers: { "x-chat-reader-proxy": "import-commit-route" },
      },
    );
  }
}

type UpstreamResponse = {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  statusMessage: string;
};

function requestImportCommit(urlValue: string, accept: string): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "POST",
        headers: { accept },
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode ?? 502,
            statusMessage: response.statusMessage ?? "Bad Gateway",
          });
        });
      },
    );

    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      request.destroy(new Error("Import commit upstream request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}
