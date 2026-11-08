import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "../../lib/offline-access";
import { readableAnnotationEntry, readableAnnotationHeader } from "../../lib/annotation-document";
import { DirectDownloadSizeError } from "../../lib/bounded-download";

export async function prepareOfflineAnnotationDocument(conversationId: string, ids: string[] | null, scope: string, zh: boolean): Promise<Response> {
  const access = captureOfflineAccess();
  const parts = await offlineDb.transaction("r", [offlineDb.conversations, offlineDb.messages, offlineDb.annotations], async () => {
    const conversation = await offlineDb.conversations.get(conversationId);
    if (!conversation) throw new Error("Offline snapshot unavailable");
    const messages = await offlineDb.messages.where("conversation_id").equals(conversationId).sortBy("order_key");
    const selected = ids ? new Set(ids) : null;
    const annotations = (await offlineDb.annotations.where("conversation_id").equals(conversationId).toArray())
      .filter(item => !item.is_deleted && (!selected || selected.has(item.id)));
    const sequence = new Map(messages.map((item, index) => [item.id, { seq: index + 1, role: item.role }]));
    annotations.sort((a, b) => (sequence.get(a.message_id ?? "")?.seq ?? Infinity) - (sequence.get(b.message_id ?? "")?.seq ?? Infinity)
      || (a.start_block_index ?? Infinity) - (b.start_block_index ?? Infinity) || (a.start_offset ?? Infinity) - (b.start_offset ?? Infinity)
      || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const encoder = new TextEncoder(), result: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    const append = (text: string) => {
      const bytes = encoder.encode(text); size += bytes.byteLength;
      if (size > 16 * 1024 * 1024) throw new DirectDownloadSizeError();
      result.push(bytes);
    };
    append(readableAnnotationHeader(conversation.display_title || conversation.title, new Date().toISOString(), annotations.length, scope, "offline", zh));
    annotations.forEach((item, index) => {
      const message = sequence.get(item.message_id ?? "");
      append(readableAnnotationEntry({ ...item, quoted_text: item.quote, message_seq: message?.seq, message_role: message?.role,
        message_id: message ? item.message_id : null }, index + 1, zh, window.location.origin));
    });
    return result;
  });
  assertOfflineAccess(access);
  return new Response(new Blob(parts, { type: "text/markdown;charset=utf-8" }), {
    headers: { "Content-Type": "text/markdown;charset=utf-8", "Content-Disposition": 'attachment; filename="annotations.md"' },
  });
}
