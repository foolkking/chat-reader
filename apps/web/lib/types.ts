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
