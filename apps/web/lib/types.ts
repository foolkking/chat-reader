export type HealthResponse = {
  status: "ok";
  service: "chat-reader-api";
  stage: "stage-00-foundation";
};

export type ThemeMode = "light" | "dark" | "system";
export type LocaleMode = "auto" | "zh-CN" | "en-US";
export type ResolvedTheme = "light" | "dark";
export type ResolvedLocale = "zh-CN" | "en-US";
export type ReaderWidthMode = "compact" | "standard" | "wide";
export type DialogueIndexPanelState = "rail" | "preview" | "pinned";
export type ReaderSidebarState = "collapsed" | "expanded";

export type UserPreferenceRead = {
  theme_mode: ThemeMode;
  locale_mode: LocaleMode;
  reader_width_mode: ReaderWidthMode;
  created_at: string;
  updated_at: string;
};

export type UserPreferenceUpdate = Partial<Pick<UserPreferenceRead, "theme_mode" | "locale_mode" | "reader_width_mode">>;

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

export type ConversationUpdateInput = {
  title?: string | null;
  display_title?: string | null;
  status?: "active" | "archived" | null;
};

export type ConversationManagementResponse = ConversationDetail;

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
  ordinal?: number | null;
  content_preview?: string | null;
  content_truncated?: boolean;
};

export type DialogueIndexItem = {
  message_id: string;
  role: string;
  role_number: number;
  ordinal: number;
  order_key: string;
  preview: string;
  turn_index: number | null;
};

export type DialogueIndexResponse = {
  conversation_id: string;
  items: DialogueIndexItem[];
  message_count: number;
  turn_count: number;
  limit: number;
  offset: number;
  total: number;
  has_previous: boolean;
  has_more: boolean;
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
  archive_summary?: Record<string, unknown> | null;
  duplicate_conversation_id?: string | null;
  compatibility?: string | null;
};

export type CommitImportResponse = {
  import_id: string;
  status: string;
  conversation_ids: string[];
  conversation_count: number;
  message_count: number;
  warnings: string[];
  phase: string;
  progress: number;
  processed_messages: number;
  total_messages: number;
  filename?: string | null;
  error_message?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  heartbeat_at?: string | null;
  completed_at?: string | null;
};

export type ImportStatusResponse = CommitImportResponse;
export type ActiveImportTask = ImportStatusResponse;

export type BackgroundTaskRead = {
  job_id: string;
  job_type: "import" | "conversation_merge" | string;
  status: "queued" | "processing" | "committed" | "failed" | string;
  phase: string;
  progress: number;
  processed_items: number;
  total_items: number;
  label: string | null;
  result: {
    conversation_ids?: string[];
    conversation_id?: string;
    title?: string;
    message_count?: number;
    artifact_id?: string;
    filename?: string;
    byte_size?: number;
    download_url?: string;
    cleaned_messages?: number;
  } & Record<string, unknown>;
  error_message: string | null;
  queued_at: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
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

export type ReadingAnchor = {
  position_mode: "block-relative-v1";
  order_key: string;
  ordinal: number | null;
  heading_block_index: number | null;
  current_version_id: string | null;
};

export type ReadingRestoreState = {
  status: "idle" | "loading" | "restoring" | "restored" | "failed";
  targetMessageId: string | null;
  targetBlockIndex: number | null;
};

export type PersistedSharePosition = {
  message_id: string;
  block_index: number | null;
  scroll_offset: number;
  anchor_data: ReadingAnchor;
  saved_at: string;
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
  occurrence_count: number;
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
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
};

export type MessageWindowResponse = {
  items: MessageListItem[];
  limit: number;
  offset: number;
  total: number;
  has_previous: boolean;
  has_more: boolean;
};

export type WindowGeneration = number;
export type ScrollDirection = "up" | "down" | null;

export type LoadedMessageWindow = {
  items: MessageListItem[];
  startOffset: number;
  endOffset: number;
  total: number;
  hasPrevious: boolean;
  hasMore: boolean;
  generation: WindowGeneration;
};

export type ScrollAnchorSnapshot = {
  targetId: string;
  offset: number;
};

export type MessageSplitResponse = {
  conversation_id: string;
  original_message_id: string;
  new_message_id: string;
  original_version_id: string;
  new_version_id: string;
};

export type MessageMergeResponse = {
  conversation_id: string;
  survivor_message_id: string;
  merged_message_ids: string[];
  current_version_id: string;
  version_number: number;
};

export type ConversationTransformResponse = {
  conversation_id: string;
  title: string;
  display_title: string;
  message_count: number;
};

export type NavigateTarget = {
  messageId: string;
  blockIndex?: number;
  alignmentOffset?: number;
  source?: "dialogue-index" | "section-toc" | "search" | "message-action";
};

export type NavigationResult = {
  ok: boolean;
  targetId: string;
  reason?: "cancelled" | "target-not-mounted" | "target-not-aligned" | "load-failed";
};

export type NavigationState = {
  token: number;
  activeMessageId: string | null;
  activeHeadingId: string | null;
  pendingTargetMessageId: string | null;
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

export type ShareRead = {
  id: string;
  conversation_id: string;
  token_prefix: string;
  title?: string | null;
  description?: string | null;
  scope: string;
  selected_message_ids?: string[];
  include_toc: boolean;
  include_metadata: boolean;
  allow_export: boolean;
  theme: ResolvedTheme;
  locale: ResolvedLocale;
  expires_at?: string | null;
  revoked_at?: string | null;
  access_count: number;
  last_accessed_at?: string | null;
  created_at: string;
  updated_at: string;
  share_url?: string | null;
};

export type ShareCreateInput = {
  title?: string | null;
  description?: string | null;
  scope?: "conversation" | "selected_messages";
  selected_message_ids?: string[];
  include_toc?: boolean;
  include_metadata?: boolean;
  allow_export?: boolean;
  expires_at?: string | null;
  theme?: ResolvedTheme | null;
  locale?: ResolvedLocale | null;
};

export type ShareCreateResponse = ShareRead & {
  token: string;
  share_url: string;
};

export type ShareUpdateInput = {
  title?: string | null;
  description?: string | null;
  expires_at?: string | null;
  theme?: ResolvedTheme | null;
  locale?: ResolvedLocale | null;
};

export type SharedConversationBootstrap = {
  share: ShareRead;
  conversation: ConversationListItem;
  message_count: number;
  turn_count: number;
  capabilities: {
    dialogue_index: boolean;
    toc: boolean;
    blocks: boolean;
    export: boolean;
  };
};
