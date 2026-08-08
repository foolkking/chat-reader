import type { AttachmentRead } from "../../lib/types";

export type AttachmentDataState = "available" | "empty" | "missing" | "uploading" | "upload_failed";
export type AttachmentInlineMode = "inline-rich" | "inline-compact" | "viewer-only" | "download-only";
export type AttachmentInlineSkin = "media" | "preview-panel" | "file-row";
export type AttachmentViewerKind = "image" | "markdown" | "text" | "code" | "json" | "table" | "pdf" | "audio" | "video";
export type AttachmentViewerMode =
  | "image-focus"
  | "image-overview"
  | "markdown-rendered"
  | "markdown-source"
  | "text"
  | "code"
  | "json-tree"
  | "json-raw"
  | "table"
  | "table-raw"
  | "pdf"
  | "audio"
  | "video";
export type AttachmentRuntimeRenderState =
  | { status: "idle" }
  | { status: "loading"; requestId: string }
  | { status: "ready"; requestId: string }
  | { status: "unsupported"; requestId: string; reason: "codec" | "browser-capability" }
  | { status: "failed"; requestId: string; reason: "network" | "decode" | "parser" | "timeout" | "authorization" }
  | { status: "offline-unavailable"; requestId: string };
export type AttachmentFileRowVariant = "normal" | "empty" | "missing" | "unsupported" | "preview-failed" | "offline-unavailable";
export type AttachmentImageDisplayMode = "auto" | "small" | "medium" | "large";

export type AttachmentRendererCapability = {
  rendererKey: string;
  inlineMode: AttachmentInlineMode;
  viewerKind: AttachmentViewerKind | null;
  defaultViewerMode?: AttachmentViewerMode;
  friendlyType: string;
  runtimeProbe?: "image-decode" | "media-codec" | null;
  derivativePolicy?: "thumbnail" | "preview" | "converted-preview" | null;
};

export type AttachmentRenderPlan = {
  dataState: AttachmentDataState;
  capability: AttachmentRendererCapability;
  runtime: AttachmentRuntimeRenderState;
  inline: AttachmentInlineSkin;
  viewerKind: AttachmentViewerKind | null;
  viewerMode: AttachmentViewerMode | null;
  fileRowVariant?: AttachmentFileRowVariant;
  actions: { open: boolean; download: boolean; retry: boolean; locate: boolean };
};

