import { strFromU8, unzipSync } from "fflate";

type ComplexKind = "document" | "spreadsheet" | "presentation" | "archive";

type RequestMessage = {
  requestId: string;
  kind: ComplexKind;
  filename: string;
  bytes: ArrayBuffer;
};

type ArchiveEntry = {
  path: string;
  byteSize: number;
  directory: boolean;
  preview?: { kind: "text"; text: string; truncated?: boolean } | { kind: "image"; mimeType: string; bytes: ArrayBuffer };
};
export type PreviewGridCell = { column: number; value: string };
export type PreviewGridRow = { rowNumber: number; cells: PreviewGridCell[] };
export type PreviewBounds = { truncated: boolean; reason?: "paragraphs" | "tables" | "rows" | "columns" | "sheets" | "slides" | "entries" | "characters" | "slide-lines" | "shared-strings"; limit?: number; warnings?: Array<"office-order-unavailable" | "shared-string-reference"> };
export type PreviewErrorCode = "source-size" | "zip-entry-count" | "zip-entry-size" | "zip-expanded-size" | "zip-invalid" | "office-relationships" | "office-coordinates";

type Result =
  | { kind: "document"; paragraphs: string[]; tables: string[][][]; preview: PreviewBounds }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: PreviewGridRow[] }>; preview: PreviewBounds }
  | { kind: "presentation"; slides: Array<{ title: string; lines: string[] }>; preview: PreviewBounds }
  | { kind: "archive"; entries: ArchiveEntry[]; preview: PreviewBounds };

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const MAX_EXPANDED_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_PREVIEW_BYTES = 8 * 1024 * 1024;

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  void handleRequest(event.data);
};

async function handleRequest({ requestId, kind, filename, bytes }: RequestMessage) {
  try {
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw previewError("source-size", "文件超过 50 MiB 浏览器预览上限，请下载原文件。 ");
    const source = new Uint8Array(bytes);
    if (kind === "document" && filename.toLowerCase().endsWith(".doc")) {
      const result = await parseLegacyWordDocument(source);
      self.postMessage({ requestId, ok: true, result });
      return;
    }
    validateCentralDirectory(source);
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(source); }
    catch { throw previewError("zip-invalid", "ZIP 内容无法解压。"); }
    const result = parseResult(kind, filename, files);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({
      requestId, ok: false,
      error: error instanceof Error ? error.message : "无法解析此文件。",
      errorCode: isPreviewError(error) ? error.code : undefined,
    });
  }
}

async function parseLegacyWordDocument(source: Uint8Array): Promise<Result> {
  const [{ Buffer }, oleModule, readerModule] = await Promise.all([
    import("buffer"),
    import("word-extractor/lib/word-ole-extractor"),
    import("word-extractor/lib/buffer-reader"),
  ]);
  const WordOleExtractor = oleModule.default;
  const BufferReader = readerModule.default;
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  const document = await new WordOleExtractor().extract(new BufferReader(buffer));
  const fullBody = document.getBody({ filterUnicode: false });
  const body = fullBody.slice(0, 2_000_000);
  const paragraphs = body
    .split(/[\r\n\v\f]+/)
    .map((paragraph) => paragraph.split(String.fromCharCode(0)).join("").trim())
    .filter(Boolean)
    .slice(0, 2_001);
  return { kind: "document", paragraphs: paragraphs.slice(0, 2_000), tables: [],
    preview: fullBody.length > 2_000_000 ? { truncated: true, reason: "characters", limit: 2_000_000 }
      : { truncated: paragraphs.length > 2_000, reason: "paragraphs", limit: 2_000 } };
}

function parseResult(kind: ComplexKind, filename: string, files: Record<string, Uint8Array>): Result {
  if (kind === "archive") return parseArchive(files);
  if (kind === "document") return parseDocument(filename, files);
  if (kind === "spreadsheet") return parseSpreadsheet(filename, files);
  return parsePresentation(filename, files);
}

