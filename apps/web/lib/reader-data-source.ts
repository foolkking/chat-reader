import {
  getConversation,
  getConversationDialogueIndex,
  getConversationReaderTurn,
  getConversationMessageWindow,
  getConversationToc,
  getMessageBlocks,
  getReadingPosition,
  recordRecentConversation,
  saveReadingPosition,
  searchConversations,
} from "./api";
import { offlineDb, type OfflineMessageRecord } from "./offline-db";
import { searchOffline } from "./offline-search";
import type {
  ConversationDetail,
  ConversationListItem,
  DialogueIndexResponse,
  MessageWindowResponse,
  ReaderTurnResponse,
  NavigateTarget,
  ReadingPositionInput,
  ReadingPositionResponse,
  RenderBlockRead,
  SearchMatch,
  SearchResponse,
  TocItem,
  TocResponse,
} from "./types";

export type MessageWindowOptions = {
  includeBlocks?: boolean;
  limit?: number;
  offset?: number;
  anchorMessageId?: string;
  anchorOrderKey?: string;
  anchorBefore?: number;
  contentMode?: "full" | "preview";
};

export type ReaderSearchOptions = {
  query: string;
  documentType?: string;
  role?: string;
  limit?: number;
};

export type TocOptions = {
  messageId?: string;
  offset?: number;
  limit?: number;
  maxLevel?: number;
  role?: string;
  query?: string;
  startOrderKey?: string;
  endOrderKey?: string;
};

export type ReaderTargetContext = {
  readerTurn: ReaderTurnResponse;
  messageWindow: MessageWindowResponse;
  targetMessage: MessageWindowResponse["items"][number];
  targetBlocks: RenderBlockRead[];
  dialogueIndex: DialogueIndexResponse;
  toc: TocResponse;
  nearestHeading: TocItem | null;
};

// Concurrent navigation requests often ask for the same target turn (for
// example a citation click and the reader's initial restore). Deduplicate the
// network work without retaining user content beyond the request lifetime.
const readerTurnInflight = new Map<string, Promise<ReaderTurnResponse>>();
const targetContextInflight = new Map<string, Promise<ReaderTargetContext>>();

function getRemoteReaderTurn(conversationId: string, anchorMessageId?: string): Promise<ReaderTurnResponse> {
  const key = `${conversationId}:${anchorMessageId ?? "first"}`;
  const existing = readerTurnInflight.get(key);
  if (existing) return existing;
  const request = getConversationReaderTurn(conversationId, anchorMessageId).finally(() => {
    if (readerTurnInflight.get(key) === request) readerTurnInflight.delete(key);
  });
  readerTurnInflight.set(key, request);
  return request;
}

export interface ReaderDataSource {
  readonly mode: "remote" | "offline";
  readonly capabilities: {
    canonicalManagement: boolean;
    attachments: "manage" | "read-only" | "none";
    share: boolean;
    export: boolean;
  };
  getConversation(conversationId: string): Promise<ConversationDetail>;
  getMessageWindow(conversationId: string, options?: MessageWindowOptions): Promise<MessageWindowResponse>;
  getReaderTurn(conversationId: string, anchorMessageId?: string): Promise<ReaderTurnResponse>;
  getDialogueIndex(conversationId: string, options?: { offset?: number; limit?: number; anchorMessageId?: string }): Promise<DialogueIndexResponse>;
  getMessageBlocks(messageId: string, options?: { start?: number; limit?: number }): Promise<RenderBlockRead[]>;
  getToc(conversationId: string, options?: TocOptions): Promise<TocResponse>;
  getTargetContext(conversationId: string, target: NavigateTarget, options?: { includeNavigation?: boolean }): Promise<ReaderTargetContext>;
  searchConversation(conversationId: string, options: ReaderSearchOptions): Promise<SearchResponse>;
  getReadingPosition(conversationId: string): Promise<ReadingPositionResponse>;
  saveReadingPosition(conversationId: string, input: ReadingPositionInput): Promise<void>;
  recordRecent(conversationId: string, projectId?: string | null): Promise<ConversationListItem | null>;
}

