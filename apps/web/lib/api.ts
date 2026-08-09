import type {
  CommitImportResponse,
  BackgroundTaskRead,
  AnnotationCreateInput,
  AnnotationRead,
  AnnotationSyncOperation,
  AnnotationSyncResponse,
  AnnotationUpdateInput,
  AttachmentRead,
  AttachmentListRead,
  AttachmentUploadItemRead,
  AttachmentUploadSessionRead,
  CapabilitiesRead,
  ConversationEventListResponse,
  ConversationDetail,
  ConversationListItem,
  ConversationManagementResponse,
  ConversationCreateInput,
  ConversationCreateResponse,
  ConversationPlacementInput,
  ConversationPlacementResponse,
  ConversationUpdateInput,
  ConversationSortMode,
  DialogueIndexResponse,
  ConversationTransformResponse,
  ConversationSplitWorkspaceInput,
  ConversationSplitWorkspacePreview,
  ConversationSplitWorkspaceResponse,
  HealthResponse,
  ImportDuplicatePolicy,
  ImportPreviewResponse,
  BundlePreviewAccepted,
  ImportStatusResponse,
  NotebookRead,
  MessageEditResponse,
  MessageDeleteResponse,
  MessageInsertInput,
  MessageInsertResponse,
  MessageListItem,
  MessageMergeResponse,
  MessageSplitResponse,
  MessageVersionHistoryResponse,
  MessageVersionDeleteResponse,
  MessageWindowResponse,
  ReaderTurnResponse,
  ProjectConversationRead,
  ProjectCreate,
  ProjectRead,
  ProjectPlacementInput,
  ProjectUpdate,
  ProjectSortMode,
  ReadingPositionInput,
  ReadingPositionResponse,
  RecentItemInput,
  RecentItemRead,
  RenderBlockRead,
  SearchReindexResponse,
  SearchResponse,
  OfflineCatalogResponse,
  OfflinePackageQueued,
  ShareCreateInput,
  ShareCreateResponse,
  ShareRead,
  ShareUpdateInput,
  SharedConversationBootstrap,
  TocResponse,
  UserPreferenceRead,
  UserPreferenceUpdate,
  SortDirection,
} from "./types";

// Browser requests stay on the current Next.js origin. next.config.mjs proxies
// /api/* to FastAPI over the server-side API_INTERNAL_URL.
export const API_BASE_URL = "";

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/api/health");
}

export async function getCapabilities(): Promise<CapabilitiesRead> {
  return fetchJson<CapabilitiesRead>("/api/capabilities");
}

export async function getAttachment(attachmentId: string, shareToken?: string): Promise<AttachmentRead> {
  const path = shareToken
    ? `/api/shared/${encodeURIComponent(shareToken)}/attachments/${attachmentId}`
    : `/api/attachments/${attachmentId}`;
  return fetchJson<AttachmentRead>(path);
}

export async function getConversationAttachments(conversationId: string): Promise<AttachmentRead[]> {
  return (await fetchJson<AttachmentListRead>(`/api/conversations/${conversationId}/attachments`)).items;
}

export async function createAttachmentUploadSession(
  conversationId: string,
  input: { targetMessageId?: string; baseMessageVersionId?: string } = {},
): Promise<AttachmentUploadSessionRead> {
  return fetchJson<AttachmentUploadSessionRead>(
    `/api/conversations/${conversationId}/attachment-upload-sessions`,
    jsonRequest("POST", {
      target_message_id: input.targetMessageId,
      base_message_version_id: input.baseMessageVersionId,
    }),
  );
}

export function uploadAttachmentItem(
  sessionId: string,
  file: File,
  onProgress?: (progress: number) => void,
): { promise: Promise<AttachmentUploadItemRead>; cancel: () => void } {
  const request = new XMLHttpRequest();
  const promise = new Promise<AttachmentUploadItemRead>((resolve, reject) => {
    request.open("POST", `/api/attachment-upload-sessions/${sessionId}/items`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      let payload: unknown;
      try { payload = request.responseText ? JSON.parse(request.responseText) : null; } catch { payload = null; }
      if (request.status >= 200 && request.status < 300) resolve(payload as AttachmentUploadItemRead);
      else reject(new Error(readApiError(payload, request.status)));
    });
    request.addEventListener("error", () => reject(new Error("Attachment upload failed.")));
    request.addEventListener("abort", () => reject(new DOMException("Upload cancelled.", "AbortError")));
    const body = new FormData();
    body.append("file", file, file.name);
    request.send(body);
  });
  return { promise, cancel: () => request.abort() };
}

