import type { AttachmentRead, NavigateTarget } from "../../lib/types";

export type AttachmentOccurrence = NonNullable<AttachmentRead["occurrences"]>[number];

export function attachmentOccurrenceTarget(attachment: Pick<AttachmentRead, "id">, occurrence: AttachmentOccurrence): NavigateTarget {
  return {
    messageId: occurrence.message_id,
    messageVersionId: occurrence.message_version_id,
    renderBlockId: occurrence.render_block_id,
    blockIndex: occurrence.block_index ?? undefined,
    characterOffset: occurrence.start_offset ?? undefined,
    endCharacterOffset: occurrence.end_offset ?? undefined,
    occurrenceKey: occurrence.occurrence_key,
    attachmentId: attachment.id,
    source: "message-action",
  };
}