export const remoteReaderDataSource: ReaderDataSource = {
  mode: "remote",
  capabilities: { canonicalManagement: true, attachments: "manage", share: true, export: true },
  getConversation,
  getMessageWindow: getConversationMessageWindow,
  getReaderTurn: getRemoteReaderTurn,
  getDialogueIndex: getConversationDialogueIndex,
  getMessageBlocks,
  getToc: getConversationToc,
  getTargetContext(conversationId, target, options) {
    const key = [
      conversationId,
      target.messageId,
      target.messageVersionId ?? "",
      target.renderBlockId ?? "",
      target.occurrenceKey ?? "",
      target.canonicalStart ?? target.characterOffset ?? "",
      target.canonicalEnd ?? target.endCharacterOffset ?? "",
      options?.includeNavigation ? "navigation" : "target",
    ].join(":");
    const existing = targetContextInflight.get(key);
    if (existing) return existing;
    const request = loadTargetContext(remoteReaderDataSource, conversationId, target, options).finally(() => {
      if (targetContextInflight.get(key) === request) targetContextInflight.delete(key);
    });
    targetContextInflight.set(key, request);
    return request;
  },
  searchConversation(conversationId, options) {
    return searchConversations({
      q: options.query,
      conversationId,
      documentType: options.documentType,
      role: options.role,
      limit: options.limit ?? 50,
    });
  },
  getReadingPosition,
  async saveReadingPosition(conversationId, input) { await saveReadingPosition(conversationId, input); },
  async recordRecent(conversationId, projectId) {
    const recent = await recordRecentConversation(conversationId, { project_id: projectId ?? null });
    return recent.conversation;
  },
};

