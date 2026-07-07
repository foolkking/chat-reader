export type HealthResponse = {
  status: "ok";
  service: "chat-reader-api";
  stage: "stage-00-foundation";
};

export type ConversationListItem = {
  id: string;
  title: string;
  display_title: string;
  source_type: string;
  source_profile: string;
  message_count: number;
  turn_count: number;
  created_at: string | null;
  updated_at: string | null;
  imported_at: string | null;
  first_user_message: string | null;
  status: string;
  is_global_pinned: boolean;
  global_pinned_at: string | null;
};

export type ConversationDetail = ConversationListItem & {
  external_source_id: string | null;
  parser_version: string;
  render_version: number;
  content_hash: string | null;
  sort_time: string | null;
};

export type RenderBlockRead = {
  id?: string;
  block_index: number;
  block_type: "paragraph" | "heading" | "code" | string;
  plain_text?: string | null;
  data: Record<string, unknown>;
  char_count?: number;
  collapsed_by_default?: boolean;
  render_priority?: number;
};

export type MessageVersionRead = {
  id: string;
  version_number: number;
  plain_text?: string;
  display_text?: string;
  blocks?: RenderBlockRead[];
  edit_type?: string;
  created_at?: string;
  created_by?: string;
  content_hash?: string;
};

export type MessageListItem = {
  id: string;
  conversation_id: string;
  role: string;
  order_key: string;
  turn_index?: number | null;
  created_at?: string | null;
  current_version?: MessageVersionRead | null;
  render_blocks?: RenderBlockRead[];
  block_count: number;
  char_count: number;
  is_heavy: boolean;
};

export type ImportPreviewFile = {
  artifact_id: string;
  filename: string;
  source_profile: string;
  confidence: number;
  sha256: string;
  byte_size: number;
  mime_guess: string | null;
  file_extension: string | null;
  raw_storage_uri: string;
  warnings: string[];
};

export type MessagePreview = {
  role: string;
  order_key: string;
  plain_text_preview: string;
  display_text_preview: string;
  warnings: string[];
};

export type ConversationPreview = {
  title: string;
  source_type: string;
  source_profile: string;
  alignment_status: string;
  message_count: number;
  prompt_count: number;
  response_count: number;
  empty_message_count: number;
  cleaned_thinking_summary_count: number;
  first_user_message?: string | null;
  node_count?: number | null;
  message_node_count?: number | null;
  primary_path_length?: number | null;
  branch_count?: number;
  branch_node_count?: number;
  has_branches?: boolean;
  warnings: string[];
  messages: MessagePreview[];
};

export type ImportPreviewResponse = {
  import_id: string;
  status: string;
  files: ImportPreviewFile[];
  conversation_preview?: ConversationPreview | null;
  conversation_previews?: ConversationPreview[];
  can_commit?: boolean;
  commit_endpoint?: string | null;
  warnings?: string[];
};

export type CommitImportResponse = {
  import_id: string;
  status: string;
  conversation_ids: string[];
  conversation_count: number;
  message_count: number;
  warnings: string[];
};

export type ProjectRead = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  conversation_count: number;
  pinned_count: number;
};

export type ProjectCreate = {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
};

export type ProjectUpdate = Partial<ProjectCreate> & {
  sort_order?: number;
  is_archived?: boolean;
};

export type ProjectConversationRead = ConversationListItem & {
  project_relation: {
    is_pinned: boolean;
    pinned_at: string | null;
    added_at: string;
    sort_order: number;
  };
};

export type ReadingPositionRead = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  block_index: number | null;
  scroll_offset: number;
  anchor_data: Record<string, unknown>;
  updated_at: string;
  created_at: string;
};

export type ReadingPositionResponse = {
  conversation_id: string;
  position: ReadingPositionRead | null;
};

export type ReadingPositionInput = {
  message_id?: string | null;
  block_index?: number | null;
  scroll_offset: number;
  anchor_data?: Record<string, unknown>;
};

export type RecentItemRead = {
  id: string;
  conversation_id: string;
  project_id: string | null;
  last_message_id: string | null;
  last_opened_at: string;
  open_count: number;
  context: Record<string, unknown>;
  conversation: ConversationListItem;
};

export type RecentItemInput = {
  project_id?: string | null;
  last_message_id?: string | null;
  context?: Record<string, unknown>;
};

export type SearchResultItem = {
  document_id: string;
  document_type: string;
  conversation_id: string;
  conversation_title: string;
  message_id: string | null;
  role: string | null;
  order_key: string | null;
  snippet: string;
  rank: number;
  source_profile: string | null;
};

export type SearchResponse = {
  query: string;
  items: SearchResultItem[];
  limit: number;
  offset: number;
  total: number;
};

export type SearchReindexResponse = {
  conversation_count: number;
  indexed_count: number;
  heading_count: number;
};

export type TocItem = {
  id: string;
  heading_index: number;
  level: number;
  text: string;
  slug: string;
  message_id: string;
  message_order_key: string;
  block_index: number;
};

export type TocResponse = {
  conversation_id: string;
  items: TocItem[];
};

export type MessageWindowResponse = {
  items: MessageListItem[];
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
};

export type MessageEditResponse = {
  message_id: string;
  conversation_id: string;
  previous_version_id?: string | null;
  current_version_id: string;
  version_number: number;
  message: MessageListItem;
  warnings?: string[];
};

export type MessageVersionHistoryItem = {
  id: string;
  version_number: number;
  plain_text?: string;
  display_text?: string;
  edit_type: string;
  edit_reason?: string | null;
  created_at: string;
  created_by: string;
  based_on_version_id?: string | null;
  content_hash: string;
  is_current: boolean;
};

export type MessageVersionHistoryResponse = {
  message_id: string;
  current_version_id: string | null;
  items: MessageVersionHistoryItem[];
};

export type ConversationEventRead = {
  id: string;
  event_type: string;
  target_message_id: string | null;
  target_version_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  created_by: string;
};

export type ConversationEventListResponse = {
  items: ConversationEventRead[];
  limit: number;
  offset: number;
  total: number;
};
