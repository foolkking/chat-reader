import type { NavigateTarget, ReadingPositionInput } from "../../lib/types";
import type { ConversationSearchPanelState, SearchNavigationTarget } from "../search/conversation-search-panel";

export const TOGETHER_MAX_TABS = 8;
export const TOGETHER_MIN_PANE = 520;
export function togetherExternalResultHref(conversationId: string, target: SearchNavigationTarget): string | undefined {
  const query = target.attachmentId ? new URLSearchParams({ files: "open", attachmentId: target.attachmentId })
    : target.annotationId ? new URLSearchParams({ annotations: "open", annotationId: target.annotationId }) : null;
  return query ? `/conversations/${encodeURIComponent(conversationId)}?${query}` : undefined;
}
export type TogetherSnapshot = {
  position: ReadingPositionInput | null; target?: NavigateTarget; title?: string;
  search?: ConversationSearchPanelState; searchOpen?: boolean;
};

export function targetFromReadingPosition(position: ReadingPositionInput | null | undefined): NavigateTarget | undefined {
  if (!position?.message_id) return undefined;
  const anchor = position.anchor_data ?? {};
  return {
    messageId: position.message_id, blockIndex: position.block_index ?? undefined,
    messageVersionId: typeof anchor.version_id === "string" ? anchor.version_id : undefined,
    characterOffset: typeof anchor.character_offset === "number" ? anchor.character_offset : undefined,
    source: "message-action", allowMessageFallback: true,
    alignmentOffset: typeof anchor.character_offset === "number" ? 120 : 120 - position.scroll_offset,
  };
}

export function togetherTarget(href: string): NavigateTarget | undefined {
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  const messageId = params.get("messageId");
  if (!messageId) return undefined;
  const integer = (name: string) => {
    const raw = params.get(name);
    return raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
  };
  return {
    messageId, messageVersionId: params.get("messageVersionId"), renderBlockId: params.get("renderBlockId"),
    annotationId: params.get("annotationId") ?? undefined,
    blockIndex: integer("blockIndex"), characterOffset: integer("characterOffset"), endCharacterOffset: integer("endCharacterOffset"),
    ...(integer("blockOffset") !== undefined && integer("characterOffset") === undefined ? { alignmentOffset: 120 - integer("blockOffset")! } : {}),
    source: "search", allowMessageFallback: true,
  };
}

/** Explicit hand-off only; this never writes a reading position. */
export function readingPositionHref(conversationId: string, position: ReadingPositionInput | null): string {
  const query = new URLSearchParams();
  if (position?.message_id) {
    query.set("messageId", position.message_id);
    if (position.block_index != null) query.set("blockIndex", String(position.block_index));
    if (typeof position.anchor_data?.version_id === "string") query.set("messageVersionId", position.anchor_data.version_id);
    if (typeof position.anchor_data?.character_offset === "number") query.set("characterOffset", String(position.anchor_data.character_offset));
    else query.set("blockOffset", String(Math.max(0, Math.round(position.scroll_offset))));
  }
  return `/conversations/${encodeURIComponent(conversationId)}${query.size ? `?${query}` : ""}`;
}