function parseDocument(filename: string, files: Record<string, Uint8Array>): Result {
  const odf = filename.toLowerCase().endsWith(".odt");
  const xml = readRequired(files, odf ? "content.xml" : "word/document.xml");
  const paragraphPattern = odf ? /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi : /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  const paragraphs = collectXmlText(xml, paragraphPattern, 2_001);
  const tablePattern = odf ? /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi : /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi;
  const rowPattern = odf ? /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi : /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
  const cellPattern = odf ? /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi : /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
  const tableResult = collectTables(xml, tablePattern, rowPattern, cellPattern);
  return { kind: "document", paragraphs: paragraphs.slice(0, 2_000), tables: tableResult.tables,
    preview: tableResult.preview.truncated ? tableResult.preview : { truncated: paragraphs.length > 2_000, reason: "paragraphs", limit: 2_000 } };
}

function parseSpreadsheet(filename: string, files: Record<string, Uint8Array>): Result {
  if (filename.toLowerCase().endsWith(".ods")) {
    const xml = readRequired(files, "content.xml");
    const sheets: Array<{ name: string; rows: PreviewGridRow[] }> = [];
    let preview: PreviewBounds = { truncated: false };
    for (const match of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/gi)) {
      if (sheets.length >= 32) { preview = { truncated: true, reason: "sheets", limit: 32 }; break; }
      const name = decodeXml(match[1].match(/table:name="([^"]*)"/i)?.[1] ?? `Sheet ${sheets.length + 1}`);
      const rows = collectSheetRows(match[2], /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi, /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi);
      sheets.push({ name, rows: rows.rows });
      if (!preview.truncated && rows.preview.truncated) preview = rows.preview;
    }
    return { kind: "spreadsheet", sheets, preview };
  }
  const shared = files["xl/sharedStrings.xml"] ? collectSharedStrings(strFromU8(files["xl/sharedStrings.xml"]), 50_001) : [];
  const visibleShared = shared.slice(0, 50_000);
  const workbook = parseWorkbookSheets(files);
  const warnings = new Set<NonNullable<PreviewBounds["warnings"]>[number]>();
  if (!workbook.orderKnown) warnings.add("office-order-unavailable");
  let preview: PreviewBounds = workbook.sheets.length > 32 ? { truncated: true, reason: "sheets", limit: 32 }
    : shared.length > 50_000 ? { truncated: true, reason: "shared-strings", limit: 50_000 } : { truncated: false };
  const sheets = workbook.sheets.slice(0, 32).map(({ name, path }) => {
    const rows = parseXlsxRows(strFromU8(files[path]), visibleShared);
    for (const warning of rows.preview.warnings ?? []) warnings.add(warning);
    if (!preview.truncated && rows.preview.truncated) preview = rows.preview;
    return { name, rows: rows.rows };
  });
  return { kind: "spreadsheet", sheets, preview: { ...preview, warnings: [...warnings] } };
}

function parsePresentation(filename: string, files: Record<string, Uint8Array>): Result {
  if (filename.toLowerCase().endsWith(".odp")) {
    const xml = readRequired(files, "content.xml");
    const slides: Array<{ title: string; lines: string[] }> = [];
    let preview: PreviewBounds = { truncated: false };
    for (const match of xml.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/gi)) {
      if (slides.length >= 500) { preview = { truncated: true, reason: "slides", limit: 500 }; break; }
      const lines = collectXmlText(match[1], /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi, 201);
      if (lines.length > 200 && !preview.truncated) preview = { truncated: true, reason: "slide-lines", limit: 200 };
      slides.push({ title: lines[0] || `Slide ${slides.length + 1}`, lines: lines.slice(0, 200) });
    }
    return { kind: "presentation", slides, preview };
  }
  const presentation = parsePresentationSlidePaths(files);
  const paths = presentation.paths.slice(0, 500);
  let preview: PreviewBounds = { truncated: presentation.paths.length > 500, reason: "slides", limit: 500 };
  const slides = paths.map((path, index) => {
    const lines = collectXmlText(strFromU8(files[path]), /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi, 201);
    if (lines.length > 200 && !preview.truncated) preview = { truncated: true, reason: "slide-lines", limit: 200 };
    return { title: lines[0] || `Slide ${index + 1}`, lines: lines.slice(0, 200) };
  });
  return { kind: "presentation", slides, preview: { ...preview, warnings: presentation.orderKnown ? [] : ["office-order-unavailable"] } };
}

