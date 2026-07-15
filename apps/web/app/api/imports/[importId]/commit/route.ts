import process from "node:process";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export async function POST(
  request: NextRequest,
  { params }: { params: { importId: string } },
): Promise<Response> {
  const upstreamUrl = `${API_INTERNAL_URL}/api/imports/${encodeURIComponent(params.importId)}/commit`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
      },
      cache: "no-store",
    });

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error("Import commit upstream request failed", error);
    return Response.json(
      { detail: "Import commit service is temporarily unavailable." },
      { status: 502 },
    );
  }
}
