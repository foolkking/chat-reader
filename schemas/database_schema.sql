-- Database Schema Draft for Chat Archive Reader

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  display_title TEXT NOT NULL,
  primary_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_profile TEXT NOT NULL,
  external_source_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  first_user_message TEXT,
  summary TEXT,
  parser_version TEXT NOT NULL,
  render_version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT UNIQUE,
  sort_time TIMESTAMPTZ,
  is_global_pinned BOOLEAN NOT NULL DEFAULT false,
  global_pinned_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE project_conversations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  pinned_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by TEXT NOT NULL DEFAULT 'system',
  UNIQUE(project_id, conversation_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  author_label TEXT,
  order_key TEXT NOT NULL,
  turn_index INTEGER,
  created_at TIMESTAMPTZ,
  created_in_system_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_version_id UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'import',
  source_type TEXT NOT NULL DEFAULT 'import',
  content_hash TEXT,
  estimated_height INTEGER,
  measured_height INTEGER,
  block_count INTEGER DEFAULT 0,
  char_count INTEGER DEFAULT 0,
  is_heavy BOOLEAN DEFAULT false,
  UNIQUE(conversation_id, order_key)
);

CREATE TABLE message_versions (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  plain_text TEXT NOT NULL,
  display_text TEXT NOT NULL,
  blocks JSONB NOT NULL,
  edit_type TEXT NOT NULL,
  edit_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'user',
  based_on_version_id UUID,
  content_hash TEXT NOT NULL,
  UNIQUE(message_id, version_number)
);

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_current_version
  FOREIGN KEY (current_version_id) REFERENCES message_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE render_blocks (
  id UUID PRIMARY KEY,
  message_version_id UUID NOT NULL REFERENCES message_versions(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  plain_text TEXT,
  data JSONB NOT NULL,
  sanitized_html TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  estimated_height INTEGER,
  measured_height INTEGER,
  collapsed_by_default BOOLEAN NOT NULL DEFAULT false,
  render_priority INTEGER NOT NULL DEFAULT 0,
  UNIQUE(message_version_id, block_index)
);

CREATE TABLE headings (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  message_version_id UUID NOT NULL REFERENCES message_versions(id) ON DELETE CASCADE,
  render_block_id UUID REFERENCES render_blocks(id) ON DELETE SET NULL,
  block_index INTEGER NOT NULL,
  heading_index INTEGER NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  slug TEXT NOT NULL,
  order_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(conversation_id, heading_index)
);

CREATE TABLE search_documents (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  message_version_id UUID REFERENCES message_versions(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  role TEXT,
  title TEXT,
  plain_text TEXT NOT NULL,
  search_text TEXT NOT NULL,
  source_type TEXT,
  source_profile TEXT,
  order_key TEXT,
  turn_index INTEGER,
  created_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}',
  search_tsv tsvector
);

CREATE TABLE imports (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  json_filename TEXT,
  md_filename TEXT,
  csv_filename TEXT,
  source_profile TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  json_message_count INTEGER,
  md_message_count INTEGER,
  csv_row_count INTEGER,
  cleaned_thinking_summary_count INTEGER NOT NULL DEFAULT 0,
  alignment_status TEXT NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_artifacts (
  id UUID PRIMARY KEY,
  import_id UUID REFERENCES imports(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  raw_storage_uri TEXT,
  parsed_summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_message_refs (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_conversation_id TEXT,
  source_node_id TEXT,
  source_message_id TEXT,
  parent_node_id TEXT,
  child_node_ids JSONB NOT NULL DEFAULT '[]',
  is_primary_path BOOLEAN NOT NULL DEFAULT true,
  branch_index INTEGER,
  raw_metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE conversation_events (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  target_message_id UUID,
  target_version_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE reading_positions (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  block_index INTEGER,
  scroll_offset INTEGER NOT NULL DEFAULT 0,
  anchor_data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

CREATE TABLE recent_items (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  open_count INTEGER NOT NULL DEFAULT 1,
  context JSONB NOT NULL DEFAULT '{}',
  UNIQUE(conversation_id)
);

CREATE TABLE shares (
  id UUID PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  scope JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_sort_time ON conversations(sort_time DESC);
CREATE INDEX idx_messages_conversation_order ON messages(conversation_id, order_key);
CREATE INDEX idx_render_blocks_version_index ON render_blocks(message_version_id, block_index);
CREATE INDEX idx_headings_conversation_order ON headings(conversation_id, order_key);
CREATE INDEX idx_search_documents_vector ON search_documents USING GIN(search_tsv);
CREATE INDEX idx_project_conversations_project ON project_conversations(project_id, is_pinned, sort_order);
CREATE INDEX idx_source_message_refs_source_node ON source_message_refs(source_conversation_id, source_node_id);
CREATE INDEX idx_reading_positions_conversation ON reading_positions(conversation_id);
CREATE INDEX idx_recent_items_last_opened ON recent_items(last_opened_at DESC);