export async function finalizeConversationAttachments(conversationId: string, uploadItemIds: string[]): Promise<AttachmentRead[]> {
  return (await fetchJson<AttachmentListRead>(
    `/api/conversations/${conversationId}/attachments`,
    jsonRequest("POST", { upload_item_ids: uploadItemIds }),
  )).items;
}

export async function deleteAttachmentUploadItem(sessionId: string, itemId: string): Promise<void> {
  await fetchJson<void>(`/api/attachment-upload-sessions/${sessionId}/items/${itemId}`, { method: "DELETE" });
}

export async function updateConversationAttachment(conversationId: string, attachmentId: string, displayName: string): Promise<AttachmentRead> {
  return fetchJson<AttachmentRead>(
    `/api/conversations/${conversationId}/attachments/${attachmentId}`,
    jsonRequest("PATCH", { display_name: displayName }),
  );
}

export async function deleteConversationAttachment(conversationId: string, attachmentId: string): Promise<void> {
  await fetchJson<void>(`/api/conversations/${conversationId}/attachments/${attachmentId}`, { method: "DELETE" });
}

export async function getPreferences(): Promise<UserPreferenceRead> {
  return fetchJson<UserPreferenceRead>("/api/preferences");
}

export async function updatePreferences(input: UserPreferenceUpdate): Promise<UserPreferenceRead> {
  return fetchJson<UserPreferenceRead>("/api/preferences", jsonRequest("PATCH", input));
}

export async function getConversations(
  input: {
    includeArchived?: boolean;
    statusScope?: "active" | "archived" | "all";
    scope?: "all" | "history";
    sort?: ConversationSortMode;
    direction?: SortDirection;
    limit?: number;
  } = {},
): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (input.includeArchived) {
    params.set("include_archived", "true");
  }
  if (input.statusScope) params.set("status_scope", input.statusScope);
  if (input.scope) {
    params.set("scope", input.scope);
  }
  if (input.sort) params.set("sort", input.sort);
  if (input.direction) params.set("direction", input.direction);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return fetchJson<ConversationListItem[]>(`/api/conversations${query ? `?${query}` : ""}`);
}

export async function createConversation(input: ConversationCreateInput): Promise<ConversationCreateResponse> {
  return fetchJson<ConversationCreateResponse>("/api/conversations", jsonRequest("POST", input));
}

export async function insertConversationMessages(
  conversationId: string,
  input: MessageInsertInput,
): Promise<MessageInsertResponse> {
  return fetchJson<MessageInsertResponse>(
    `/api/conversations/${conversationId}/messages/insert`,
    jsonRequest("POST", input),
  );
}

export async function deleteMessage(messageId: string, expectedOfflineRevision?: number): Promise<MessageDeleteResponse> {
  const suffix = expectedOfflineRevision === undefined ? "" : `?expected_offline_revision=${expectedOfflineRevision}`;
  return fetchJson<MessageDeleteResponse>(`/api/messages/${messageId}${suffix}`, { method: "DELETE" });
}

