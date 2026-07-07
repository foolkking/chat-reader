import type {
  CommitImportResponse,
  ConversationDetail,
  ConversationListItem,
  HealthResponse,
  ImportPreviewResponse,
  MessageListItem,
  RenderBlockRead,
} from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/api/health");
}

export async function getConversations(): Promise<ConversationListItem[]> {
  return fetchJson<ConversationListItem[]>("/api/conversations");
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  return fetchJson<ConversationDetail>(`/api/conversations/${conversationId}`);
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
