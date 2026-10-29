import type { MessageListItem, ReaderTurnResponse } from "../../lib/types";

export type ReaderTurnGroup = {
  key: string;
  messageIds: string[];
  firstMessageId: string;
};

/**
 * Fold controls follow the server's complete-turn boundaries, not role guesses
 * or the optional per-message turn_index field.
 */
export function buildReaderTurnGroups(
  turns: ReaderTurnResponse[],
  messages: MessageListItem[],
): ReaderTurnGroup[] {
  const loadedIds = new Set(messages.map((message) => message.id));
  const groups: ReaderTurnGroup[] = [];
  const assigned = new Set<string>();
  for (const turn of turns) {
    const messageIds = turn.items.map((message) => message.id).filter((id) => loadedIds.has(id) && !assigned.has(id));
    if (!messageIds.length) continue;
    groups.push({ key: turn.turn_key, messageIds, firstMessageId: messageIds[0] });
    messageIds.forEach((id) => assigned.add(id));
  }
  for (const message of messages) {
    if (assigned.has(message.id)) continue;
    groups.push({ key: `message:${message.id}`, messageIds: [message.id], firstMessageId: message.id });
  }
  return groups;
}