export async function restoreDeletedMessage(messageId: string, expectedOfflineRevision?: number): Promise<MessageDeleteResponse> {
  const suffix = expectedOfflineRevision === undefined ? "" : `?expected_offline_revision=${expectedOfflineRevision}`;
  return fetchJson<MessageDeleteResponse>(`/api/messages/${messageId}/restore${suffix}`, jsonRequest("POST", {}));
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

export async function getConversationAnnotations(conversationId: string): Promise<AnnotationRead[]> {
  return fetchJson<AnnotationRead[]>(`/api/conversations/${conversationId}/annotations`);
}

export async function createConversationAnnotation(conversationId: string, input: AnnotationCreateInput): Promise<AnnotationRead> {
  return fetchJson<AnnotationRead>(`/api/conversations/${conversationId}/annotations`, jsonRequest("POST", input));
}

export async function updateConversationAnnotation(annotationId: string, input: AnnotationUpdateInput): Promise<AnnotationRead> {
  return fetchJson<AnnotationRead>(`/api/annotations/${annotationId}`, jsonRequest("PATCH", input));
}

export async function deleteConversationAnnotation(annotationId: string, baseRevision: number): Promise<void> {
  await fetchJson<void>(`/api/annotations/${annotationId}?base_revision=${baseRevision}`, { method: "DELETE" });
}

export async function syncConversationAnnotations(operations: AnnotationSyncOperation[]): Promise<AnnotationSyncResponse> {
  return fetchJson<AnnotationSyncResponse>("/api/annotations/sync", jsonRequest("POST", { operations }));
}

export async function getConversationNotebook(conversationId: string): Promise<NotebookRead> {
  return fetchJson<NotebookRead>(`/api/conversations/${conversationId}/notebook`);
}

export async function getConversationNotebookConflicts(conversationId: string): Promise<NotebookRead[]> {
  return fetchJson<NotebookRead[]>(`/api/conversations/${conversationId}/notebook/conflicts`);
}

export async function updateConversationNotebook(
  conversationId: string,
  input: Pick<NotebookRead, "title" | "blocks"> & { id?: string; base_revision: number },
): Promise<NotebookRead> {
  return fetchJson<NotebookRead>(`/api/conversations/${conversationId}/notebook`, jsonRequest("PUT", input));
}

export async function getOfflineCatalog(): Promise<OfflineCatalogResponse> {
  return fetchJson<OfflineCatalogResponse>("/api/offline/catalog");
}

export async function queueOfflinePackage(
  input: {
    scope: "conversation" | "project" | "all";
    conversation_id?: string;
    project_id?: string;
    known_revisions?: Record<string, number>;
    include_assets?: "none" | "small" | "all";
  },
): Promise<OfflinePackageQueued> {
  return fetchJson<OfflinePackageQueued>("/api/offline/packages", jsonRequest("POST", input));
}

export function getOfflinePackageDownloadUrl(packageId: string): string {
  return `${API_BASE_URL}/api/offline/packages/${packageId}/download`;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await fetchJson<void>(`/api/conversations/${conversationId}`, { method: "DELETE" });
}

export async function archiveConversation(conversationId: string): Promise<ConversationManagementResponse> {
  return fetchJson<ConversationManagementResponse>(`/api/conversations/${conversationId}/archive`, { method: "POST" });
}

export async function unarchiveConversation(conversationId: string): Promise<ConversationManagementResponse> {
  return fetchJson<ConversationManagementResponse>(`/api/conversations/${conversationId}/unarchive`, { method: "POST" });
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
    anchorBefore?: number;
    contentMode?: "full" | "preview";
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
  if (options.anchorBefore !== undefined) {
    params.set("anchor_before", String(options.anchorBefore));
  }
  if (options.contentMode) {
    params.set("content_mode", options.contentMode);
  }

  return fetchJson<MessageWindowResponse>(
    `/api/conversations/${conversationId}/message-window?${params.toString()}`,
  );
}

export async function getConversationReaderTurn(
  conversationId: string,
  anchorMessageId?: string,
): Promise<ReaderTurnResponse> {
  const params = new URLSearchParams();
  if (anchorMessageId) params.set("anchor_message_id", anchorMessageId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<ReaderTurnResponse>(`/api/conversations/${conversationId}/reader-turn${suffix}`);
}

export async function getConversationDialogueIndex(
  conversationId: string,
  options: { offset?: number; limit?: number; anchorMessageId?: string } = {},
): Promise<DialogueIndexResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 80),
  });
  if (options.anchorMessageId) params.set("anchor_message_id", options.anchorMessageId);
  return fetchJson<DialogueIndexResponse>(
    `/api/conversations/${conversationId}/dialogue-index?${params.toString()}`,
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
  idempotencyKey?: string;
}): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(
    "/api/conversations/merge",
    {
      ...jsonRequest("POST", {
        conversation_ids: input.conversationIds,
        title: input.title,
        project_id: input.projectId,
      }),
      headers: {
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
    },
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
  input: {
    contentMarkdown: string;
    editReason?: string;
    baseVersionId?: string;
    saveMode?: "create_version" | "replace_current";
    attachmentOccurrences?: Array<Record<string, unknown>>;
    removedAttachmentActions?: Array<Record<string, unknown>>;
  },
): Promise<MessageEditResponse> {
  return fetchJson<MessageEditResponse>(
    `/api/messages/${messageId}`,
    jsonRequest("PATCH", {
      content_markdown: input.contentMarkdown,
      edit_reason: input.editReason,
      base_version_id: input.baseVersionId,
      save_mode: input.saveMode ?? "create_version",
      attachment_occurrences: input.attachmentOccurrences ?? [],
      removed_attachment_actions: input.removedAttachmentActions ?? [],
    }),
  );
}

export async function toggleMessageTask(
  messageId: string,
  taskKey: string,
  input: { baseVersionId: string; checked: boolean },
): Promise<MessageEditResponse> {
  return fetchJson<MessageEditResponse>(
    `/api/messages/${messageId}/tasks/${encodeURIComponent(taskKey)}/toggle`,
    jsonRequest("POST", {
      base_version_id: input.baseVersionId,
      checked: input.checked,
    }),
  );
}

export async function selectMessageVersion(messageId: string, versionId: string): Promise<MessageEditResponse> {
  return fetchJson<MessageEditResponse>(
    `/api/messages/${messageId}/current-version`,
    jsonRequest("PUT", { version_id: versionId }),
  );
}

export async function deleteMessageVersion(messageId: string, versionId: string): Promise<MessageVersionDeleteResponse> {
  return fetchJson<MessageVersionDeleteResponse>(`/api/messages/${messageId}/versions/${versionId}`, { method: "DELETE" });
}

function splitWorkspaceBody(input: ConversationSplitWorkspaceInput) {
  return {
    mode: input.mode,
    start_message_id: input.startMessageId,
    end_message_id: input.endMessageId,
    boundary_message_id: input.boundaryMessageId,
    message_ids: input.messageIds ?? [],
    titles: input.titles ?? [],
    project_id: input.projectId,
  };
}

export async function previewConversationSplit(conversationId: string, input: ConversationSplitWorkspaceInput): Promise<ConversationSplitWorkspacePreview> {
  return fetchJson<ConversationSplitWorkspacePreview>(
    `/api/conversations/${conversationId}/split-workspace/preview`,
    jsonRequest("POST", splitWorkspaceBody(input)),
  );
}

export async function executeConversationSplit(conversationId: string, input: ConversationSplitWorkspaceInput): Promise<ConversationSplitWorkspaceResponse> {
  return fetchJson<ConversationSplitWorkspaceResponse>(
    `/api/conversations/${conversationId}/split-workspace`,
    jsonRequest("POST", splitWorkspaceBody(input)),
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

export async function previewAttachmentBundle(file: File): Promise<BundlePreviewAccepted> {
  const formData = new FormData();
  formData.append("file", file);
  return fetchJson<BundlePreviewAccepted>("/api/imports/bundles/preview", {
    method: "POST",
    body: formData,
  });
}

export async function getImportPreview(importId: string): Promise<ImportPreviewResponse> {
  return fetchJson<ImportPreviewResponse>(`/api/imports/${importId}/preview`);
}

export async function commitImport(
  importId: string,
  options: {
    duplicatePolicy?: ImportDuplicatePolicy | "copy";
    projectId?: string | null;
    createArchiveProject?: boolean;
  } = {},
): Promise<CommitImportResponse> {
  return fetchJson<CommitImportResponse>(`/api/imports/${importId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      duplicate_policy: options.duplicatePolicy ?? "clone",
      project_id: options.projectId ?? null,
      create_archive_project: options.createArchiveProject ?? false,
    }),
  });
}

export async function getActiveImports(): Promise<ImportStatusResponse[]> {
  return fetchJson<ImportStatusResponse[]>("/api/imports/active");
}

export async function getImportStatus(importId: string): Promise<ImportStatusResponse> {
  return fetchJson<ImportStatusResponse>(`/api/imports/${importId}/status`);
}

export async function getActiveTasks(): Promise<BackgroundTaskRead[]> {
  return fetchJson<BackgroundTaskRead[]>("/api/tasks/active");
}

export async function getTask(jobId: string): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(`/api/tasks/${jobId}`);
}

export async function retryTask(jobId: string): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(`/api/tasks/${jobId}/retry`, { method: "POST" });
}

export async function cancelTask(jobId: string): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(`/api/tasks/${jobId}/cancel`, { method: "POST" });
}

export async function getProjects(input: {
  includeArchived?: boolean;
  sort?: ProjectSortMode;
  direction?: SortDirection;
} = {}): Promise<ProjectRead[]> {
  const params = new URLSearchParams();
  if (input.includeArchived) params.set("include_archived", "true");
  if (input.sort) params.set("sort", input.sort);
  if (input.direction) params.set("direction", input.direction);
  return fetchJson<ProjectRead[]>(`/api/projects${params.size ? `?${params.toString()}` : ""}`);
}

export async function createProject(input: ProjectCreate): Promise<ProjectRead> {
  return fetchJson<ProjectRead>("/api/projects", jsonRequest("POST", input));
}

export async function updateProject(projectId: string, input: ProjectUpdate): Promise<ProjectRead> {
  return fetchJson<ProjectRead>(`/api/projects/${projectId}`, jsonRequest("PATCH", input));
}

export async function placeProject(projectId: string, input: ProjectPlacementInput): Promise<ProjectRead> {
  return fetchJson<ProjectRead>(`/api/projects/${projectId}/placement`, jsonRequest("PUT", input));
}

export async function getProjectConversations(
  projectId: string,
  input: { sort?: ConversationSortMode; direction?: SortDirection; limit?: number } = {},
): Promise<ProjectConversationRead[]> {
  const params = new URLSearchParams();
  if (input.sort) params.set("sort", input.sort);
  if (input.direction) params.set("direction", input.direction);
  if (input.limit) params.set("limit", String(input.limit));
  return fetchJson<ProjectConversationRead[]>(
    `/api/projects/${projectId}/conversations${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function updateProjectOrder(projectIds: string[]): Promise<void> {
  await fetchJson<void>("/api/projects/order", jsonRequest("PUT", { project_ids: projectIds }));
}

export async function updateConversationOrder(conversationIds: string[]): Promise<void> {
  await fetchJson<void>("/api/conversations/order", jsonRequest("PUT", { conversation_ids: conversationIds }));
}

export async function updateProjectConversationOrder(projectId: string, conversationIds: string[]): Promise<void> {
  await fetchJson<void>(
    `/api/projects/${projectId}/conversations/order`,
    jsonRequest("PUT", { conversation_ids: conversationIds }),
  );
}

export async function recordRecentProject(projectId: string): Promise<ProjectRead> {
  return fetchJson<ProjectRead>(`/api/projects/${projectId}/recent`, { method: "POST" });
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

export async function moveConversationToProject(
  conversationId: string,
  projectId: string | null,
): Promise<ConversationManagementResponse> {
  return fetchJson<ConversationManagementResponse>(
    `/api/conversations/${conversationId}/project`,
    jsonRequest("PUT", { project_id: projectId }),
  );
}

export async function placeConversation(
  conversationId: string,
  input: ConversationPlacementInput,
): Promise<ConversationPlacementResponse> {
  return fetchJson<ConversationPlacementResponse>(
    `/api/conversations/${conversationId}/placement`,
    jsonRequest("PUT", input),
  );
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

export function saveReadingPositionKeepalive(
  conversationId: string,
  input: ReadingPositionInput,
): void {
  void fetch(`/api/conversations/${conversationId}/reading-position`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  });
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
  role?: string;
  statusScope?: "active" | "archived" | "all";
  dateFrom?: string;
  dateTo?: string;
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
  if (input.role) {
    params.set("role", input.role);
  }
  if (input.statusScope) params.set("status_scope", input.statusScope);
  if (input.dateFrom) params.set("date_from", input.dateFrom);
  if (input.dateTo) params.set("date_to", input.dateTo);
  return fetchJson<SearchResponse>(`/api/search?${params.toString()}`);
}

export async function reindexSearch(input: { conversationId?: string } = {}): Promise<SearchReindexResponse> {
  return fetchJson<SearchReindexResponse>(
    "/api/search/reindex",
    jsonRequest("POST", input.conversationId ? { conversation_id: input.conversationId } : {}),
  );
}

export async function getConversationToc(
  conversationId: string,
  options: { messageId?: string; offset?: number; limit?: number; maxLevel?: number; role?: string; query?: string; startOrderKey?: string; endOrderKey?: string } = {},
): Promise<TocResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 200),
  });
  if (options.messageId) params.set("message_id", options.messageId);
  if (options.maxLevel) params.set("max_level", String(options.maxLevel));
  if (options.role) params.set("role", options.role);
  if (options.query) params.set("q", options.query);
  if (options.startOrderKey) params.set("start_order_key", options.startOrderKey);
  if (options.endOrderKey) params.set("end_order_key", options.endOrderKey);
  return fetchJson<TocResponse>(`/api/conversations/${conversationId}/toc?${params.toString()}`);
}

export async function queueConversationArchiveExport(
  conversationId: string,
  options: { includeDescription?: boolean; includeAnnotations?: boolean; includeNotebook?: boolean } = {},
): Promise<BackgroundTaskRead> {
  const params = new URLSearchParams({
    include_description: String(options.includeDescription ?? false),
    include_annotations: String(options.includeAnnotations ?? false),
    include_notebook: String(options.includeNotebook ?? false),
  });
  return fetchJson<BackgroundTaskRead>(`/api/conversations/${conversationId}/exports?${params.toString()}`, {
    method: "POST",
    headers: { "Idempotency-Key": `cr-export-${conversationId}-${Date.now()}` },
  });
}

export async function queueConversationContextPackageExport(
  conversationId: string,
  options: { scope: "full_conversation" | "reading_scope"; startMessageId?: string | null },
): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(`/api/conversations/${conversationId}/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `context-export-${conversationId}-${options.scope}-${Date.now()}`,
    },
    body: JSON.stringify({
      format: "context_package",
      context_scope: options.scope,
      start_message_id: options.scope === "reading_scope" ? options.startMessageId : null,
    }),
  });
}

export async function queueConversationAttachmentBundleExport(
  conversationId: string,
  format: "markdown_bundle" | "canjson_bundle",
  options: {
    includeDescription?: boolean;
    includeAnnotations?: boolean;
    includeNotebook?: boolean;
    includeSourceRefs?: boolean;
  } = {},
): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>(`/api/conversations/${conversationId}/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `${format}-${conversationId}-${Date.now()}`,
    },
    body: JSON.stringify({
      format,
      include_description: options.includeDescription ?? false,
      annotation_scope: options.includeAnnotations ? "all" : "none",
      notebook_scope: options.includeNotebook ? "current" : "none",
      include_source_refs: options.includeSourceRefs ?? true,
    }),
  });
}

