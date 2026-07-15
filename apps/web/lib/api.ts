import type {
  CommitImportResponse,
  ConversationEventListResponse,
  ConversationDetail,
  ConversationListItem,
  ConversationManagementResponse,
  ConversationUpdateInput,
  ConversationTransformResponse,
  HealthResponse,
  ImportPreviewResponse,
  ImportStatusResponse,
  MessageEditResponse,
  MessageListItem,
  MessageMergeResponse,
  MessageSplitResponse,
  MessageVersionHistoryResponse,
  MessageWindowResponse,
  ProjectConversationRead,
  ProjectCreate,
  ProjectRead,
  ProjectUpdate,
  ReadingPositionInput,
  ReadingPositionResponse,
  RecentItemInput,
  RecentItemRead,
  RenderBlockRead,
  SearchReindexResponse,
  SearchResponse,
  ShareCreateInput,
  ShareCreateResponse,
  ShareRead,
  ShareUpdateInput,
  SharedConversationResponse,
  TocResponse,
} from "./types";

// Browser requests stay on the current Next.js origin. next.config.mjs proxies
// /api/* to FastAPI over the server-side API_INTERNAL_URL.
export const API_BASE_URL = "";

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/api/health");
}

export async function getConversations(input: { includeArchived?: boolean } = {}): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (input.includeArchived) {
    params.set("include_archived", "true");
  }
  const query = params.toString();
  return fetchJson<ConversationListItem[]>(`/api/conversations${query ? `?${query}` : ""}`);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  return fetchJson<ConversationDetail>(`/api/conversations/${conversationId}`);
}

export async function updateConversation(
  conversationId: string,
  input: ConversationUpdateInput,
): Promise<ConversationManagementResponse> {
  return fetchJson<ConversationManagementResponse>(
    `/api/conversations/${conversationId}`,
    jsonRequest("PATCH", input),
  );
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await fetchJson<void>(`/api/conversations/${conversationId}`, { method: "DELETE" });
}

export async function archiveConversation(conversationId: string): Promise<ConversationManagementResponse> {
  return updateConversation(conversationId, { status: "archived" });
}

export async function restoreConversation(conversationId: string): Promise<ConversationManagementResponse> {
  return updateConversation(conversationId, { status: "active" });
}

export async function getConversationMessages(
  conversationId: string,
  options: { includeBlocks?: boolean; limit?: number; offset?: number } = {},
): Promise<MessageListItem[]> {
  const params = new URLSearchParams({
    include_blocks: String(options.includeBlocks ?? true),
    limit: String(options.limit ?? 200),
    offset: String(options.offset ?? 0),
  });

  return fetchJson<MessageListItem[]>(
    `/api/conversations/${conversationId}/messages?${params.toString()}`,
  );
}

export async function getConversationMessageWindow(
  conversationId: string,
  options: {
    includeBlocks?: boolean;
    limit?: number;
    offset?: number;
    anchorMessageId?: string;
    anchorOrderKey?: string;
  } = {},
): Promise<MessageWindowResponse> {
  const params = new URLSearchParams({
    include_blocks: String(options.includeBlocks ?? true),
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.anchorMessageId) {
    params.set("anchor_message_id", options.anchorMessageId);
  }
  if (options.anchorOrderKey) {
    params.set("anchor_order_key", options.anchorOrderKey);
  }

  return fetchJson<MessageWindowResponse>(
    `/api/conversations/${conversationId}/message-window?${params.toString()}`,
  );
}

export async function getMessageBlocks(
  messageId: string,
  options: { start?: number; limit?: number } = {},
): Promise<RenderBlockRead[]> {
  const params = new URLSearchParams({
    start: String(options.start ?? 0),
    limit: String(options.limit ?? 50),
  });

  return fetchJson<RenderBlockRead[]>(`/api/messages/${messageId}/blocks?${params.toString()}`);
}

export async function splitMessage(
  messageId: string,
  input: { splitOffset: number; editReason?: string },
): Promise<MessageSplitResponse> {
  return fetchJson<MessageSplitResponse>(
    `/api/messages/${messageId}/split`,
    jsonRequest("POST", {
      split_offset: input.splitOffset,
      edit_reason: input.editReason,
    }),
  );
}

export async function mergeMessages(input: {
  messageIds: string[];
  separator?: string;
  editReason?: string;
}): Promise<MessageMergeResponse> {
  return fetchJson<MessageMergeResponse>(
    "/api/messages/merge",
    jsonRequest("POST", {
      message_ids: input.messageIds,
      separator: input.separator ?? "\n\n",
      edit_reason: input.editReason,
    }),
  );
}

export async function mergeConversations(input: {
  conversationIds: string[];
  title?: string;
  projectId?: string;
}): Promise<ConversationTransformResponse> {
  return fetchJson<ConversationTransformResponse>(
    "/api/conversations/merge",
    jsonRequest("POST", {
      conversation_ids: input.conversationIds,
      title: input.title,
      project_id: input.projectId,
    }),
  );
}

export async function splitConversation(
  conversationId: string,
  input: { startMessageId: string; endMessageId?: string; title?: string; projectId?: string },
): Promise<ConversationTransformResponse> {
  return fetchJson<ConversationTransformResponse>(
    `/api/conversations/${conversationId}/split`,
    jsonRequest("POST", {
      start_message_id: input.startMessageId,
      end_message_id: input.endMessageId,
      title: input.title,
      project_id: input.projectId,
    }),
  );
}

export async function editMessage(
  messageId: string,
  input: { displayText: string; editReason?: string; baseVersionId?: string },
): Promise<MessageEditResponse> {
  return fetchJson<MessageEditResponse>(
    `/api/messages/${messageId}`,
    jsonRequest("PATCH", {
      display_text: input.displayText,
      edit_reason: input.editReason,
      base_version_id: input.baseVersionId,
    }),
  );
}

export async function getMessageVersions(messageId: string): Promise<MessageVersionHistoryResponse> {
  return fetchJson<MessageVersionHistoryResponse>(`/api/messages/${messageId}/versions`);
}

export async function restoreMessageVersion(
  messageId: string,
  versionId: string,
  input: { editReason?: string } = {},
): Promise<MessageEditResponse> {
  return fetchJson<MessageEditResponse>(
    `/api/messages/${messageId}/versions/${versionId}/restore`,
    jsonRequest("POST", { edit_reason: input.editReason }),
  );
}

export async function previewImport(files: File[]): Promise<ImportPreviewResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  return fetchJson<ImportPreviewResponse>("/api/imports/preview", {
    method: "POST",
    body: formData,
  });
}

