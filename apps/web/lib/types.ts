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
export type ReaderDensityMode = "compact" | "comfortable" | "large";
export type SectionTocMode = "visible" | "rail";
export type SortDirection = "asc" | "desc";
export type ConversationSortMode = "recent_read" | "updated" | "created" | "imported" | "title" | "message_count" | "custom";
export type ProjectSortMode = "recent_read" | "updated" | "created" | "title" | "conversation_count" | "custom";
export type DialogueIndexPanelState = "rail" | "preview" | "pinned";
export type ReaderSidebarState = "collapsed" | "expanded";
export type ReaderUtilityPanel = null | "navigation" | "search" | "share" | "export" | "files";
export type HeaderActionRailState = "collapsed" | "expanded";

export type NeighborhoodExpansionState = {
  active: boolean;
  current: number;
  total: number;
  error: string | null;
};

export type UserPreferenceRead = {
  theme_mode: ThemeMode;
  locale_mode: LocaleMode;
  reader_width_mode: ReaderWidthMode;
  reader_density_mode: ReaderDensityMode;
  reader_font_size_px: number;
  section_toc_mode: SectionTocMode;
  conversation_sort_mode: ConversationSortMode;
  conversation_sort_direction: SortDirection;
  project_sort_mode: ProjectSortMode;
  project_sort_direction: SortDirection;
  created_at: string;
  updated_at: string;
};

export type UserPreferenceUpdate = Partial<Pick<UserPreferenceRead,
  "theme_mode" | "locale_mode" | "reader_width_mode" | "reader_density_mode" | "reader_font_size_px" | "section_toc_mode" | "conversation_sort_mode" |
  "conversation_sort_direction" | "project_sort_mode" | "project_sort_direction"
>>;

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
  description_markdown: string | null;
  project_id: string | null;
  project_name: string | null;
  offline_revision: number;
  status: string;
  is_global_pinned: boolean;
  global_pinned_at: string | null;
  last_read_at: string | null;
  reading_progress?: number | null;
  manual_sort_order: number;
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
  description_markdown?: string | null;
};

export type ConversationManagementResponse = ConversationDetail;

export type ConversationCreateInput = {
  title: string;
  project_id?: string | null;
  messages: [
    { role: "user"; content_markdown: string },
    { role: "assistant"; content_markdown: string },
  ];
};

export type ConversationCreateResponse = {
  conversation: ConversationDetail;
  messages: MessageListItem[];
};

export type MessageInsertInput = {
  anchor_message_id: string;
  position: "before" | "after";
  mode: "single" | "pair";
  messages: Array<{ role?: "user" | "assistant" | null; content_markdown: string }>;
  expected_offline_revision?: number;
};

export type MessageInsertResponse = {
  conversation: ConversationDetail;
  messages: MessageListItem[];
};

export type MessageDeleteResponse = {
  message_id: string;
  conversation_id: string;
  deleted: boolean;
  conversation_revision: number;
  message: MessageListItem;
};

export type ConversationPlacementInput = {
  target_project_id: string | null;
  target_section?: "pinned" | "normal";
  before_conversation_id?: string | null;
  after_conversation_id?: string | null;
  expected_offline_revision?: number;
};

export type ConversationPlacementResponse = {
  conversation: ConversationListItem;
  placement: {
    project_id: string | null;
    target_section: "pinned" | "normal";
    sort_order: number;
    is_pinned: boolean;
    offline_revision: number;
  };
  source_project_count: number;
  target_project_count: number;
  unclassified_count: number;
};

