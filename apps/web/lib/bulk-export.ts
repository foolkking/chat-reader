import { strToU8, zipSync } from "fflate";
import { getConversationExportUrl } from "./api";

export async function downloadConversationBundle(
  conversations: Array<{ id: string; display_title: string }>,
): Promise<void> {
  const entries = await Promise.all(conversations.map(async (conversation, index) => {
    const response = await fetch(getConversationExportUrl(conversation.id, {
      format: "canonical_json",
      includeDescription: false,
      includeAnnotations: false,
      includeNotebook: false,
    }), { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Export failed (${response.status}).`);
    const filename = `${String(index + 1).padStart(3, "0")}-${safeFilename(conversation.display_title)}.canonical.json`;
    return [filename, strToU8(await response.text())] as const;
  }));
  const archive = zipSync(Object.fromEntries(entries), { level: 6 });
  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chat-reader-export-${new Date().toISOString().slice(0, 10)}.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFilename(value: string): string {
  const cleaned = Array.from(value, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character).join("");
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 80) || "conversation";
}