export async function queueSystemArchiveExport(includeArchived: boolean): Promise<BackgroundTaskRead> {
  return fetchJson<BackgroundTaskRead>("/api/system/archive/exports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `system-archive-${includeArchived}-${Date.now()}`,
    },
    body: JSON.stringify({ include_archived: includeArchived }),
  });
}

export async function restoreSystemArchive(file: File): Promise<{ status: string; restored: Record<string, number> }> {
  const body = new FormData();
  body.append("file", file);
  return fetchJson<{ status: string; restored: Record<string, number> }>("/api/system/archive/restore", {
    method: "POST",
    body,
  });
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

export async function getSharedConversation(token: string): Promise<SharedConversationBootstrap> {
  const response = await fetchJson<SharedConversationBootstrap>(`/api/shared/${encodeURIComponent(token)}`);
  return { ...response, share: normalizeShareUrl(response.share) };
}

export async function getSharedMessageWindow(
  token: string,
  options: { offset?: number; limit?: number; anchorMessageId?: string; anchorBefore?: number } = {},
): Promise<MessageWindowResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 30),
  });
  if (options.anchorMessageId) params.set("anchor_message_id", options.anchorMessageId);
  if (options.anchorBefore !== undefined) params.set("anchor_before", String(options.anchorBefore));
  return fetchJson<MessageWindowResponse>(
    `/api/shared/${encodeURIComponent(token)}/message-window?${params.toString()}`,
  );
}

