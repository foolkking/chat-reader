declare module "word-extractor/lib/word-ole-extractor" {
  type ExtractedWordDocument = {
    getBody(options?: { filterUnicode?: boolean }): string;
  };

  export default class WordOleExtractor {
    extract(reader: unknown): Promise<ExtractedWordDocument>;
  }
}

declare module "word-extractor/lib/buffer-reader" {
  import type { Buffer } from "buffer";

  export default class BufferReader {
    constructor(buffer: Buffer);
  }
}