const MARKDOWN_MIME = new Set(["text/markdown", "text/x-markdown"]);
const TABLE_MIME = new Set(["text/csv", "text/tab-separated-values"]);
const JSON_MIME = new Set(["application/json", "application/ld+json"]);
const CODE_MIME = new Set([
  "application/sql", "application/toml", "application/xml", "application/x-httpd-php", "application/x-javascript",
  "application/x-python-code", "application/x-sh", "application/yaml", "text/css", "text/javascript", "text/x-python",
  "text/x-sql", "text/xml", "text/yaml",
]);
const MARKDOWN_EXT = new Set(["md", "markdown", "mdown", "mkd"]);
const TABLE_EXT = new Set(["csv", "tsv"]);
const JSON_EXT = new Set(["json", "jsonl", "ndjson"]);
const CODE_EXT = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "htm", "ini", "java", "js", "jsx", "kt", "php",
  "py", "rb", "rs", "sh", "sql", "toml", "ts", "tsx", "xml", "yaml", "yml",
]);
const TEXT_EXT = new Set(["txt", "log", "srt", "eml", "ics", "vcf"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg"]);
const TIFF_EXT = new Set(["tif", "tiff"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);
const DOWNLOAD_ONLY_EXT = new Set([
  "7z", "avi", "bz2", "doc", "docx", "drawio", "dxf", "epub", "gz", "mkv", "obj", "odp", "ods", "odt",
  "ppt", "pptx", "rar", "rtf", "stl", "tar", "tar.gz", "vsdx", "xls", "xlsx", "xz", "zip",
]);

const CAPABILITIES = {
  image: capability("image", "inline-rich", "image", "image-focus", "图片", "image-decode", "thumbnail"),
  tiff: capability("converted-image", "viewer-only", "image", "image-focus", "TIFF 图片", undefined, "converted-preview"),
  markdown: capability("markdown", "inline-rich", "markdown", "markdown-rendered", "Markdown 文档"),
  text: capability("text", "inline-rich", "text", "text", "文本文件"),
  code: capability("code", "inline-rich", "code", "code", "代码文件"),
  json: capability("json", "inline-rich", "json", "json-tree", "JSON 数据"),
  table: capability("table", "inline-rich", "table", "table", "表格数据"),
  pdf: capability("pdf", "inline-compact", "pdf", "pdf", "PDF 文档"),
  audio: capability("audio", "inline-compact", "audio", "audio", "音频", "media-codec"),
  video: capability("video", "inline-compact", "video", "video", "视频", "media-codec"),
  download: capability("generic", "download-only", null, undefined, "文件"),
} satisfies Record<string, AttachmentRendererCapability>;

function capability(
  rendererKey: string,
  inlineMode: AttachmentInlineMode,
  viewerKind: AttachmentViewerKind | null,
  defaultViewerMode: AttachmentViewerMode | undefined,
  friendlyType: string,
  runtimeProbe?: AttachmentRendererCapability["runtimeProbe"],
  derivativePolicy?: AttachmentRendererCapability["derivativePolicy"],
): AttachmentRendererCapability {
  return { rendererKey, inlineMode, viewerKind, defaultViewerMode, friendlyType, runtimeProbe, derivativePolicy };
}

export function resolveAttachmentDataState(attachment: AttachmentRead): AttachmentDataState {
  if (attachment.status === "uploading") return "uploading";
  if (attachment.status === "upload_failed") return "upload_failed";
  if (attachment.resolution_status === "missing" || !attachment.asset_object) return "missing";
  if (attachment.asset_object.byte_size === 0) return "empty";
  return "available";
}

export function resolveAttachmentCapability(attachment: Pick<AttachmentRead, "detected_mime_type" | "declared_mime_type" | "display_name" | "original_filename" | "asset_object">): AttachmentRendererCapability {
  const detectedMime = normalizeMime(attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type);
  const declaredMime = normalizeMime(attachment.declared_mime_type);
  const filename = attachment.display_name || attachment.original_filename;
  const compound = compoundAttachmentExtension(filename);
  const simple = simpleAttachmentExtension(filename);
  const detectedCapability = capabilityForMime(detectedMime);
  const declaredCapability = capabilityForMime(declaredMime);
  const extensionCapability = capabilityForExtension(compound) ?? capabilityForExtension(simple);

  // libmagic commonly reports Markdown, source files and text-based engineering
  // formats as text/plain. Treat that value as a content fact, but let a more
  // specific declared type or a text-compatible extension refine the renderer.
  if (detectedMime === "text/plain") {
    if (declaredCapability && declaredMime !== "text/plain") return declaredCapability;
    if (extensionCapability && isTextCompatibleRefinement(extensionCapability)) return extensionCapability;
  }

  return detectedCapability
    ?? declaredCapability
    ?? extensionCapability
    ?? CAPABILITIES.download;
}

export function buildAttachmentRenderPlan(
  attachment: AttachmentRead,
  runtime: AttachmentRuntimeRenderState = { status: "idle" },
): AttachmentRenderPlan {
  const dataState = resolveAttachmentDataState(attachment);
  const capability = resolveAttachmentCapability(attachment);
  const downloadable = dataState !== "missing" && Boolean(attachment.download_url);
  if (dataState === "missing") return fileRowPlan(dataState, capability, runtime, "missing", false, false, false, true);
  if (dataState === "empty") return fileRowPlan(dataState, capability, runtime, "empty", false, downloadable, false, true);
  if (runtime.status === "offline-unavailable") return fileRowPlan(dataState, capability, runtime, "offline-unavailable", false, downloadable, false, true);
  if (runtime.status === "unsupported") return fileRowPlan(dataState, capability, runtime, "unsupported", false, downloadable, false, true);
  if (runtime.status === "failed") return fileRowPlan(dataState, capability, runtime, "preview-failed", false, downloadable, true, true);
  if (capability.inlineMode === "download-only") return fileRowPlan(dataState, capability, runtime, "normal", false, downloadable, false, true);
  return {
    dataState,
    capability,
    runtime,
    inline: capability.inlineMode === "inline-rich" && capability.viewerKind === "image" ? "media" : "preview-panel",
    viewerKind: capability.viewerKind,
    viewerMode: capability.defaultViewerMode ?? null,
    actions: { open: Boolean(capability.viewerKind), download: downloadable, retry: false, locate: true },
  };
}

function fileRowPlan(
  dataState: AttachmentDataState,
  capability: AttachmentRendererCapability,
  runtime: AttachmentRuntimeRenderState,
  fileRowVariant: AttachmentFileRowVariant,
  open: boolean,
  download: boolean,
  retry: boolean,
  locate: boolean,
): AttachmentRenderPlan {
  return { dataState, capability, runtime, inline: "file-row", viewerKind: open ? capability.viewerKind : null, viewerMode: open ? capability.defaultViewerMode ?? null : null, fileRowVariant, actions: { open, download, retry, locate } };
}

export function normalizeImageDisplayMode(value?: string | null): AttachmentImageDisplayMode {
  if (value === "small" || value === "medium" || value === "large" || value === "auto") return value;
  return "auto";
}

export function imageDisplayMaxWidth(mode: AttachmentImageDisplayMode): string {
  if (mode === "small") return "280px";
  if (mode === "medium") return "480px";
  return "100%";
}

export function attachmentExtension(filename: string): string {
  return compoundAttachmentExtension(filename) || simpleAttachmentExtension(filename);
}

export function compoundAttachmentExtension(filename: string): string {
  const value = filename.trim().toLowerCase();
  for (const extension of ["tar.gz", "tar.bz2", "tar.xz"]) {
    if (value.endsWith(`.${extension}`)) return extension;
  }
  return "";
}

export function simpleAttachmentExtension(filename: string): string {
  const value = filename.trim().toLowerCase();
  if (value.startsWith(".") && value.indexOf(".", 1) < 0) return "";
  const index = value.lastIndexOf(".");
  if (index < 0 || index === value.length - 1) return "";
  return value.slice(index + 1);
}

function isTextCompatibleRefinement(capability: AttachmentRendererCapability): boolean {
  return ["markdown", "text", "code", "json", "table", "generic"].includes(capability.rendererKey);
}

export function friendlyAttachmentType(attachment: AttachmentRead): string {
  const plan = resolveAttachmentCapability(attachment);
  const extension = attachmentExtension(attachment.display_name).toUpperCase();
  if (plan.rendererKey === "generic") return extension ? `${extension} 文件` : plan.friendlyType;
  if (plan.rendererKey === "code" && extension) return `${extension} 代码`;
  if (plan.rendererKey === "audio" && extension) return `${extension} 音频`;
  if (plan.rendererKey === "video" && extension) return `${extension} 视频`;
  return extension && !plan.friendlyType.startsWith(extension) ? `${plan.friendlyType} · ${extension}` : plan.friendlyType;
}

function capabilityForMime(mime: string): AttachmentRendererCapability | null {
  if (!mime) return null;
  if (MARKDOWN_MIME.has(mime)) return CAPABILITIES.markdown;
  if (TABLE_MIME.has(mime)) return CAPABILITIES.table;
  if (JSON_MIME.has(mime)) return CAPABILITIES.json;
  if (CODE_MIME.has(mime)) return CAPABILITIES.code;
  if (mime === "application/pdf") return CAPABILITIES.pdf;
  if (mime === "image/tiff") return CAPABILITIES.tiff;
  if (["video/x-msvideo", "video/x-matroska"].includes(mime)) return CAPABILITIES.download;
  if ([
    "application/zip", "application/x-7z-compressed", "application/x-bzip2", "application/x-gzip",
    "application/x-rar-compressed", "application/x-tar", "application/x-xz",
    "application/msword", "application/rtf", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.presentation", "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.text", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/epub+zip",
  ].includes(mime)) return CAPABILITIES.download;
  if (mime.startsWith("image/")) return CAPABILITIES.image;
  if (mime.startsWith("audio/")) return CAPABILITIES.audio;
  if (mime.startsWith("video/")) return CAPABILITIES.video;
  if (mime.startsWith("text/")) return CAPABILITIES.text;
  return null;
}

function capabilityForExtension(extension: string): AttachmentRendererCapability | null {
  if (!extension) return null;
  if (DOWNLOAD_ONLY_EXT.has(extension)) return CAPABILITIES.download;
  if (TIFF_EXT.has(extension)) return CAPABILITIES.tiff;
  if (MARKDOWN_EXT.has(extension)) return CAPABILITIES.markdown;
  if (TABLE_EXT.has(extension)) return CAPABILITIES.table;
  if (JSON_EXT.has(extension)) return CAPABILITIES.json;
  if (CODE_EXT.has(extension)) return CAPABILITIES.code;
  if (TEXT_EXT.has(extension)) return CAPABILITIES.text;
  if (IMAGE_EXT.has(extension)) return CAPABILITIES.image;
  if (AUDIO_EXT.has(extension)) return CAPABILITIES.audio;
  if (VIDEO_EXT.has(extension)) return CAPABILITIES.video;
  return null;
}

function normalizeMime(value?: string | null): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}
