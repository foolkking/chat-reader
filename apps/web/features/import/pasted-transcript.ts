export const PASTED_TRANSCRIPT_FILENAME = "pasted-transcript.md";

export function pastedTranscriptByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function createPastedTranscriptFile(text: string): File | null {
  if (!text.trim()) return null;
  return new File([text], PASTED_TRANSCRIPT_FILENAME, { type: "text/markdown;charset=utf-8" });
}