export const offlineReaderDataSource: ReaderDataSource = {
  mode: "offline",
  capabilities: { canonicalManagement: false, attachments: "read-only", share: false, export: true },
  async getConversation(conversationId) {
    const conversation = await offlineDb.conversations.get(conversationId);
    if (!conversation) throw new Error("Conversation is not downloaded.");
    return conversation;
  },
  async getMessageWindow(conversationId, options = {}) {
    const all = await getOfflineConversationMessages(conversationId);
    const limit = options.limit ?? 50;
    let offset = options.offset ?? 0;
    if (options.anchorMessageId) {
      const anchor = all.findIndex((message) => message.id === options.anchorMessageId);
      if (anchor >= 0) offset = Math.max(0, Math.min(Math.max(all.length - limit, 0), anchor - (options.anchorBefore ?? 12)));
    } else if (options.anchorOrderKey) {
      const anchor = all.findIndex((message) => message.order_key === options.anchorOrderKey);
      if (anchor >= 0) offset = Math.max(0, Math.min(Math.max(all.length - limit, 0), anchor - (options.anchorBefore ?? 12)));
    }
    const page = await Promise.all(all.slice(offset, offset + limit).map(async (message) => ({
      ...message,
      render_blocks: options.includeBlocks
        ? await getOfflineMessageBlocks(message.id)
        : [],
    })));
    return { items: page, limit, offset, total: all.length, has_previous: offset > 0, has_more: offset + page.length < all.length };
  },
  async getReaderTurn(conversationId, anchorMessageId) {
    const all = await getOfflineConversationMessages(conversationId);
    if (all.length === 0) {
      return { conversation_id: conversationId, turn_key: "empty", start_offset: 0, end_offset: 0, total_messages: 0, items: [], previous_anchor_message_id: null, next_anchor_message_id: null };
    }
    const ranges = readerTurnRanges(all);
    const anchorIndex = anchorMessageId ? all.findIndex((message) => message.id === anchorMessageId) : 0;
    if (anchorIndex < 0) throw new Error("Anchor message not found.");
    const rangeIndex = ranges.findIndex((range) => range.start <= anchorIndex && anchorIndex < range.end);
    const range = ranges[rangeIndex];
    const items = await Promise.all(all.slice(range.start, range.end).map(async (message, index) => ({
      ...message,
      ordinal: range.start + index + 1,
      render_blocks: await getOfflineMessageBlocks(message.id),
      content_preview: null,
      content_truncated: false,
    })));
    return {
      conversation_id: conversationId,
      turn_key: `turn-${rangeIndex}`,
      start_offset: range.start,
      end_offset: range.end,
      total_messages: all.length,
      items,
      previous_anchor_message_id: rangeIndex > 0 ? all[ranges[rangeIndex - 1].start].id : null,
      next_anchor_message_id: rangeIndex + 1 < ranges.length ? all[ranges[rangeIndex + 1].start].id : null,
    };
  },
  async getDialogueIndex(conversationId, options = {}) {
    const all = await getOfflineConversationMessages(conversationId);
    const limit = options.limit ?? 80;
    let offset = options.offset ?? 0;
    if (options.anchorMessageId) {
      const anchor = all.findIndex((message) => message.id === options.anchorMessageId);
      if (anchor >= 0) offset = Math.max(0, Math.min(Math.max(all.length - limit, 0), anchor - Math.floor(limit / 2)));
    }
    const roleCounts = new Map<string, number>();
    const roleNumbers = all.map((message) => {
      const next = (roleCounts.get(message.role) ?? 0) + 1;
      roleCounts.set(message.role, next);
      return next;
    });
    const items = all.slice(offset, offset + limit).map((message, index) => ({
      message_id: message.id,
      role: message.role,
      role_number: roleNumbers[offset + index],
      ordinal: offset + index + 1,
      order_key: message.order_key,
      preview: previewText(message.content_preview ?? message.current_version?.display_text ?? message.current_version?.plain_text ?? ""),
      turn_index: message.turn_index ?? null,
    }));
    const conversation = await offlineDb.conversations.get(conversationId);
    return { conversation_id: conversationId, items, message_count: all.length, turn_count: conversation?.turn_count ?? 0, limit, offset, total: all.length, has_previous: offset > 0, has_more: offset + items.length < all.length };
  },
  async getMessageBlocks(messageId, options = {}) {
    const blocks = await getOfflineMessageBlocks(messageId);
    const start = options.start ?? 0;
    return blocks.filter((block) => block.block_index >= start).slice(0, options.limit ?? 50);
  },
  async getToc(conversationId, options = {}) {
    let items = await offlineDb.headings.where("conversation_id").equals(conversationId).sortBy("heading_index");
    if (options.messageId) items = items.filter((item) => item.message_id === options.messageId);
    if (options.maxLevel) items = items.filter((item) => item.level <= options.maxLevel!);
    if (options.query) {
      const query = options.query.toLocaleLowerCase();
      items = items.filter((item) => item.text.toLocaleLowerCase().includes(query));
    }
    if (options.startOrderKey) items = items.filter((item) => item.message_order_key >= options.startOrderKey!);
    if (options.endOrderKey) items = items.filter((item) => item.message_order_key <= options.endOrderKey!);
    if (options.role) {
      const messages = await getOfflineConversationMessages(conversationId);
      const roles = new Map(messages.map((message) => [message.id, message.role]));
      items = items.filter((item) => roles.get(item.message_id) === options.role);
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 200;
    const page = items.slice(offset, offset + limit);
    return { conversation_id: conversationId, items: page, limit, offset, total: items.length, has_more: offset + page.length < items.length };
  },
  getTargetContext(conversationId, target, options) {
    return loadTargetContext(offlineReaderDataSource, conversationId, target, options);
  },
  async searchConversation(conversationId, options) {
    const limit = options.limit ?? 50;
    const documents = (await searchOffline(options.query, Math.max(limit * 4, 100)))
      .filter((item) => item.conversation_id === conversationId)
      .filter((item) => !options.documentType || item.document_type === options.documentType)
      .filter((item) => !options.role || item.role === options.role)
      .slice(0, limit);
    const items = await Promise.all(documents.map(async (item, index) => {
      const message = item.message_id ? await offlineDb.messages.get(item.message_id) : null;
      const requestedBlockIndex = metadataNumber(item.metadata, "block_index");
      const blocks = message
        ? (await offlineDb.blocks.where("message_id").equals(message.id).sortBy("block_index"))
          .filter((block) => requestedBlockIndex === null || block.block_index === requestedBlockIndex)
        : [];
      const candidates = blocks.length
        ? blocks.map((block) => ({ blockIndex: block.block_index, renderBlockId: block.id, text: block.plain_text ?? "" }))
        : [{ blockIndex: requestedBlockIndex, renderBlockId: null, text: item.plain_text }];
      const matches = candidates.flatMap((candidate) => findOfflineSearchMatches(candidate.text, options.query, candidate.blockIndex, candidate.renderBlockId)).slice(0, 100);
      const firstMatch = matches[0];
      const snippet = firstMatch
        ? `${firstMatch.context_before ? "..." : ""}${firstMatch.context_before}${firstMatch.quote}${firstMatch.context_after}${firstMatch.context_after ? "..." : ""}`
        : item.plain_text.slice(0, 320);
      return {
        document_id: item.id,
        document_type: item.document_type,
        conversation_id: item.conversation_id,
        conversation_title: item.title ?? "Conversation",
        message_id: item.message_id,
        message_version_id: message?.current_version?.id ?? null,
        role: item.role,
        order_key: item.order_key,
        block_index: firstMatch?.block_index ?? requestedBlockIndex,
        render_block_id: firstMatch?.render_block_id ?? null,
        character_offset: firstMatch?.match_start ?? metadataNumber(item.metadata, "character_offset"),
        snippet,
        rank: documents.length - index,
        source_profile: "offline",
        occurrence_count: matches.length || 1,
        matches,
        annotation_id: typeof item.metadata.annotation_id === "string" ? item.metadata.annotation_id : null,
        annotation_type: typeof item.metadata.annotation_type === "string" ? item.metadata.annotation_type : null,
        annotation_color: typeof item.metadata.annotation_color === "string" ? item.metadata.annotation_color : null,
      };
    }));
    return {
      query: options.query,
      items,
      limit,
      offset: 0,
      total: documents.length,
    };
  },
  async getReadingPosition(conversationId) {
    return { conversation_id: conversationId, position: await offlineDb.readingPositions.get(conversationId) ?? null };
  },
  async saveReadingPosition(conversationId, input) {
    const current = await offlineDb.readingPositions.get(conversationId);
    const now = new Date().toISOString();
    await offlineDb.readingPositions.put({
      id: current?.id ?? crypto.randomUUID(),
      conversation_id: conversationId,
      message_id: input.message_id ?? null,
      block_index: input.block_index ?? null,
      scroll_offset: input.scroll_offset,
      anchor_data: input.anchor_data ?? {},
      created_at: current?.created_at ?? now,
      updated_at: now,
    });
  },
  async recordRecent(conversationId) {
    await offlineDb.conversations.update(conversationId, { last_read_at: new Date().toISOString() });
    return null;
  },
};

/**
 * Read the canonical message set for an offline conversation. The indexed
 * query is the fast path, but packages created with the pre-v2 Dexie schema
 * can contain records whose index was not rebuilt after an upgrade. Falling
 * back to a primary-table scan keeps those already-downloaded conversations
 * readable and is only used when the indexed result is unexpectedly empty.
 */
async function getOfflineConversationMessages(conversationId: string): Promise<OfflineMessageRecord[]> {
  const id = String(conversationId);
  const indexed = await offlineDb.messages.where("conversation_id").equals(id).sortBy("order_key");
  if (indexed.length > 0) return indexed;
  const fallback = (await offlineDb.messages.toArray())
    .filter((message) => String(message.conversation_id) === id)
    .sort((left, right) => left.order_key.localeCompare(right.order_key));
  return fallback;
}

async function getOfflineMessageBlocks(messageId: string): Promise<RenderBlockRead[]> {
  const id = String(messageId);
  const indexed = await offlineDb.blocks.where("message_id").equals(id).sortBy("block_index");
  if (indexed.length > 0) return indexed;
  return (await offlineDb.blocks.toArray())
    .filter((block) => String(block.message_id) === id)
    .sort((left, right) => left.block_index - right.block_index);
}

function findOfflineSearchMatches(text: string, query: string, blockIndex: number | null, renderBlockId: string | null = null): SearchMatch[] {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  if (!normalizedText || !normalizedQuery) return [];
  const lowerText = normalizedText.toLocaleLowerCase();
  const lowerQuery = normalizedQuery.toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let cursor = 0;
  while (cursor <= lowerText.length - lowerQuery.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) break;
    matches.push(offlineSearchMatch(normalizedText, index, index + normalizedQuery.length, blockIndex, renderBlockId));
    cursor = index + Math.max(1, normalizedQuery.length);
  }
  if (!matches.length) {
    const token = lowerQuery.split(/\s+/).find(Boolean);
    if (token) {
      const index = lowerText.indexOf(token);
      if (index >= 0) matches.push(offlineSearchMatch(normalizedText, index, index + token.length, blockIndex, renderBlockId));
    }
  }
  return matches;
}