function parseArchive(files: Record<string, Uint8Array>): Result {
  let previewBytes = 0;
  const entries: ArchiveEntry[] = [];
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length >= MAX_ENTRIES) break;
    const directory = path.endsWith("/");
    const entry: ArchiveEntry = { path, byteSize: directory ? 0 : bytes.byteLength, directory };
    if (!directory && previewBytes + bytes.byteLength <= MAX_ARCHIVE_PREVIEW_BYTES) {
      const mime = imageMime(path);
      if (mime && bytes.byteLength <= MAX_IMAGE_PREVIEW_BYTES) {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        entry.preview = { kind: "image", mimeType: mime, bytes: copy.buffer };
        previewBytes += bytes.byteLength;
      } else if (isTextPath(path) && bytes.byteLength <= MAX_TEXT_PREVIEW_BYTES) {
        const text = strFromU8(bytes);
        entry.preview = { kind: "text", text: text.slice(0, 200_000), truncated: text.length > 200_000 };
        previewBytes += bytes.byteLength;
      }
    }
    entries.push(entry);
  }
  return { kind: "archive", entries, preview: { truncated: Object.keys(files).length > MAX_ENTRIES, reason: "entries", limit: MAX_ENTRIES } };
}

function validateCentralDirectory(bytes: Uint8Array) {
  if (bytes.byteLength < 22) throw previewError("zip-invalid", "ZIP central directory 不完整。 ");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw previewError("zip-invalid", "ZIP central directory 不完整。 ");
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > MAX_ENTRIES) throw previewError("zip-entry-count", "ZIP 条目数量超过预览上限。 ");
  if (directoryOffset + directorySize > bytes.byteLength) throw previewError("zip-invalid", "ZIP central directory 越界。 ");
  let offset = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw previewError("zip-invalid", "ZIP central directory 损坏。 ");
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (uncompressed > MAX_ENTRY_BYTES) throw previewError("zip-entry-size", "ZIP 单个条目超过预览上限。 ");
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES) throw previewError("zip-expanded-size", "ZIP 展开总量超过预览上限。 ");
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function previewError(code: PreviewErrorCode, message: string): Error & { code: PreviewErrorCode } {
  return Object.assign(new Error(message), { code });
}

function isPreviewError(error: unknown): error is Error & { code: PreviewErrorCode } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function readRequired(files: Record<string, Uint8Array>, path: string): string {
  const value = files[path];
  if (!value) throw new Error(`文件缺少 ${path}，无法生成预览。`);
  return strFromU8(value);
}

