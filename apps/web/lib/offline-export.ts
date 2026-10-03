import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { getOfflineAttachmentBytes, offlineDb, type OfflineAttachmentRecord, type OfflineConversationRecord, type OfflineMessageRecord } from "./offline-db";
import { strToU8, zipSync } from "fflate";
import type { AnnotationRead, MessageListItem, NotebookRead } from "./types";
import { readOfflineContinuation } from "./offline-continuation";

export type OfflineExportFormat = "context" | "canjson" | "markdown";

export type OfflineExportOptions = {
  format: OfflineExportFormat;
  includeAttachments: boolean;
  includeDescription: boolean;
  includeAnnotations: boolean;
  includeNotebook: boolean;
  includeContinuation?: boolean;
};

export type OfflineExportResult = {
  blob: Blob;
  filename: string;
  contextPackage: boolean;
  missingAttachmentCount: number;
  unavailableAnnotationAnchorCount: number;
};

const MAX_LOCAL_BUNDLE_BYTES = 256 * 1024 * 1024;

export async function exportOfflineConversation(conversationId: string, options: OfflineExportOptions): Promise<OfflineExportResult> {
  const access = captureOfflineAccess();
  const db = offlineDb;
  const snapshot = await db.transaction("r", [db.conversations, db.messages, db.annotations, db.notebooks, db.attachments], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation) throw new Error("Offline conversation was not found.");
    const [messages, annotations, notebook, attachments] = await Promise.all([
    db.messages.where("conversation_id").equals(conversationId).sortBy("order_key"),
    options.includeAnnotations ? db.annotations.where("conversation_id").equals(conversationId).toArray() : Promise.resolve([]),
    options.includeNotebook ? db.notebooks.where("conversation_id").equals(conversationId).first() : Promise.resolve(undefined),
    db.attachments.where("conversation_id").equals(conversationId).toArray(),
    ]);
    return { conversation, messages, annotations, notebook, attachments };
  });
  const { conversation, messages, annotations, notebook, attachments } = snapshot;
  const unavailableAnnotationAnchorCount = options.format !== "markdown" ? unavailableAnnotationAnchors(messages, annotations).size : 0;
  const exportedAt = new Date().toISOString();
  const source = options.format !== "markdown"
    ? buildCanJson(conversation, messages, annotations, notebook, attachments, options, exportedAt)
    : buildMarkdown(conversation, messages, annotations, notebook, options, exportedAt);
  const safeTitle = safeFilename(conversation.display_title || conversation.title);
  if (!options.includeAttachments && options.format !== "context") {
    assertOfflineAccess(access);
    return {
      blob: new Blob([source], { type: options.format === "canjson" ? "application/x-ndjson;charset=utf-8" : "text/markdown;charset=utf-8" }),
      filename: `${safeTitle}${options.format === "canjson" ? ".canonical.jsonl" : ".md"}`,
      contextPackage: false,
      missingAttachmentCount: 0,
      unavailableAnnotationAnchorCount,
    };
  }

  const files: Record<string, Uint8Array> = {};
  const objectPaths = new Map<string, string>();
  const fileChecksums: Record<string, { sha256: string; byte_size: number }> = {};
  let totalBytes = 0;
  let missingAttachmentCount = 0;
  for (const attachment of options.includeAttachments ? attachments : []) {
    const bytes = await getOfflineAttachmentBytes(attachment.id);
    if (!bytes || bytes.byteLength !== attachment.byte_size || await sha256(bytes) !== attachment.sha256) {
      missingAttachmentCount += 1;
      continue;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_LOCAL_BUNDLE_BYTES) {
      throw new Error("Offline export exceeds the 256 MiB browser safety limit. Export this conversation while online instead.");
    }
    const path = options.format !== "markdown"
      ? `assets/objects/${attachment.sha256.slice(0, 2)}/${attachment.sha256}`
      : `attachments/${attachment.id.slice(0, 8)}-${safeFilename(attachment.display_name)}`;
    objectPaths.set(attachment.id, path);
    if (!files[path]) files[path] = bytes;
    fileChecksums[path] = { sha256: attachment.sha256, byte_size: bytes.byteLength };
  }

  if (options.format !== "markdown") {
    const rewritten = rewriteCanJsonAttachments(source, objectPaths, options.includeAttachments);
    const conversationBytes = strToU8(rewritten);
    files["conversation.canjsonl"] = conversationBytes;
    fileChecksums["conversation.canjsonl"] = { sha256: await sha256(conversationBytes), byte_size: conversationBytes.byteLength };
    let continuation: Record<string, unknown> | undefined;
    let continuationStatus = "none";
    if (options.includeContinuation !== false && conversation.continuation) {
      try {
        const saved = await readOfflineContinuation(conversation.continuation);
        continuation = { ...saved?.metadata };
        for (const name of ["current", "index"] as const) {
          const member = saved?.members[name];
          if (!member) continue;
          const path = `continuation/${name === "current" ? "current.md" : "index.json"}`;
          files[path] = strToU8(member.text);
          fileChecksums[path] = { sha256: member.sha256, byte_size: member.byte_size };
          continuation[name] = path;
        }
        continuationStatus = Object.keys(continuation).length ? "included_without_validation" : "none";
      } catch {
        continuation = undefined;
        continuationStatus = "unavailable";
      }
    } else if (options.includeContinuation === false) continuationStatus = "omitted_by_request";
    const physicalObjects = new Set(attachments.map((attachment) => attachment.sha256)).size;
    const referenceCount = attachments.reduce((count, attachment) => count + (attachment.occurrences?.length ?? 0), 0);
    const completeness = !attachments.length ? "none" : !options.includeAttachments || missingAttachmentCount > 0 ? "partial" : "complete";
    files["manifest.json"] = strToU8(`${JSON.stringify({
      format: "chat-reader-context-package",
      format_version: "1.0",
      entrypoint: "conversation.canjsonl",
      conversation: {
        id: conversation.id,
        title: conversation.display_title,
        message_count: messages.length,
        conversation_revision: conversation.offline_revision,
        current_versions_only: true,
      },
      conversation_completeness: "complete",
      asset_completeness: completeness,
      attachments: {
        requested: options.includeAttachments,
        policy: options.includeAttachments ? "include" : "metadata_only",
        omitted_object_count: options.includeAttachments ? 0 : physicalObjects,
        metadata_included: true,
        binary_objects_included: objectPaths.size > 0,
        record_count: attachments.length,
        reference_count: referenceCount,
        resolved_attachment_count: objectPaths.size,
        physical_object_count: physicalObjects,
        available_object_count: new Set(objectPaths.values()).size,
        missing_object_count: missingAttachmentCount,
        excluded_object_count: 0,
        completeness,
        total_available_bytes: totalBytes,
      },
      included_content: {
        conversation_description: options.includeDescription,
        annotations: options.includeAnnotations,
        notebook: options.includeNotebook,
        source_refs: messages.some((message) => (message.source_refs?.length ?? 0) > 0),
        project_context: options.includeDescription && Boolean(conversation.project_context),
      },
      files: fileChecksums,
      ...(continuation ? { continuation } : {}),
      extensions: { chat_reader_continuation_export: { version: 1, status: continuationStatus } },
    }, null, 2)}\n`);
  } else {
    files["conversation.md"] = strToU8(rewriteMarkdownAttachments(source, attachments, objectPaths));
  }
  assertOfflineAccess(access);
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.byteLength, 0) > MAX_LOCAL_BUNDLE_BYTES) {
    throw new Error("Offline export exceeds the 256 MiB browser safety limit. Export this conversation while online instead.");
  }
  return {
    blob: new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }),
    filename: `${safeTitle}${options.format !== "markdown" ? ".context.zip" : "-markdown.zip"}`,
    contextPackage: options.format !== "markdown",
    missingAttachmentCount,
    unavailableAnnotationAnchorCount,
  };
}

