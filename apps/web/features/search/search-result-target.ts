import type { MessageListItem, NavigateTarget, SearchResultItem } from "../../lib/types";

/** An explicit repeat click, not persisted in a bookmark or canonical data. */
export type SearchResultReplay = { href: string; sequence: number };

/** Compare navigation fields, ignoring query ordering and panel-only settings. */
export function matchesLibrarySearchTarget(href: string, currentQuery: string): boolean {
  if (!href.startsWith("/library?")) return false;
  const target = new URLSearchParams(href.slice("/library?".length));
  const current = new URLSearchParams(currentQuery);
  const sameIdentity = [
    "conversationId", "messageId", "messageVersionId", "blockIndex",
    "renderBlockId", "characterOffset", "endCharacterOffset",
    "attachmentId", "annotationId",
  ].every((key) => target.get(key) === current.get(key));
  if (!sameIdentity) return false;
  // A panel's open/layout state is not a new precise destination. Otherwise
  // opening annotations could retire a replay, or prevent a body hit replay.
  if (target.get("messageId") || target.get("attachmentId") || target.get("annotationId")) return true;
  // Legacy panel-only links still need to distinguish files from annotations.
  return ["files", "annotations"].every((key) => target.get(key) === current.get(key));
}

/** Hydrate content-free search links only against an authorized current block. */
export function resolveCanonicalSearchAnchor(message: MessageListItem, target: NavigateTarget) {
  if (message.id !== target.messageId) return null;
  const versionId = message.current_version?.id;
  if (!versionId || (target.messageVersionId && target.messageVersionId !== versionId)) return null;
  if (!target.messageVersionId && !target.renderBlockId) return null;
  const start = target.characterOffset;
  const end = target.endCharacterOffset;
  if (start === undefined || end === undefined || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  const blocks = message.render_blocks ?? message.current_version?.blocks ?? [];
  const block = target.renderBlockId
    ? blocks.find((candidate) => candidate.id === target.renderBlockId)
    : blocks.find((candidate) => candidate.block_index === target.blockIndex);
  if (!block || typeof block.plain_text !== "string") return null;
  const codePoints = Array.from(block.plain_text);
  if (end > codePoints.length) return null;
  const quote = codePoints.slice(start, end).join("");
  if (target.quote && target.quote !== quote) return null;
  return {
    renderBlockId: block.id,
    blockIndex: block.block_index,
    start,
    end,
    quote,
    prefix: codePoints.slice(Math.max(0, start - 80), start).join(""),
    suffix: codePoints.slice(end, end + 80).join(""),
  };
}

export function searchResultHref(item: SearchResultItem, destination: "conversation" | "library" = "conversation"): string {
  const params = new URLSearchParams();
  if (item.message_id) params.set("messageId", item.message_id);

  if (item.document_type === "attachment") {
    // Old responses without the additive identity still open the file list.
    params.delete("messageId");
    params.set("files", "open");
    if (item.attachment_id) {
      // File navigation must not depend on a possibly retired message target.
      params.set("attachmentId", item.attachment_id);
    }
  } else if (item.message_id) {
    // Annotation ranges belong to their saved anchor, not the comment's
    // search snippet. Legacy responses may still carry comment matches.
    const match = item.document_type === "annotation" ? undefined : item.matches?.[0];
    if (item.message_version_id) params.set("messageVersionId", item.message_version_id);
    const blockIndex = match?.block_index ?? item.block_index;
    if (blockIndex !== null && blockIndex !== undefined) params.set("blockIndex", String(blockIndex));
    const renderBlockId = match?.render_block_id ?? item.render_block_id;
    if (renderBlockId) params.set("renderBlockId", renderBlockId);
    const characterOffset = match?.match_start ?? item.character_offset;
    if (characterOffset !== null && characterOffset !== undefined) params.set("characterOffset", String(characterOffset));
    if (match && Number.isSafeInteger(match.match_start) && match.match_start >= 0
      && Number.isSafeInteger(match.match_end) && match.match_end > match.match_start) {
      params.set("endCharacterOffset", String(match.match_end));
    }
  }

  if (item.document_type === "annotation") {
    params.set("annotations", "open");
    if (item.annotation_id) params.set("annotationId", item.annotation_id);
  }
  if (destination === "library") {
    params.set("conversationId", item.conversation_id);
    return `/library?${params}`;
  }
  return `/conversations/${item.conversation_id}${params.size ? `?${params}` : ""}`;
}