function collectXmlText(xml: string, pattern: RegExp, limit: number): string[] {
  const result: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    const value = xmlText(match[1]);
    if (value) result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function collectTables(xml: string, tablePattern: RegExp, rowPattern: RegExp, cellPattern: RegExp): { tables: string[][][]; preview: PreviewBounds } {
  const tables: string[][][] = [];
  let preview: PreviewBounds = { truncated: false };
  for (const table of xml.matchAll(tablePattern)) {
    if (tables.length >= 32) { preview = { truncated: true, reason: "tables", limit: 32 }; break; }
    const rows: string[][] = [];
    for (const row of table[1].matchAll(rowPattern)) {
      const allCells = Array.from(row[1].matchAll(cellPattern));
      if (allCells.length > 64) preview = { truncated: true, reason: "columns", limit: 64 };
      const cells = allCells.slice(0, 64).map((cell) => xmlText(cell[1]));
      if (cells.some(Boolean)) rows.push(cells);
      if (rows.length >= 201) { if (!preview.truncated) preview = { truncated: true, reason: "rows", limit: 200 }; break; }
    }
    if (rows.length) tables.push(rows.slice(0, 200));
  }
  return { tables, preview };
}

function collectSheetRows(xml: string, rowPattern: RegExp, cellPattern: RegExp): { rows: PreviewGridRow[]; preview: PreviewBounds } {
  const rows: PreviewGridRow[] = [];
  let preview: PreviewBounds = { truncated: false };
  for (const row of xml.matchAll(rowPattern)) {
    const allCells = Array.from(row[1].matchAll(cellPattern));
    if (allCells.length > 64) preview = { truncated: true, reason: "columns", limit: 64 };
    const cells = allCells.slice(0, 64).map((cell, column) => ({ column, value: xmlText(cell[1]) }));
    rows.push({ rowNumber: rows.length + 1, cells });
    if (rows.length >= 2_001) { if (!preview.truncated) preview = { truncated: true, reason: "rows", limit: 2_000 }; break; }
  }
  return { rows: rows.slice(0, 2_000), preview };
}

function parseWorkbookSheets(files: Record<string, Uint8Array>): { sheets: Array<{ name: string; path: string }>; orderKnown: boolean } {
  const workbook = files["xl/workbook.xml"];
  if (!workbook) return { orderKnown: false, sheets: Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort(naturalPathCompare)
    .slice(0, 33).map((path, index) => ({ name: `Sheet ${index + 1}`, path })) };
  const relations = parseRelationships(files["xl/_rels/workbook.xml.rels"], "xl");
  const xml = strFromU8(workbook);
  if (!/<(?:[\w.-]+:)?sheets\b/i.test(xml)) throw previewError("office-relationships", "无法确认工作表声明。");
  const sheets: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?>/gi)) {
    if (sheets.length >= 33) break;
    const attributes = match[1];
    const name = attributeValue(attributes, "name") ?? `Sheet ${sheets.length + 1}`;
    const path = relatedOfficePath(relations, attributeValue(attributes, "r:id"), "worksheet", /^xl\/worksheets\/[^/]+\.xml$/i, files);
    if (seen.has(path)) throw previewError("office-relationships", "工作表关系重复。");
    seen.add(path); sheets.push({ name, path });
  }
  return { sheets, orderKnown: true };
}

function parsePresentationSlidePaths(files: Record<string, Uint8Array>): { paths: string[]; orderKnown: boolean } {
  const presentation = files["ppt/presentation.xml"];
  if (!presentation) return { orderKnown: false, paths: Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort(naturalPathCompare).slice(0, 501) };
  const relations = parseRelationships(files["ppt/_rels/presentation.xml.rels"], "ppt");
  const xml = strFromU8(presentation);
  if (!/<(?:[\w.-]+:)?sldIdLst\b/i.test(xml)) throw previewError("office-relationships", "无法确认幻灯片声明。");
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?sldId\b([^>]*)\/?>/gi)) {
    if (paths.length >= 501) break;
    const path = relatedOfficePath(relations, attributeValue(match[1], "r:id"), "slide", /^ppt\/slides\/[^/]+\.xml$/i, files);
    if (seen.has(path)) throw previewError("office-relationships", "幻灯片关系重复。");
    seen.add(path); paths.push(path);
  }
  return { paths, orderKnown: true };
}

type OfficeRelationship = { path: string | null; type: string | undefined };

function parseRelationships(bytes: Uint8Array | undefined, baseDirectory: string): Map<string, OfficeRelationship> {
  if (!bytes) return new Map();
  const result = new Map<string, OfficeRelationship>();
  for (const match of strFromU8(bytes).matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?>/gi)) {
    const id = attributeValue(match[1], "Id");
    const target = attributeValue(match[1], "Target");
    if (!id) continue;
    if (result.has(id)) throw previewError("office-relationships", "Office relationship ID 重复。");
    const external = attributeValue(match[1], "TargetMode")?.toLowerCase() === "external";
    result.set(id, { path: target && !external ? resolveZipTarget(baseDirectory, target) : null, type: attributeValue(match[1], "Type") });
  }
  return result;
}

function relatedOfficePath(relations: Map<string, OfficeRelationship>, id: string | undefined, type: string, pattern: RegExp, files: Record<string, Uint8Array>): string {
  const relation = id ? relations.get(id) : undefined;
  const path = relation?.path;
  if (!path || !pattern.test(path) || !files[path] || (relation?.type && !relation.type.endsWith(`/${type}`)))
    throw previewError("office-relationships", "Office 声明关系缺失或无效，请下载原文件。");
  return path;
}

