import type { OfflineCatalogResponse } from "./types";

export type OfflineDownloadScope = "conversation" | "project" | "all";

export function planOfflineConversationDownloads(
  catalog: OfflineCatalogResponse,
  scope: OfflineDownloadScope,
  scopeId: string | undefined,
  knownRevisions: Record<string, number>,
): string[] {
  const selectedIds = scope === "conversation"
    ? new Set(scopeId ? [scopeId] : [])
    : scope === "project"
      ? new Set(catalog.projects.find(project => project.id === scopeId)?.conversation_ids ?? [])
      : new Set(catalog.conversations.map(conversation => conversation.id));
  return catalog.conversations
    .filter(conversation => selectedIds.has(conversation.id) && knownRevisions[conversation.id] !== conversation.revision)
    .map(conversation => conversation.id);
}
