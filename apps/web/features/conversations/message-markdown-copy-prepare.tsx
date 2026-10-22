"use client";

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { richMarkdownRemarkPlugins } from "../rich-markdown/rich-markdown-config";
import type { MessageMarkdownCopyPlan } from "../../lib/api";
import { createMessageCopyProbe } from "./message-markdown-copy-source";

/** Render the existing parser to a detached empty root, not the visible Reader. */
export async function analyseMessageCopy(plan: MessageMarkdownCopyPlan) {
  const probe = createMessageCopyProbe(plan);
  return new Promise<ReturnType<typeof probe.result>>((resolve, reject) => {
    const root = createRoot(document.createDocumentFragment(), {
      onUncaughtError: error => { queueMicrotask(() => root.unmount()); reject(error); },
    });
    let result: ReturnType<typeof probe.result> | undefined, error: unknown;
    const capture = () => (tree: Parameters<ReturnType<typeof probe.plugin>>[0]) => {
      try { probe.plugin()(tree); result = probe.result(); } catch (caught) { error = caught; tree.children = []; }
    };
    function Parser() {
      useEffect(() => {
        queueMicrotask(() => {
          root.unmount();
          if (error || !result) reject(error ?? new Error("COPY_SOURCE_UNAVAILABLE"));
          else resolve(result);
        });
      }, []);
      return <ReactMarkdown remarkPlugins={richMarkdownRemarkPlugins([capture])} skipHtml>{plan.markdown}</ReactMarkdown>;
    }
    root.render(<Parser />);
  });
}

const MAX_SVG_BYTES = 2 * 1024 * 1024;

/** SVG is loaded only as an image in an opaque Blob. No SVG node enters live DOM.
 * Reject external resources/active structures before decode; PNG upload is
 * independently decoded and re-encoded by the server. */
export async function rasterizeCopySvg(contentUrl: string, signal: AbortSignal): Promise<Blob> {
  if (!/^\/api\/attachments\/[a-f\d-]{36}\/content$/.test(contentUrl)) throw new Error("COPY_IMAGE_UNAVAILABLE");
  const response = await fetch(contentUrl, { signal, cache: "no-store", credentials: "same-origin" });
  if (!response.ok || !response.body) throw new Error("COPY_IMAGE_UNAVAILABLE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SVG_BYTES) throw new Error("COPY_SVG_UNSAFE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const safe = safeCopySvg(source);
  const blobUrl = URL.createObjectURL(new Blob([safe], { type: "image/svg+xml" }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); signal.removeEventListener("abort", aborted);
        image.onload = null; image.onerror = null;
        if (error) { image.src = ""; reject(error); } else resolve();
      };
      const aborted = () => finish(new Error("COPY_CANCELLED"));
      const timer = setTimeout(() => finish(new Error("COPY_SVG_UNSAFE")), 10_000);
      image.onload = () => finish();
      image.onerror = () => finish(new Error("COPY_SVG_UNSAFE"));
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      image.src = blobUrl;
    });
    if (signal.aborted) throw new Error("COPY_CANCELLED");
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 4096 || height > 4096 || width * height > 4_000_000) throw new Error("COPY_SVG_UNSAFE");
    const scale = Math.min(1, 1600 / width, 1600 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("COPY_SVG_UNSAFE");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        blob => blob && blob.size <= 4 * 1024 * 1024 ? resolve(blob) : reject(new Error("COPY_SVG_UNSAFE")), "image/png",
      ));
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { image.src = ""; URL.revokeObjectURL(blobUrl); }
}

export function safeCopySvg(source: string): string {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error("COPY_SVG_UNSAFE");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || svg.namespaceURI !== "http://www.w3.org/2000/svg" || document.querySelector("parsererror")) {
    throw new Error("COPY_SVG_UNSAFE");
  }
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  if (elements.length > 10_000) throw new Error("COPY_SVG_UNSAFE");
  for (const element of elements) {
    if (element.namespaceURI !== svg.namespaceURI || /^(script|foreignObject|iframe|object|embed|animate|animateMotion|animateTransform|set|image|feImage|a|filter)$/i.test(element.localName)) {
      throw new Error("COPY_SVG_UNSAFE");
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "xmlns" && attribute.value === "http://www.w3.org/2000/svg"
        || attribute.name === "xmlns:xlink" && attribute.value === "http://www.w3.org/1999/xlink") continue;
      if (/^on/i.test(attribute.name) || /^(href|src|base)$/i.test(attribute.localName) && !attribute.value.startsWith("#")
        || /(?:@import|@font-face|javascript:|data:|https?:|file:|\/\/|\\)/i.test(attribute.value)
        || Array.from(attribute.value.matchAll(/url\s*\(([^)]*)\)/gi)).some(match => !/^\s*["']?#[\w:.-]+["']?\s*$/.test(match[1]))) {
        throw new Error("COPY_SVG_UNSAFE");
      }
    }
    if (element.localName === "style") {
      const css = element.textContent ?? "";
      if (/(?:@|javascript:|data:|https?:|file:|\/\/|\\|\/\*)/i.test(css)
        || Array.from(css.matchAll(/url\s*\(([^)]*)\)/gi)).some(match => !/^\s*["']?#[\w:.-]+["']?\s*$/.test(match[1]))) {
        throw new Error("COPY_SVG_UNSAFE");
      }
    }
  }
  const rawWidth = svg.getAttribute("width"), rawHeight = svg.getAttribute("height");
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[,\s]+/).map(Number);
  if (viewBox && (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0)) {
    throw new Error("COPY_SVG_UNSAFE");
  }
  const dimension = (value: string | null, fallback: number) => value && /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? Number.parseFloat(value) : fallback;
  const width = dimension(rawWidth, viewBox?.[2] ?? 300), height = dimension(rawHeight, viewBox?.[3] ?? 150);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 4_000_000) {
    throw new Error("COPY_SVG_UNSAFE");
  }
  // Set bounded intrinsic size before the browser allocates the decoder surface.
  const scale = Math.min(1, 1600 / width, 1600 / height);
  if (!viewBox) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(Math.max(1, Math.round(width * scale))));
  svg.setAttribute("height", String(Math.max(1, Math.round(height * scale))));
  return new XMLSerializer().serializeToString(svg);
}