function resolveZipTarget(baseDirectory: string, target: string): string | null {
  if (/[:\\?#]/.test(target) || target.startsWith("//")) return null;
  const parts = (target.startsWith("/") ? target.slice(1) : `${baseDirectory}/${target}`)
    .split("/")
    .filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") { if (!normalized.length) return null; normalized.pop(); }
    else normalized.push(part);
  }
  return normalized.join("/");
}

function attributeValue(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeXml(match[1] ?? match[2]) : undefined;
}

function collectSharedStrings(xml: string, limit: number): string[] {
  const result: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/gi)) {
    // Keep empty <si> positions: cell values address this table by index.
    result.push(spreadsheetText(match[1] ?? ""));
    if (result.length >= limit) break;
  }
  return result;
}

function parseXlsxRows(xml: string, shared: string[]): { rows: PreviewGridRow[]; preview: PreviewBounds } {
  const rows: PreviewGridRow[] = [];
  let preview: PreviewBounds = { truncated: false };
  let invalidSharedReference = false;
  let previousRow = 0;
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gi)) {
    const content = row[2] ?? "";
    const firstCellReference = content.match(/<c\b([^>]*)>/i);
    const inferredRow = firstCellReference ? attributeValue(firstCellReference[1], "r")?.match(/[1-9]\d*$/)?.[0] : undefined;
    const rowNumber = Number(attributeValue(row[1], "r") ?? inferredRow ?? previousRow + 1);
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRow || rowNumber > 1_048_576)
      throw previewError("office-coordinates", "工作表行坐标无效。");
    previousRow = rowNumber;
    const cells: PreviewGridCell[] = [];
    let previousColumn = -1;
    for (const cell of content.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const reference = attributeValue(cell[1], "r");
      if (reference && (!/^[A-Za-z]{1,3}[1-9]\d*$/.test(reference) || Number(reference.match(/\d+$/)?.[0]) !== rowNumber))
        throw previewError("office-coordinates", "工作表单元格坐标无效。");
      const column = reference ? columnIndex(reference) : previousColumn + 1;
      if (column <= previousColumn || column >= 16_384) throw previewError("office-coordinates", "工作表列坐标无效。");
      previousColumn = column;
      if (column >= 64) { preview = { truncated: true, reason: "columns", limit: 64 }; continue; }
      const type = attributeValue(cell[1], "t");
      const fragment = cell[2] ?? "";
      const raw = fragment.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      const sharedIndex = Number(raw);
      const validSharedReference = /^\d+$/.test(raw.trim()) && Number.isSafeInteger(sharedIndex) && sharedIndex >= 0 && sharedIndex < shared.length;
      if (type === "s" && !validSharedReference) invalidSharedReference = true;
      const value = type === "s"
        ? (validSharedReference ? shared[sharedIndex] : "[shared string unavailable]")
        : type === "inlineStr" ? spreadsheetText(fragment) : decodeXml(raw);
      cells.push({ column, value });
    }
    rows.push({ rowNumber, cells });
    if (rows.length >= 2_001) { if (!preview.truncated) preview = { truncated: true, reason: "rows", limit: 2_000 }; break; }
  }
  return { rows: rows.slice(0, 2_000), preview: { ...preview, warnings: invalidSharedReference ? ["shared-string-reference"] : [] } };
}

function spreadsheetText(fragment: string): string {
  // Rich-text runs concatenate; XML formatting and phonetic annotations are
  // not user text. Preserve intentional spaces inside <t>.
  return [...fragment.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/gi, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1])).join("");
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0] ?? "";
  let result = 0;
  for (const letter of letters.toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function xmlText(fragment: string): string {
  return decodeXml(fragment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function naturalPathCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function imageMime(path: string): string | null {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return null;
}

function isTextPath(path: string): boolean {
  return /\.(?:txt|md|markdown|json|csv|tsv|js|ts|tsx|jsx|py|sql|css|xml|ya?ml|toml|ini|log|srt)$/i.test(path);
}

export {};