function unavailableAnnotationAnchors(messages: OfflineMessageRecord[], annotations: AnnotationRead[]): Set<string> {
  const versions = new Map(messages.map(message => [message.id, new Set([
    message.current_version?.id, ...(message.annotation_versions ?? []).map(version => version.id),
  ])]));
  return new Set(annotations.filter(annotation => !annotation.is_deleted && annotation.message_id
    && versions.has(annotation.message_id) && annotation.message_version_id
    && !versions.get(annotation.message_id)!.has(annotation.message_version_id)).map(annotation => annotation.id));
}

function buildCanJson(
  conversation: OfflineConversationRecord,
  messages: OfflineMessageRecord[],
  annotations: AnnotationRead[],
  notebook: NotebookRead | undefined,
  attachments: OfflineAttachmentRecord[],
  options: OfflineExportOptions,
  exportedAt: string,
): string {
  const exportedMessages = new Map(messages.map(message => [message.id, message]));
  const includedAnnotations = options.includeAnnotations ? annotations.filter(annotation =>
    !annotation.is_deleted && annotation.message_id && exportedMessages.has(annotation.message_id)) : [];
  const anchorIds = new Set(includedAnnotations.map(annotation => annotation.message_version_id));
  const annotationVersions = messages.flatMap(message => (message.annotation_versions ?? [])
    .filter(version => anchorIds.has(version.id) && version.id !== message.current_version?.id)
    .map(version => ({ message, version })));
  const unavailableAnchors = unavailableAnnotationAnchors(messages, includedAnnotations);
  const records: Record<string, unknown>[] = [{
    record_type: "manifest",
    format: "chat-reader-canonical-jsonl",
    version: 2,
    exported_at: exportedAt,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      display_title: conversation.display_title,
      ...(options.includeDescription ? { description_markdown: conversation.description_markdown } : {}),
      source_type: conversation.source_type,
      source_profile: conversation.source_profile,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    },
    selection: { scope: "all_current_messages", message_count: messages.length },
    content: { format: "markdown", versions: annotationVersions.length ? "current_plus_annotation_anchors" : "current_only",
      attachments: options.includeAttachments ? "metadata_and_objects" : "metadata_only" },
    extensions: { chat_reader_offline_snapshot: {
      version: 1,
      project_context: !options.includeDescription ? "omitted_by_request" : conversation.project_context === undefined ? "unavailable" : conversation.project_context ? "included" : "none",
      unavailable_annotation_anchor_count: unavailableAnchors.size,
    } },
  }];
  if (options.includeDescription && conversation.project_context) records.push(conversation.project_context);
  messages.forEach((message, index) => {
    const version = message.current_version;
    records.push({
      record_type: "message",
      id: message.id,
      seq: index + 1,
      order_key: message.order_key,
      role: message.role,
      author_label: message.author_label ?? null,
      turn_index: message.turn_index ?? null,
      created_at: message.created_at ?? null,
      current_version: {
        id: version?.id ?? `${message.id}-offline-current`,
        number: version?.version_number ?? 1,
        content_markdown: version?.display_text ?? version?.plain_text ?? message.content_preview ?? "",
        content_hash: version?.content_hash ?? null,
        edit_type: version?.edit_type ?? "offline_snapshot",
        edit_reason: null,
        created_at: version?.created_at ?? message.created_at ?? null,
        based_on_version_id: null,
        normalizer_version: "offline-package-v3",
        markdown_parser_version: "offline-package-v3",
        block_builder_version: "offline-package-v3",
        search_document_version: "offline-package-v3",
      },
    });
    for (const ref of message.source_refs ?? []) {
      records.push({ ...ref, record_type: "source_ref", message_id: message.id });
    }
  });
  for (const { message, version } of annotationVersions) {
    records.push({ record_type: "message_version", message_id: message.id, id: version.id,
      number: version.version_number, content_markdown: version.display_text ?? version.plain_text,
      content_hash: version.content_hash, edit_type: version.edit_type, created_at: version.created_at,
      based_on_version_id: null });
  }
  if (options.includeAnnotations) {
    includedAnnotations.forEach((annotation) => {
      const anchorAvailable = !unavailableAnchors.has(annotation.id);
      records.push({
      record_type: "annotation",
      id: annotation.id,
      message_id: annotation.message_id,
      version_id: anchorAvailable ? annotation.message_version_id : null,
      // Legacy packages lack anchor bodies. Keep the annotation and original
      // locator explicitly, without inventing a link to the current version.
      ...(!anchorAvailable ? { unavailable_anchor_version_id: annotation.message_version_id } : {}),
      start_block_index: annotation.start_block_index,
      start_offset: annotation.start_offset,
      end_block_index: annotation.end_block_index,
      end_offset: annotation.end_offset,
      quoted_text: annotation.quote,
      annotation_type: annotation.annotation_type,
      color: annotation.color,
      comment_markdown: annotation.comment_markdown,
      anchor_status: anchorAvailable ? annotation.anchor_status : "orphaned",
    }); });
  }
  if (options.includeNotebook && notebook) {
    const annotationIds = new Set(includedAnnotations.map(annotation => annotation.id));
    const blocks = notebook.blocks.filter(block => block.type === "markdown"
      || (block.type === "annotation_reference" && block.annotation_id && annotationIds.has(block.annotation_id)));
    records.push({
      record_type: "notebook",
      id: notebook.id,
      title: notebook.title,
      content_markdown: blocks.filter((block) => block.type === "markdown").map((block) => block.markdown ?? "").join("\n\n"),
      blocks,
    });
  }
  const versionIds = new Set(messages.map((message) => message.current_version?.id).filter(Boolean));
  attachments.forEach((attachment) => records.push({
    record_type: "attachment",
    id: attachment.id,
    conversation_id: attachment.conversation_id,
    original_filename: attachment.original_filename,
    display_name: attachment.display_name,
    declared_mime_type: attachment.declared_mime_type,
    detected_mime_type: attachment.detected_mime_type,
    status: attachment.status ?? "available",
    scan_status: attachment.scan_status ?? "unscanned",
    source_type: attachment.source_type ?? "offline_package",
    source_attachment_id: attachment.source_attachment_id ?? null,
    source: { source_type: attachment.source_type ?? "offline_package", source_attachment_id: attachment.source_attachment_id ?? null },
    metadata: {},
    resolution_status: "not_included",
    asset_object: { sha256: attachment.sha256, byte_size: attachment.byte_size, detected_mime_type: attachment.detected_mime_type, detected_extension: null },
  }));
  attachments.forEach((attachment) => (attachment.occurrences ?? []).forEach((occurrence) => {
    if (!versionIds.has(occurrence.message_version_id)) return;
    records.push({ record_type: "attachment_ref", attachment_id: attachment.id, ...occurrence });
  }));
  records.push({ record_type: "end", record_count: records.length + 1, message_count: messages.length });
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function buildMarkdown(
  conversation: OfflineConversationRecord,
  messages: MessageListItem[],
  annotations: AnnotationRead[],
  notebook: NotebookRead | undefined,
  options: OfflineExportOptions,
  exportedAt: string,
): string {
  const lines = [
    "---",
    `format: ${JSON.stringify("chat-reader-markdown-export")}`,
    "version: 2",
    `conversation_id: ${JSON.stringify(conversation.id)}`,
    `title: ${JSON.stringify(conversation.display_title)}`,
    `message_count: ${messages.length}`,
    `source_profile: ${JSON.stringify(conversation.source_profile)}`,
    `exported_at: ${JSON.stringify(exportedAt)}`,
    "content_scope: current_versions",
    "---",
    "",
    `# ${conversation.display_title}`,
    "",
  ];
  if (options.includeDescription && conversation.description_markdown) lines.push("## Description", "", conversation.description_markdown.trim(), "");
  messages.forEach((message) => {
    const content = message.current_version?.display_text ?? message.current_version?.plain_text ?? message.content_preview ?? "";
    lines.push("<!-- chat-reader-message", `id: ${JSON.stringify(message.id)}`, `role: ${JSON.stringify(message.role)}`, `order_key: ${JSON.stringify(message.order_key)}`, `created_at: ${JSON.stringify(message.created_at ?? null)}`, "-->", "", `## ${titleCase(message.role)} · ${message.order_key}`, "", content, "", "<!-- /chat-reader-message -->", "");
  });
  if (options.includeAnnotations && annotations.length) {
    lines.push("## Annotations", "");
    annotations.filter((annotation) => !annotation.is_deleted).forEach((annotation) => {
      lines.push(`### ${titleCase(annotation.annotation_type.replaceAll("_", " "))} · ${annotation.id}`, "");
      if (annotation.quote) lines.push(...annotation.quote.split("\n").map((line) => `> ${line}`), "");
      if (annotation.comment_markdown) lines.push(annotation.comment_markdown, "");
    });
  }
  if (options.includeNotebook && notebook) {
    lines.push("## Curated Notes", "");
    if (notebook.title) lines.push(`### ${notebook.title}`, "");
    notebook.blocks.filter((block) => block.type === "markdown" && block.markdown).forEach((block) => lines.push(block.markdown!, ""));
  }
  return `${lines.join("\n").trim()}\n`;
}