export async function getSharedReaderTurn(
  token: string,
  anchorMessageId?: string,
): Promise<ReaderTurnResponse> {
  const params = new URLSearchParams();
  if (anchorMessageId) params.set("anchor_message_id", anchorMessageId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<ReaderTurnResponse>(`/api/shared/${encodeURIComponent(token)}/reader-turn${suffix}`);
}

export async function getSharedDialogueIndex(
  token: string,
  options: { offset?: number; limit?: number; anchorMessageId?: string } = {},
): Promise<DialogueIndexResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 80),
  });
  if (options.anchorMessageId) params.set("anchor_message_id", options.anchorMessageId);
  return fetchJson<DialogueIndexResponse>(
    `/api/shared/${encodeURIComponent(token)}/dialogue-index?${params.toString()}`,
  );
}

export async function getSharedToc(
  token: string,
  options: { messageId?: string; offset?: number; limit?: number; maxLevel?: number } = {},
): Promise<TocResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 200),
  });
  if (options.messageId) params.set("message_id", options.messageId);
  if (options.maxLevel) params.set("max_level", String(options.maxLevel));
  return fetchJson<TocResponse>(`/api/shared/${encodeURIComponent(token)}/toc?${params.toString()}`);
}

export async function getSharedMessageBlocks(
  token: string,
  messageId: string,
  options: { start?: number; limit?: number } = {},
): Promise<RenderBlockRead[]> {
  const params = new URLSearchParams({
    start: String(options.start ?? 0),
    limit: String(options.limit ?? 200),
  });
  return fetchJson<RenderBlockRead[]>(
    `/api/shared/${encodeURIComponent(token)}/messages/${messageId}/blocks?${params.toString()}`,
  );
}

