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
  preview?: { kind: "text"; text: string } | { kind: "image"; mimeType: string; bytes: ArrayBuffer };
};

type Result =
  | { kind: "document"; paragraphs: string[]; tables: string[][][] }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: "presentation"; slides: Array<{ title: string; lines: string[] }> }
  | { kind: "archive"; entries: ArchiveEntry[] };

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
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
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error("文件超过 32 MiB 浏览器预览上限，请下载原文件。 ");
    const source = new Uint8Array(bytes);
    if (kind === "document" && filename.toLowerCase().endsWith(".doc")) {
      const result = await parseLegacyWordDocument(source);
      self.postMessage({ requestId, ok: true, result });
      return;
    }
    validateCentralDirectory(source);
    const files = unzipSync(source);
    const result = parseResult(kind, filename, files);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : "无法解析此文件。" });
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
  const body = document.getBody({ filterUnicode: false }).slice(0, 2_000_000);
  const paragraphs = body
    .split(/[\r\n\v\f]+/)
    .map((paragraph) => paragraph.split(String.fromCharCode(0)).join("").trim())
    .filter(Boolean)
    .slice(0, 2_000);
  return { kind: "document", paragraphs, tables: [] };
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
  const paragraphs = collectXmlText(xml, paragraphPattern, 2_000);
  const tablePattern = odf ? /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi : /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi;
  const rowPattern = odf ? /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi : /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
  const cellPattern = odf ? /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi : /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
  const tables = collectTables(xml, tablePattern, rowPattern, cellPattern);
  return { kind: "document", paragraphs, tables };
}

function parseSpreadsheet(filename: string, files: Record<string, Uint8Array>): Result {
  if (filename.toLowerCase().endsWith(".ods")) {
    const xml = readRequired(files, "content.xml");
    const sheets: Array<{ name: string; rows: string[][] }> = [];
    for (const match of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/gi)) {
      if (sheets.length >= 32) break;
      const name = decodeXml(match[1].match(/table:name="([^"]*)"/i)?.[1] ?? `Sheet ${sheets.length + 1}`);
      sheets.push({ name, rows: collectSheetRows(match[2], /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi, /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi) });
    }
    return { kind: "spreadsheet", sheets };
  }
  const shared = files["xl/sharedStrings.xml"] ? collectXmlText(strFromU8(files["xl/sharedStrings.xml"]), /<si\b[^>]*>([\s\S]*?)<\/si>/gi, 50_000) : [];
  const sheetNames = parseWorkbookSheetNames(files);
  const sheetPaths = Object.keys(files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort(naturalPathCompare).slice(0, 32);
  const sheets = sheetPaths.map((path, index) => ({
    name: sheetNames[index] ?? `Sheet ${index + 1}`,
    rows: parseXlsxRows(strFromU8(files[path]), shared),
  }));
  return { kind: "spreadsheet", sheets };
}

function parsePresentation(filename: string, files: Record<string, Uint8Array>): Result {
  if (filename.toLowerCase().endsWith(".odp")) {
    const xml = readRequired(files, "content.xml");
    const slides = Array.from(xml.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/gi)).slice(0, 500).map((match, index) => {
      const lines = collectXmlText(match[1], /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi, 200);
      return { title: lines[0] || `Slide ${index + 1}`, lines };
    });
    return { kind: "presentation", slides };
  }
  const paths = Object.keys(files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort(naturalPathCompare).slice(0, 500);
  const slides = paths.map((path, index) => {
    const lines = collectXmlText(strFromU8(files[path]), /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi, 200);
    return { title: lines[0] || `Slide ${index + 1}`, lines };
  });
  return { kind: "presentation", slides };
}

function parseArchive(files: Record<string, Uint8Array>): Result {
  let previewBytes = 0;
  const entries: ArchiveEntry[] = [];
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length >= MAX_ENTRIES) break;
    const directory = path.endsWith("/");
    const entry: ArchiveEntry = { path, byteSize: directory ? 0 : bytes.byteLength, directory };
    if (!directory && previewBytes < MAX_ARCHIVE_PREVIEW_BYTES) {
      const mime = imageMime(path);
      if (mime && bytes.byteLength <= MAX_IMAGE_PREVIEW_BYTES) {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        entry.preview = { kind: "image", mimeType: mime, bytes: copy.buffer };
        previewBytes += bytes.byteLength;
      } else if (isTextPath(path) && bytes.byteLength <= MAX_TEXT_PREVIEW_BYTES) {
        entry.preview = { kind: "text", text: strFromU8(bytes).slice(0, 200_000) };
        previewBytes += bytes.byteLength;
      }
    }
    entries.push(entry);
  }
  return { kind: "archive", entries };
}

function validateCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ZIP central directory 不完整。 ");
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > MAX_ENTRIES) throw new Error("ZIP 条目数量超过预览上限。 ");
  if (directoryOffset + directorySize > bytes.byteLength) throw new Error("ZIP central directory 越界。 ");
  let offset = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP central directory 损坏。 ");
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (uncompressed > MAX_ENTRY_BYTES) throw new Error("ZIP 单个条目超过预览上限。 ");
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("ZIP 展开总量超过预览上限。 ");
    offset += 46 + nameLength + extraLength + commentLength;
  }
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

function collectTables(xml: string, tablePattern: RegExp, rowPattern: RegExp, cellPattern: RegExp): string[][][] {
  const tables: string[][][] = [];
  for (const table of xml.matchAll(tablePattern)) {
    const rows: string[][] = [];
    for (const row of table[1].matchAll(rowPattern)) {
      const cells = Array.from(row[1].matchAll(cellPattern)).slice(0, 64).map((cell) => xmlText(cell[1]));
      if (cells.some(Boolean)) rows.push(cells);
      if (rows.length >= 200) break;
    }
    if (rows.length) tables.push(rows);
    if (tables.length >= 32) break;
  }
  return tables;
}

function collectSheetRows(xml: string, rowPattern: RegExp, cellPattern: RegExp): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(rowPattern)) {
    const cells = Array.from(row[1].matchAll(cellPattern)).slice(0, 64).map((cell) => xmlText(cell[1]));
    rows.push(cells);
    if (rows.length >= 2_000) break;
  }
  return rows;
}

function parseWorkbookSheetNames(files: Record<string, Uint8Array>): string[] {
  const workbook = files["xl/workbook.xml"];
  if (!workbook) return [];
  return Array.from(strFromU8(workbook).matchAll(/<sheet\b[^>]*name="([^"]*)"/gi)).map((match) => decodeXml(match[1])).slice(0, 32);
}

function parseXlsxRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      if (cells.length >= 64) break;
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const raw = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? xmlText(cell[2]);
      cells.push(type === "s" ? shared[Number(raw)] ?? raw : decodeXml(raw));
    }
    rows.push(cells);
    if (rows.length >= 2_000) break;
  }
  return rows;
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