function rewriteCanJsonAttachments(source: string, paths: Map<string, string>, requested: boolean): string {
  return source.split("\n").filter(Boolean).map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.record_type !== "attachment") return line;
    const path = paths.get(String(record.id));
    const asset = record.asset_object as Record<string, unknown> | null;
    record.resolution_status = path ? "available" : requested ? "missing" : "not_included";
    const digest = typeof asset?.sha256 === "string" && /^[a-f0-9]{64}$/.test(asset.sha256) ? asset.sha256 : null;
    record.object = digest ? { path: path ?? `assets/objects/${digest.slice(0, 2)}/${digest}`, sha256: digest, byte_size: asset?.byte_size } : null;
    return JSON.stringify(record);
  }).join("\n") + "\n";
}

function rewriteMarkdownAttachments(source: string, attachments: OfflineAttachmentRecord[], paths: Map<string, string>): string {
  const names = new Map(attachments.map((attachment) => [attachment.id, attachment.display_name]));
  return source.replace(/(!?)\[([^\]]*)\]\(cr-asset:\/\/([0-9a-fA-F-]{36})(?:\s+[^)]*)?\)/g, (_match, image: string, label: string, id: string) => {
    const path = paths.get(id);
    if (!path) return `${image ? "Image" : "Attachment"}: ${names.get(id) ?? label ?? "unknown attachment"} (file not included in this export)`;
    return `${image}[${label || names.get(id) || "attachment"}](${path})`;
  });
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[\\/:*?"<>|\0]/g, "-").replace(/\s+/g, " ").trim().replace(/^[ .-]+|[ .-]+$/g, "").slice(0, 120);
  return normalized || "conversation";
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

async function sha256(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