export function getConversationExportUrl(
  conversationId: string,
  options: {
    format: "markdown_v2" | "canjson_v2" | "markdown" | "canonical_json";
    includeMetadata?: boolean;
    includeToc?: boolean;
    includeVersions?: boolean;
    includeDescription?: boolean;
    includeAnnotations?: boolean;
    includeNotebook?: boolean;
    includeSourceRefs?: boolean;
    tocMode?: "none" | "message_index" | "bounded_headings";
    compression?: "none" | "gzip";
    messageIds?: string[];
  },
): string {
  if (options.format === "markdown_v2") {
    const params = new URLSearchParams({
      include_metadata: String(options.includeMetadata ?? true),
      include_description: String(options.includeDescription ?? false),
      toc_mode: options.tocMode ?? (options.includeToc ? "bounded_headings" : "none"),
      include_annotations: String(options.includeAnnotations ?? false),
      include_notebook: String(options.includeNotebook ?? false),
    });
    if (options.messageIds?.length) params.set("message_ids", options.messageIds.join(","));
    return `${API_BASE_URL}/api/conversations/${conversationId}/exports/markdown?${params.toString()}`;
  }
  if (options.format === "canjson_v2") {
    const params = new URLSearchParams({
      include_metadata: String(options.includeMetadata ?? true),
      include_description: String(options.includeDescription ?? false),
      include_versions: String(options.includeVersions ?? false),
      include_annotations: String(options.includeAnnotations ?? false),
      include_notebook: String(options.includeNotebook ?? false),
      include_source_refs: String(options.includeSourceRefs ?? true),
      compression: options.compression ?? "none",
    });
    if (options.messageIds?.length) params.set("message_ids", options.messageIds.join(","));
    return `${API_BASE_URL}/api/conversations/${conversationId}/exports/canjson?${params.toString()}`;
  }
  const params = new URLSearchParams({
    format: options.format,
    include_metadata: String(options.includeMetadata ?? true),
    include_toc: String(options.includeToc ?? true),
    include_versions: String(options.includeVersions ?? false),
    include_description: String(options.includeDescription ?? false),
    include_annotations: String(options.includeAnnotations ?? false),
    include_notebook: String(options.includeNotebook ?? false),
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
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
    });
  } catch {
    throw new Error("CONNECTION_FAILED");
  }

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

function readApiError(payload: unknown, statusCode: number): string {
  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return `Attachment upload returned ${statusCode}`;
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
