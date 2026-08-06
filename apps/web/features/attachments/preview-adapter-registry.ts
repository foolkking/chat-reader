export type AttachmentPreviewKind = "image" | "text" | "pdf" | "audio" | "video" | "complex" | "download";

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "text/csv",
  "text/markdown",
  "text/plain",
]);
const COMPLEX_MIME_TYPES = new Set([
  "application/epub+zip",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
]);
const complexPreviewOrigin = process.env.NEXT_PUBLIC_ATTACHMENT_PREVIEW_ORIGIN?.replace(/\/$/, "");
const complexPreviewEnabled = process.env.NEXT_PUBLIC_COMPLEX_ATTACHMENT_PREVIEW_ENABLED === "true" && Boolean(complexPreviewOrigin);

export function resolveAttachmentPreviewKind(mimeType: string): AttachmentPreviewKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (TEXT_MIME_TYPES.has(mime) || mime.startsWith("text/")) return "text";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (complexPreviewEnabled && COMPLEX_MIME_TYPES.has(mime)) return "complex";
  return "download";
}

export function buildComplexPreviewUrl(contentUrl: string, mimeType: string): string | null {
  if (!complexPreviewEnabled || !complexPreviewOrigin || typeof window === "undefined") return null;
  const source = new URL(contentUrl, window.location.origin).toString();
  const params = new URLSearchParams({ source, mime: mimeType });
  return `${complexPreviewOrigin}/attachment?${params.toString()}`;
}
