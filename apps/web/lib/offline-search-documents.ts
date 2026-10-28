import type { OfflineConversationRecord, OfflineSearchDocument } from "./offline-db";
import type { AnnotationRead, NotebookRead } from "./types";

/** Build a read-only index projection; never rewrite imported or pending data. */
export function buildOfflineSearchDocuments(
  documents: OfflineSearchDocument[],
  annotations: AnnotationRead[],
  notebooks: NotebookRead[],
  conversations: OfflineConversationRecord[],
): OfflineSearchDocument[] {
  const titles = new Map(conversations.map((item) => [item.id, item.display_title]));
  // Local annotation rows (including tombstones) are authoritative. Legacy
  // documents without a corresponding row remain searchable, not discarded.
  const annotationIds = new Set(annotations.map((item) => JSON.stringify([item.conversation_id, item.id])));
  const legacyAnnotations = new Set<string>();
  const retained = documents.filter((item) => {
    if (item.document_type !== "annotation") return true;
    const explicitId = item.metadata?.annotation_id;
    const id = typeof explicitId === "string" && explicitId
      ? explicitId : /^(?:local-annotation:|annotation:)(.+)$/.exec(item.id)?.[1];
    if (!id) return true;
    const key = JSON.stringify([item.conversation_id, id]);
    if (annotationIds.has(key) || legacyAnnotations.has(key)) return false;
    legacyAnnotations.add(key);
    return true;
  });
  return [
    ...retained,
    ...conversations.filter((item) => item.description_markdown).map((item) => ({
      id: `description:${item.id}`,
      conversation_id: item.id,
      message_id: null,
      document_type: "description",
      role: null,
      title: item.display_title,
      plain_text: item.description_markdown ?? "",
      order_key: null,
      turn_index: null,
      metadata: {},
    })),
    ...annotations.filter((item) => !item.is_deleted).map((item) => ({
      id: `annotation:${item.id}`,
      conversation_id: item.conversation_id,
      message_id: item.message_id,
      message_version_id: item.message_version_id,
      document_type: "annotation",
      role: null,
      title: titles.get(item.conversation_id) ?? "批注",
      plain_text: [item.quote, item.comment_markdown].filter(Boolean).join("\n"),
      order_key: typeof item.metadata.message_order_key === "string" ? item.metadata.message_order_key : null,
      turn_index: null,
      metadata: {
        annotation_id: item.id,
        annotation_type: item.annotation_type,
        annotation_color: item.color,
        block_index: item.start_block_index,
        character_offset: item.start_offset,
        anchor_status: item.anchor_status,
      },
    })),
    ...notebooks.map((item) => ({
      id: `notebook:${item.id}`,
      conversation_id: item.conversation_id,
      message_id: null,
      document_type: "notebook",
      role: null,
      title: item.title || titles.get(item.conversation_id) || "精选笔记",
      plain_text: item.blocks.filter((block) => block.type === "markdown").map((block) => block.markdown ?? "").join("\n"),
      order_key: null,
      turn_index: null,
      metadata: { notebook_id: item.id },
    })),
  ];
}
