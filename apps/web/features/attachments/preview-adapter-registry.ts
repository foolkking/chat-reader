export type AttachmentPreviewKind = "image" | "markdown" | "table" | "code" | "text" | "pdf" | "audio" | "video" | "complex" | "download";

const TEXT_MIME_TYPES = new Set([
  "text/plain",
]);
const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const TABLE_MIME_TYPES = new Set(["text/csv", "text/tab-separated-values"]);
const CODE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/xml",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-python-code",
  "application/x-sh",
  "application/yaml",
  "text/css",
  "text/javascript",
  "text/x-python",
  "text/x-sql",
  "text/xml",
  "text/yaml",
]);
const DOWNLOAD_ONLY_EXTENSIONS = new Set([
  "7z", "avi", "bz2", "doc", "docx", "drawio", "dxf", "epub", "gz", "mkv", "obj", "odp", "ods", "odt",
  "ppt", "pptx", "rar", "rtf", "stl", "tar", "tif", "tiff", "vsdx", "xls", "xlsx", "xz", "zip",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);
const CODE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "ini", "java", "js", "jsx", "json", "kt", "log",
  "php", "py", "rb", "rs", "sh", "sql", "srt", "toml", "ts", "tsx", "vcf", "xml", "yaml", "yml",
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

export function resolveAttachmentPreviewKind(mimeType: string, filename = ""): AttachmentPreviewKind {
  const mime = mimeType.toLowerCase();
  const extension = attachmentExtension(filename);
  if (DOWNLOAD_ONLY_EXTENSIONS.has(extension)) return "download";
  if (MARKDOWN_EXTENSIONS.has(extension) || MARKDOWN_MIME_TYPES.has(mime)) return "markdown";
  if (TABLE_EXTENSIONS.has(extension) || TABLE_MIME_TYPES.has(mime)) return "table";
  if (CODE_EXTENSIONS.has(extension) || CODE_MIME_TYPES.has(mime)) return "code";
  if (mime.startsWith("image/")) return "image";
  if (TEXT_MIME_TYPES.has(mime) || mime.startsWith("text/")) return "text";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (complexPreviewEnabled && COMPLEX_MIME_TYPES.has(mime)) return "complex";
  return "download";
}

export function attachmentExtension(filename: string): string {
  const normalized = filename.trim().toLowerCase();
  if (normalized.endsWith(".tar.gz")) return "tar";
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index + 1) : "";
}

export function buildComplexPreviewUrl(contentUrl: string, mimeType: string): string | null {
  if (!complexPreviewEnabled || !complexPreviewOrigin || typeof window === "undefined") return null;
  const source = new URL(contentUrl, window.location.origin).toString();
  const params = new URLSearchParams({ source, mime: mimeType });
  return `${complexPreviewOrigin}/attachment?${params.toString()}`;
}
