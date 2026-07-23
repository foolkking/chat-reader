import {
  getConversation,
  getConversationDialogueIndex,
  getConversationMessageWindow,
  getConversationToc,
  getMessageBlocks,
  getReadingPosition,
  recordRecentConversation,
  saveReadingPosition,
} from "./api";
import { offlineDb } from "./offline-db";
import type {
  ConversationDetail,
  DialogueIndexResponse,
  MessageWindowResponse,
  ReadingPositionInput,
  ReadingPositionResponse,
  RenderBlockRead,
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

export interface ReaderDataSource {
  readonly mode: "remote" | "offline";
  getConversation(conversationId: string): Promise<ConversationDetail>;
  getMessageWindow(conversationId: string, options?: MessageWindowOptions): Promise<MessageWindowResponse>;
  getDialogueIndex(conversationId: string, options?: { offset?: number; limit?: number; anchorMessageId?: string }): Promise<DialogueIndexResponse>;
  getMessageBlocks(messageId: string, options?: { start?: number; limit?: number }): Promise<RenderBlockRead[]>;
  getToc(conversationId: string, options?: { messageId?: string; offset?: number; limit?: number; maxLevel?: number }): Promise<TocResponse>;
  getReadingPosition(conversationId: string): Promise<ReadingPositionResponse>;
  saveReadingPosition(conversationId: string, input: ReadingPositionInput): Promise<void>;
  recordRecent(conversationId: string, projectId?: string | null): Promise<void>;
}

export const remoteReaderDataSource: ReaderDataSource = {
  mode: "remote",
  getConversation,
  getMessageWindow: getConversationMessageWindow,
  getDialogueIndex: getConversationDialogueIndex,
  getMessageBlocks,
  getToc: getConversationToc,
  getReadingPosition,
  async saveReadingPosition(conversationId, input) { await saveReadingPosition(conversationId, input); },
  async recordRecent(conversationId, projectId) { await recordRecentConversation(conversationId, { project_id: projectId ?? null }); },
};

export const offlineReaderDataSource: ReaderDataSource = {
  mode: "offline",
  async getConversation(conversationId) {
    const conversation = await offlineDb.conversations.get(conversationId);
    if (!conversation) throw new Error("Conversation is not downloaded.");
    return conversation;
  },
  async getMessageWindow(conversationId, options = {}) {
    const all = await offlineDb.messages.where("conversation_id").equals(conversationId).sortBy("order_key");
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
        ? await offlineDb.blocks.where("message_id").equals(message.id).sortBy("block_index")
        : [],
    })));
    return { items: page, limit, offset, total: all.length, has_previous: offset > 0, has_more: offset + page.length < all.length };
  },
  async getDialogueIndex(conversationId, options = {}) {
    const all = await offlineDb.messages.where("conversation_id").equals(conversationId).sortBy("order_key");
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
      preview: previewText(message.current_version?.display_text ?? message.current_version?.plain_text ?? ""),
      turn_index: message.turn_index ?? null,
    }));
    const conversation = await offlineDb.conversations.get(conversationId);
    return { conversation_id: conversationId, items, message_count: all.length, turn_count: conversation?.turn_count ?? 0, limit, offset, total: all.length, has_previous: offset > 0, has_more: offset + items.length < all.length };
  },
  async getMessageBlocks(messageId, options = {}) {
    const blocks = await offlineDb.blocks.where("message_id").equals(messageId).sortBy("block_index");
    const start = options.start ?? 0;
    return blocks.filter((block) => block.block_index >= start).slice(0, options.limit ?? 50);
  },
  async getToc(conversationId, options = {}) {
    let items = await offlineDb.headings.where("conversation_id").equals(conversationId).sortBy("heading_index");
    if (options.messageId) items = items.filter((item) => item.message_id === options.messageId);
    if (options.maxLevel) items = items.filter((item) => item.level <= options.maxLevel!);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 200;
    const page = items.slice(offset, offset + limit);
    return { conversation_id: conversationId, items: page, limit, offset, total: items.length, has_more: offset + page.length < items.length };
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
  },
};

function previewText(value: string): string {
  return value.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~()]/g, " ").replaceAll("[", " ").replaceAll("]", " ").replace(/\s+/g, " ").trim().slice(0, 160);
}