export type ProjectPlacementInput = {
  before_project_id?: string | null;
  after_project_id?: string | null;
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

export type AttachmentRead = {
  id: string;
  conversation_id: string;
  asset_object: {
    id: string;
    sha256: string;
    byte_size: number;
    detected_mime_type: string;
    detected_extension?: string | null;
    scan_status: string;
    status: string;
  } | null;
  original_filename: string;
  display_name: string;
  declared_mime_type?: string | null;
  detected_mime_type?: string | null;
  status: string;
  scan_status: string;
  source_type: string;
  source_attachment_id?: string | null;
  metadata: Record<string, unknown>;
  resolution_status: string;
  created_at: string;
  occurrence_count?: number;
  current_occurrence_count?: number;
  message_count?: number;
  is_used?: boolean;
  occurrences?: Array<{
    message_id: string;
    message_version_id: string;
    is_current_version: boolean;
    message_order_key?: string | null;
    message_role?: string | null;
    message_preview?: string | null;
    version_number?: number | null;
    occurrence_key: string;
    placement: string;
    block_index?: number | null;
  }>;
  content_url?: string | null;
  download_url?: string | null;
};

export type AttachmentListRead = { items: AttachmentRead[] };

export type AttachmentUploadItemRead = {
  id: string;
  client_filename: string;
  declared_mime_type?: string | null;
  detected_mime_type?: string | null;
  byte_size: number;
  sha256?: string | null;
  validation_status: string;
  scan_status: string;
  error_code?: string | null;
  created_at: string;
};

export type AttachmentUploadSessionRead = {
  id: string;
  conversation_id: string;
  target_message_id?: string | null;
  base_message_version_id?: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  items: AttachmentUploadItemRead[];
};

export type CapabilitiesRead = {
  attachments: {
    upload_enabled: boolean;
    scanner_provider: string;
    scanner_enabled: boolean;
    allow_unscanned_attachments: boolean;
    unscanned_status: string;
    basic_preview_enabled: boolean;
    complex_preview_enabled: boolean;
    max_file_size_bytes: number;
    viewer?: boolean;
    range?: boolean;
    imageDerivatives?: boolean;
    textSearch?: boolean;
    batchDownload?: boolean;
  };
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
  warnings: string[];
};

export type MessagePreview = {
  role: string;
  order_key: string;
  plain_text_preview: string;
  display_text_preview: string;
  source_json_index?: number | null;
  source_markdown_index?: number | null;
  created_at?: string | null;
  alignment_status: "exact" | "normalized" | "by_order" | "json_only" | "markdown_only" | "ambiguous" | string;
  warnings: string[];
};

export type ImportAlignmentIssue = {
  source: "json" | "markdown";
  source_index: number;
  role: string;
  timestamp?: string | null;
  reason: "unmatched" | "ambiguous" | "content_mismatch" | string;
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
  first_user_message_markdown?: string | null;
  node_count?: number | null;
  message_node_count?: number | null;
  primary_path_length?: number | null;
  branch_count?: number;
  branch_node_count?: number;
  has_branches?: boolean;
  alignment_summary?: Record<string, number>;
  alignment_issues?: ImportAlignmentIssue[];
  ignored_json_empty_count?: number;
  ignored_markdown_empty_count?: number;
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

export type ImportDuplicatePolicy = "clone" | "reject" | "replace" | "merge_if_same_hash";

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

export type AdaptiveImportDiagnostic = {
  code: string;
  layer: string;
  message: string;
  pointer?: string | null;
  blocking?: boolean;
  action?: string | null;
  group_id?: string | null;
  values?: string[];
};

export type AdaptiveImportGroup = {
  id: string;
  mode: "JSON" | "MARKDOWN" | "JSON_MARKDOWN" | "UNKNOWN";
  display_name: string;
  artifact_ids: string[];
  grouping_status: string;
  family_id: string | null;
  profile_resolution: Record<string, unknown>;
  diagnostics: AdaptiveImportDiagnostic[];
  files: Array<{ artifact_id: string; filename: string; extension: string; byte_size: number }>;
};

export type AdaptiveImportFamily = {
  id: string;
  source_mode: "JSON" | "MARKDOWN" | "JSON_MARKDOWN";
  display_name: string;
  resolution_status: "EXACT_MATCH" | "COMPATIBLE" | "DRIFTED" | "AMBIGUOUS" | "UNKNOWN" | "INVALID";
  group_count: number;
  group_ids: string[];
  matched_profile_key: string | null;
  matched_profile_id: string | null;
  matched_revision_id: string | null;
  mapping_draft: Record<string, unknown>;
  validation_result: Record<string, unknown>;
  match_evidence: Record<string, unknown>;
  diagnostics: AdaptiveImportDiagnostic[];
};

export type AdaptiveImportSession = {
  import_id: string;
  state: "COLLECTING" | "ANALYZING" | "NEEDS_GROUPING" | "RESOLVING" | "READY" | "IMPORTING" | "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELED";
  status: string;
  file_count: number;
  total_bytes: number;
  group_count: number;
  family_count: number;
  conversation_count: number;
  message_count: number;
  can_import: boolean;
  groups: AdaptiveImportGroup[];
  families: AdaptiveImportFamily[];
  warnings: string[];
  analysis_summary: Record<string, unknown>;
};

export type AdaptiveMappingPreview = {
  sample_group_id: string | null;
  validation: {
    valid: boolean;
    conversation_count: number;
    message_count: number;
    issues: AdaptiveImportDiagnostic[];
    groups: Array<Record<string, unknown>>;
    verified_on_full_family: boolean;
  };
  preview: null | {
    title: string;
    message_count: number;
    messages: Array<{ role: string; content: string; timestamp: string | null }>;
  };
};

export type ImportFormatProfile = {
  id: string | null;
  key: string | null;
  name: string;
  kind: "BUILTIN" | "LEARNED";
  source_mode: "JSON" | "MARKDOWN" | "JSON_MARKDOWN";
  status: "ACTIVE" | "DISABLED";
  current_revision: number | null;
  current_revision_id: string | null;
  revision_count: number | null;
  last_used_at: string | null;
  updated_at: string | null;
  description?: string;
};

export type ImportFormatRevision = {
  id: string;
  revision: number;
  status: "DRAFT" | "VERIFIED" | "SUPERSEDED";
  mapping_spec: Record<string, unknown>;
  validation_spec: Record<string, unknown>;
  verification_summary: Record<string, unknown>;
  created_at: string;
  verified_at: string | null;
  current: boolean;
};

export type BackgroundTaskRead = {
  job_id: string;
  job_type: "import" | "conversation_merge" | string;
  status: "queued" | "processing" | "cancelling" | "cancelled" | "committed" | "failed" | string;
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
  cancellable: boolean;
  attempt_count: number;
};

export type TocRefreshInput = {
  refreshDialogueIndex: boolean;
  refreshSectionToc: boolean;
  sectionScope: "current_conversation" | "all_conversations";
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
  last_read_at: string | null;
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
  position_mode: "block-relative-v1" | "block-relative-v2";
  order_key: string;
  ordinal: number | null;
  heading_block_index: number | null;
  current_version_id: string | null;
  block_id?: string | null;
  version_id?: string | null;
  block_offset?: number | null;
  character_offset?: number | null;
  scroll_ratio?: number | null;
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
  message_version_id?: string | null;
  role: string | null;
  order_key: string | null;
  block_index: number | null;
  character_offset?: number | null;
  snippet: string;
  rank: number;
  source_profile: string | null;
  occurrence_count: number;
  matches?: SearchMatch[];
  annotation_id?: string | null;
  annotation_type?: string | null;
  annotation_color?: string | null;
};

export type SearchMatch = {
  block_index: number | null;
  match_start: number;
  match_end: number;
  quote: string;
  context_before: string;
  context_after: string;
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

export type ReaderTurnResponse = {
  conversation_id: string;
  turn_key: string;
  start_offset: number;
  end_offset: number;
  total_messages: number;
  items: MessageListItem[];
  previous_anchor_message_id: string | null;
  next_anchor_message_id: string | null;
};

export type WindowGeneration = number;
export type ScrollDirection = "up" | "down" | null;

export type LoadedMessageWindow = {
  items: MessageListItem[];
  turns: ReaderTurnResponse[];
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
  messageVersionId?: string | null;
  blockIndex?: number;
  characterOffset?: number;
  endCharacterOffset?: number;
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  anchorStatus?: AnnotationAnchorStatus;
  annotationId?: string;
  preferTocPipeline?: boolean;
  closePanelAfterResolved?: boolean;
  allowMessageFallback?: boolean;
  alignmentOffset?: number;
  source?: "dialogue-index" | "section-toc" | "search" | "annotation" | "message-action";
};

export type NavigationResult = {
  ok: boolean;
  targetId: string;
  fallback?: boolean;
  reason?: "cancelled" | "target-context-failed" | "target-not-mounted" | "block-not-found" | "target-not-aligned" | "load-failed" | "stale-anchor" | "message-fallback";
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
  message_version: MessageVersionRead;
  render_blocks: RenderBlockRead[];
  attachment_occurrences: Array<{
    id: string;
    message_version_id: string;
    attachment: AttachmentRead;
    occurrence_key: string;
    placement: string;
    relation_type: string;
    display_order: number;
    block_index?: number | null;
    display_mode: string;
    alt_text?: string | null;
    caption?: string | null;
  }>;
  conversation_attachment_summary: { total?: number; used?: number; missing?: number };
  conversation_revision: number;
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
  is_initial: boolean;
  can_delete: boolean;
};

export type MessageVersionHistoryResponse = {
  message_id: string;
  current_version_id: string | null;
  items: MessageVersionHistoryItem[];
};

export type MessageVersionDeleteResponse = {
  message_id: string;
  deleted_version_id: string;
  current_version_id: string;
  message: MessageListItem;
  conversation_revision: number;
  warnings: string[];
};

export type ConversationSplitMode = "range_copy" | "boundary_copy" | "discrete_copy";
export type ConversationSplitWorkspaceInput = {
  mode: ConversationSplitMode;
  startMessageId?: string;
  endMessageId?: string;
  boundaryMessageId?: string;
  messageIds?: string[];
  titles?: string[];
  projectId?: string;
};
export type ConversationSplitGroupPreview = { message_ids: string[]; message_count: number; suggested_title: string };
export type ConversationSplitWorkspacePreview = { mode: ConversationSplitMode; groups: ConversationSplitGroupPreview[] };
export type ConversationSplitWorkspaceResponse = { mode: ConversationSplitMode; conversations: ConversationTransformResponse[] };

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
  include_description: boolean;
  include_annotations: boolean;
  include_notebook: boolean;
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
  password_required: boolean;
};

export type ShareCreateInput = {
  title?: string | null;
  description?: string | null;
  scope?: "conversation" | "selected_messages";
  selected_message_ids?: string[];
  include_toc?: boolean;
  include_metadata?: boolean;
  include_description?: boolean;
  include_annotations?: boolean;
  include_notebook?: boolean;
  allow_export?: boolean;
  expires_at?: string | null;
  theme?: ResolvedTheme | null;
  locale?: ResolvedLocale | null;
  share_password?: string | null;
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
  share_password?: string | null;
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
    annotations?: boolean;
    notebook?: boolean;
  };
  description_markdown?: string | null;
};

export type AnnotationType = "highlight" | "underline" | "strikethrough" | "comment" | "bookmark";
export type AnnotationColor = "yellow" | "green" | "blue" | "pink";
export type AnnotationAnchorStatus = "valid" | "remapped" | "orphaned" | "needs_review";

export type AnnotationRead = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  message_version_id: string | null;
  annotation_type: AnnotationType;
  color: AnnotationColor | null;
  start_block_index: number | null;
  start_offset: number | null;
  end_block_index: number | null;
  end_offset: number | null;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  comment_markdown: string;
  anchor_status: AnnotationAnchorStatus;
  revision: number;
  is_deleted: boolean;
  conflict_of_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AnnotationCreateInput = Partial<Pick<AnnotationRead, "id" | "message_id" | "message_version_id" | "color" | "start_block_index" | "start_offset" | "end_block_index" | "end_offset" | "quote" | "prefix" | "suffix" | "anchor_status">> & {
  annotation_type: AnnotationType;
  comment_markdown?: string;
  metadata?: Record<string, unknown>;
};

export type AnnotationUpdateInput = Partial<Pick<AnnotationRead, "annotation_type" | "color" | "comment_markdown" | "anchor_status" | "message_version_id" | "start_block_index" | "start_offset" | "end_block_index" | "end_offset" | "quote" | "prefix" | "suffix">> & {
  base_revision: number;
  metadata?: Record<string, unknown>;
};

export type NotebookBlock = {
  id: string;
  type: "markdown" | "annotation_reference";
  markdown?: string | null;
  annotation_id?: string | null;
};

export type NotebookRead = {
  id: string;
  conversation_id: string;
  title: string | null;
  blocks: NotebookBlock[];
  revision: number;
  is_conflict: boolean;
  conflict_of_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AnnotationSyncOperation = {
  operation_id: string;
  entity_type: "annotation" | "notebook";
  entity_id: string;
  action: "upsert" | "delete";
  conversation_id: string;
  base_revision: number;
  payload: Record<string, unknown>;
};

export type AnnotationSyncResponse = {
  results: Array<{
    operation_id: string;
    entity_type: "annotation" | "notebook";
    entity_id: string;
    status: "applied" | "conflict" | "duplicate";
    revision: number;
    conflict_copy_id: string | null;
  }>;
};

export type OfflineCatalogConversation = {
  id: string;
  display_title: string;
  project_id: string | null;
  project_name: string | null;
  revision: number;
  estimated_bytes: number;
  updated_at: string | null;
};

export type OfflineCatalogProject = {
  id: string;
  name: string;
  conversation_ids: string[];
  revision: string;
  estimated_bytes: number;
};

export type OfflineCatalogResponse = {
  revision: string;
  generated_at: string;
  estimated_bytes: number;
  conversations: OfflineCatalogConversation[];
  projects: OfflineCatalogProject[];
};

export type OfflinePackageQueued = {
  package_id: string;
  job_id: string;
  status: string;
  scope: "conversation" | "project" | "all";
  estimated_bytes: number;
  catalog_revision: string;
};