export async function commitImport(importId: string): Promise<CommitImportResponse> {
  return fetchJson<CommitImportResponse>(`/api/imports/${importId}/commit`, {
    method: "POST",
  });
}

export async function getActiveImports(): Promise<ImportStatusResponse[]> {
  return fetchJson<ImportStatusResponse[]>("/api/imports/active");
}

export async function getImportStatus(importId: string): Promise<ImportStatusResponse> {
  return fetchJson<ImportStatusResponse>(`/api/imports/${importId}/status`);
}

export async function getProjects(): Promise<ProjectRead[]> {
  return fetchJson<ProjectRead[]>("/api/projects");
}

export async function createProject(input: ProjectCreate): Promise<ProjectRead> {
  return fetchJson<ProjectRead>("/api/projects", jsonRequest("POST", input));
}

export async function updateProject(projectId: string, input: ProjectUpdate): Promise<ProjectRead> {
  return fetchJson<ProjectRead>(`/api/projects/${projectId}`, jsonRequest("PATCH", input));
}

export async function getProjectConversations(projectId: string): Promise<ProjectConversationRead[]> {
  return fetchJson<ProjectConversationRead[]>(`/api/projects/${projectId}/conversations`);
}

export async function addConversationToProject(
  projectId: string,
  conversationId: string,
): Promise<ProjectConversationRead> {
  return fetchJson<ProjectConversationRead>(
    `/api/projects/${projectId}/conversations/${conversationId}`,
    { method: "POST" },
  );
}