function offlineSearchMatch(text: string, start: number, end: number, blockIndex: number | null, renderBlockId: string | null): SearchMatch {
  const beforeStart = Math.max(0, start - 80);
  const afterEnd = Math.min(text.length, end + 80);
  return {
    block_index: blockIndex,
    render_block_id: renderBlockId,
    match_start: start,
    match_end: end,
    quote: text.slice(start, end),
    context_before: text.slice(beforeStart, start),
    context_after: text.slice(end, afterEnd),
  };
}

const LEADING_TIMESTAMP_RE = /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\s*$/;
const THINKING_DURATION_RE = /^(?:\u5df2?\s*\u601d\u8003(?:\u4e86)?|thinking|reasoning)\s*[:\uff1a]?\s*(?:\d+\s*(?:h|hr|hour|\u5c0f\u65f6)\s*)?(?:\d+\s*(?:m|min|\u5206\u949f|\u5206)\s*)?\d+\s*(?:s|sec|\u79d2)$/i;
const MARKDOWN_FENCE_RE = /^\s*(?:`{3,}|~{3,})/;
const MARKDOWN_BLOCK_PREFIX_RE = /^\s*(?:#{1,6}\s+|>+\s*|[-+*]\s+|\d+[.)]\s+)/;

function previewText(value: string): string {
  let lines = value.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && !lines[0].trim()) lines.shift();

  const firstLine = lines[0]?.trim().replace(/^>+\s*/, "").trim();
  if (firstLine && LEADING_TIMESTAMP_RE.test(firstLine)) lines.shift();

  const thinkingLineIndex = lines.slice(0, 40).findIndex((line) =>
    THINKING_DURATION_RE.test(line.trim().replace(/^>+\s*/, "").trim()),
  );
  if (thinkingLineIndex >= 0) lines = lines.slice(thinkingLineIndex + 1);

  const plainLines: string[] = [];
  for (const line of lines) {
    let text = line.trim();
    if (!text || MARKDOWN_FENCE_RE.test(text) || /^[-*_]{3,}$/.test(text)) continue;
    let previous = "";
    while (previous !== text) {
      previous = text;
      text = text.replace(MARKDOWN_BLOCK_PREFIX_RE, "").trim();
    }
    text = text
      .replace(/^\[[ xX]\]\s+/, "")
      .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)/g, "$1")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`\n]+)`+/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
      .trim()
      .replace(/^\|+|\|+$/g, "")
      .trim();
    if (text) plainLines.push(text);
  }

  return plainLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 160);
}

async function loadTargetContext(
  dataSource: ReaderDataSource,
  conversationId: string,
  target: NavigateTarget,
  options: { includeNavigation?: boolean } = {},
): Promise<ReaderTargetContext> {
  const turnPromise = dataSource.getReaderTurn(conversationId, target.messageId);
  // A target only needs the auxiliary projection that owns its navigation
  // surface. Loading both the dialogue rail and the TOC for every annotation
  // or heading jump doubled request and parsing work on long conversations.
  const includeDialogueIndex = Boolean(options.includeNavigation && !target.preferTocPipeline);
  const includeToc = Boolean(options.includeNavigation && target.preferTocPipeline);
  const dialogueIndexPromise = includeDialogueIndex
    ? dataSource.getDialogueIndex(conversationId, { anchorMessageId: target.messageId, limit: 80 }).catch(() => emptyDialogueIndex(conversationId))
    : Promise.resolve(emptyDialogueIndex(conversationId));
  const tocPromise = includeToc
    ? dataSource.getToc(conversationId, { messageId: target.messageId, limit: 200 }).catch(() => emptyToc(conversationId))
    : Promise.resolve(emptyToc(conversationId));
  const [turn, dialogueIndex, toc] = await Promise.all([turnPromise, dialogueIndexPromise, tocPromise]);
  // The dialogue index is an auxiliary projection and can legitimately lag
  // after merge/delete. The canonical turn response remains the authority;
  // do not fail an otherwise valid target just because the index is stale.
  const messageWindow: MessageWindowResponse = {
    items: turn.items,
    limit: turn.items.length,
    offset: turn.start_offset,
    total: turn.total_messages,
    has_previous: turn.previous_anchor_message_id !== null,
    has_more: turn.next_anchor_message_id !== null,
  };
  const targetMessage = messageWindow.items.find((item) => item.id === target.messageId);
  if (!targetMessage) throw new Error("The target message could not be loaded.");
  const resolvedBlockIndex = target.blockIndex ?? (
    target.renderBlockId
      ? targetMessage.render_blocks?.find((block) => block.id === target.renderBlockId)?.block_index
      : undefined
  );
  const targetBlocks = targetMessage.render_blocks ?? [];
  const nearestHeading = resolvedBlockIndex === undefined
    ? null
    : toc.items.filter((item) => item.block_index <= resolvedBlockIndex).at(-1) ?? null;
  return { readerTurn: turn, messageWindow, targetMessage, targetBlocks, dialogueIndex, toc, nearestHeading };
}

function emptyDialogueIndex(conversationId: string): DialogueIndexResponse {
  return {
    conversation_id: conversationId,
    items: [],
    message_count: 0,
    turn_count: 0,
    limit: 0,
    offset: 0,
    total: 0,
    has_previous: false,
    has_more: false,
  };
}

function emptyToc(conversationId: string): TocResponse {
  return { conversation_id: conversationId, items: [], limit: 0, offset: 0, total: 0, has_more: false };
}

function readerTurnRanges(messages: MessageWindowResponse["items"]): Array<{ start: number; end: number }> {
  const userRoles = new Set(["user", "prompt", "human"]);
  const ranges: Array<{ start: number; end: number }> = [];
  if (messages.some((message) => userRoles.has(message.role.toLowerCase()))) {
    let start = 0;
    messages.forEach((message, index) => {
      if (index > 0 && userRoles.has(message.role.toLowerCase())) {
        ranges.push({ start, end: index });
        start = index;
      }
    });
    ranges.push({ start, end: messages.length });
    return ranges;
  }
  if (messages.some((message) => message.turn_index !== null && message.turn_index !== undefined)) {
    let start = 0;
    let previous: number | string | null = messages[0].turn_index ?? "synthetic-0";
    messages.slice(1).forEach((message, relativeIndex) => {
      const index = relativeIndex + 1;
      const current = message.turn_index ?? `synthetic-${index}`;
      if (current !== previous) {
        ranges.push({ start, end: index });
        start = index;
      }
      previous = current;
    });
    ranges.push({ start, end: messages.length });
    return ranges;
  }
  return messages.map((_, index) => ({ start: index, end: index + 1 }));
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