export async function removeConversationFromProject(projectId: string, conversationId: string): Promise<void> {
  await fetchJson<void>(`/api/projects/${projectId}/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function addConversationToProjectMembership(
  conversationId: string,
  projectId: string,
): Promise<ConversationManagementResponse> {
  return fetchJson<ConversationManagementResponse>(
    `/api/conversations/${conversationId}/projects/${projectId}`,
    { method: "POST" },
  );
}

export async function removeConversationFromProjectMembership(
  conversationId: string,
  projectId: string,
): Promise<void> {
  await fetchJson<void>(`/api/conversations/${conversationId}/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function setProjectConversationPin(
  projectId: string,
  conversationId: string,
  isPinned: boolean,
): Promise<ProjectConversationRead> {
  return fetchJson<ProjectConversationRead>(
    `/api/projects/${projectId}/conversations/${conversationId}/pin`,
    jsonRequest("PATCH", { is_pinned: isPinned }),
  );
}

export async function setConversationGlobalPin(
  conversationId: string,
  isPinned: boolean,
): Promise<ConversationDetail> {
  return fetchJson<ConversationDetail>(
    `/api/conversations/${conversationId}/pin`,
    jsonRequest("PATCH", { is_pinned: isPinned }),
  );
}

export async function getReadingPosition(conversationId: string): Promise<ReadingPositionResponse> {
  return fetchJson<ReadingPositionResponse>(`/api/conversations/${conversationId}/reading-position`);
}

export async function saveReadingPosition(
  conversationId: string,
  input: ReadingPositionInput,
): Promise<ReadingPositionResponse["position"]> {
  return fetchJson<ReadingPositionResponse["position"]>(
    `/api/conversations/${conversationId}/reading-position`,
    jsonRequest("PUT", input),
  );
}

export async function recordRecentConversation(
  conversationId: string,
  input: RecentItemInput = {},
): Promise<RecentItemRead> {
  return fetchJson<RecentItemRead>(
    `/api/conversations/${conversationId}/recent`,
    jsonRequest("POST", input),
  );
}

export async function getRecentItems(): Promise<RecentItemRead[]> {
  return fetchJson<RecentItemRead[]>("/api/recent-items");
}

export async function searchConversations(input: {
  q: string;
  limit?: number;
  offset?: number;
  conversationId?: string;
  projectId?: string;
  documentType?: string;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: input.q,
    limit: String(input.limit ?? 20),
    offset: String(input.offset ?? 0),
  });
  if (input.conversationId) {
    params.set("conversation_id", input.conversationId);
  }
  if (input.projectId) {
    params.set("project_id", input.projectId);
  }
  if (input.documentType) {
    params.set("document_type", input.documentType);
  }
  return fetchJson<SearchResponse>(`/api/search?${params.toString()}`);
}

export async function reindexSearch(input: { conversationId?: string } = {}): Promise<SearchReindexResponse> {
  return fetchJson<SearchReindexResponse>(
    "/api/search/reindex",
    jsonRequest("POST", input.conversationId ? { conversation_id: input.conversationId } : {}),
  );
}

export async function getConversationToc(conversationId: string): Promise<TocResponse> {
  return fetchJson<TocResponse>(`/api/conversations/${conversationId}/toc`);
}

export async function createShare(
  conversationId: string,
  input: ShareCreateInput,
): Promise<ShareCreateResponse> {
  const share = await fetchJson<ShareCreateResponse>(
    `/api/conversations/${conversationId}/shares`,
    jsonRequest("POST", input),
  );
  return normalizeShareUrl(share);
}

export async function getConversationShares(conversationId: string): Promise<ShareRead[]> {
  const shares = await fetchJson<ShareRead[]>(`/api/conversations/${conversationId}/shares`);
  return shares.map(normalizeShareUrl);
}

export async function revokeShare(shareId: string): Promise<ShareRead> {
  return normalizeShareUrl(await fetchJson<ShareRead>(`/api/shares/${shareId}/revoke`, { method: "POST" }));
}

export async function updateShare(shareId: string, input: ShareUpdateInput): Promise<ShareRead> {
  return normalizeShareUrl(await fetchJson<ShareRead>(`/api/shares/${shareId}`, jsonRequest("PATCH", input)));
}

export async function getSharedConversation(token: string): Promise<SharedConversationResponse> {
  const response = await fetchJson<SharedConversationResponse>(`/api/shared/${encodeURIComponent(token)}`);
  return { ...response, share: normalizeShareUrl(response.share) };
}

export function getConversationExportUrl(
  conversationId: string,
  options: {
    format: "markdown" | "canonical_json";
    includeMetadata?: boolean;
    includeToc?: boolean;
    includeVersions?: boolean;
    messageIds?: string[];
  },
): string {
  const params = new URLSearchParams({
    format: options.format,
    include_metadata: String(options.includeMetadata ?? true),
    include_toc: String(options.includeToc ?? true),
    include_versions: String(options.includeVersions ?? false),
  });
  if (options.messageIds?.length) {
    params.set("message_ids", options.messageIds.join(","));
  }
  return `${API_BASE_URL}/api/conversations/${conversationId}/export?${params.toString()}`;
}

export async function getConversationEvents(
  conversationId: string,
  options: { limit?: number; offset?: number; eventType?: string } = {},
): Promise<ConversationEventListResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.eventType) {
    params.set("event_type", options.eventType);
  }
  return fetchJson<ConversationEventListResponse>(
    `/api/conversations/${conversationId}/events?${params.toString()}`,
  );
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, path));
  }
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function getErrorMessage(response: Response, path: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown; error?: { message?: string } };
    if (typeof payload.error?.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    // The response body is not guaranteed to be JSON.
  }

  return `${path} returned ${response.status}`;
}

function normalizeShareUrl<T extends ShareRead>(share: T): T {
  if (!share.share_url || typeof window === "undefined") {
    return share;
  }
  try {
    const url = new URL(share.share_url);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
      return { ...share, share_url: `${window.location.origin}${url.pathname}${url.search}${url.hash}` };
    }
  } catch {
    // Preserve malformed legacy values so the management UI can report them.
  }
  return share;
}
