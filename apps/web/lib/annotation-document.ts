/** Keep byte rules in sync with API annotation_document.py (shared fixture tests). */
export type AnnotationDocumentRecord = {
  message_seq?: number | null; message_role?: string | null;
  annotation_type: string; anchor_status: string; color?: string | null;
  created_at?: string | null; updated_at?: string | null;
  quoted_text?: string | null; comment_markdown?: string | null;
  id?: string; conversation_id?: string; message_id?: string | null;
  start_block_index?: number | null; start_offset?: number | null;
  prefix?: string | null; suffix?: string | null; metadata?: Record<string, unknown>;
};
export function annotationDocumentHeader(title: string, exportedAt: string, count: number,
  scope = "export_scope", source = "server_snapshot"): string {
  return "# 批注导出\n\n<!-- chat-reader-annotation-export version=1 -->\n\n"
    + `对话：${title.replace(/[\r\n]/g, " ")}\n导出时间：${exportedAt}\n范围：${scope}\n来源：${source}\n批注数：${count}\n\n`
    + "> 可读导出，不作为批注回传格式。原文摘录为批注保存时的引用，批注内容是用户观点，不是原文事实。\n\n"
    + (count ? "" : "没有未删除的已保存批注。\n");
}

const inline = (value: unknown) => String(value ?? "").replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]<>#]/g, "\\$&");

/** Shared by the card and v2 export; absent text offsets are never character 0. */
export function annotationLocationLabel(record: Pick<AnnotationDocumentRecord, "annotation_type" | "start_block_index" | "start_offset" | "metadata">, zh: boolean): string {
  const block = record.start_block_index;
  if (block == null) return zh ? "整条消息书签" : "Message bookmark";
  const prefix = `${zh ? "段落" : "Block"} ${block + 1}`;
  if (record.start_offset != null) return `${prefix} · ${zh ? "文字位置" : "Character"} ${record.start_offset}`;
  const anchor = record.metadata?.reading_anchor as Record<string, unknown> | undefined;
  const offset = anchor?.block_offset;
  const point = zh ? "段落内阅读位置" : "Reading point within block";
  const position = typeof offset === "number" && Number.isFinite(offset) && offset >= 0 && offset <= 1_000_000_000
    ? (zh ? `距段落顶部 ${Math.floor(offset + .5)} CSS px` : `${Math.floor(offset + .5)} CSS px from block top`) : (zh ? "块内位置未记录" : "Block offset unavailable");
  const label = typeof record.metadata?.reading_label === "string" ? Array.from(record.metadata.reading_label.replace(/[\r\n]/g, " ")).slice(0, 160).join("") : "";
  return `${prefix} · ${point} · ${position}${label ? ` · ${label}` : ""}`;
}

/** v2 standalone projection, byte-compatible with readable_* in the API. */
export function readableAnnotationHeader(title: string, exportedAt: string, count: number, scope = "all", source = "server", zh = true): string {
  const scopeLabel = zh ? ({ all: "全部已保存", filtered: "当前筛选", selected: "已勾选" }[scope] ?? scope) : scope;
  const sourceLabel = zh ? (source === "server" ? "服务器已保存快照" : "本机已保存快照（可能含待同步内容）") : source;
  return [`# ${zh ? "批注与书签" : "Annotations and bookmarks"}`, "", "<!-- chat-reader-annotation-export version=2 -->", "",
    `${zh ? "对话" : "Conversation"}: ${inline(title)}`, `${zh ? "导出时间 (UTC)" : "Exported (UTC)"}: ${exportedAt}`,
    `${zh ? "范围" : "Scope"}: ${scopeLabel} · ${count}`, `${zh ? "来源" : "Source"}: ${sourceLabel}`, "",
    "> " + (zh ? "摘录及上下文来自保存时的原文；不含未保存草稿。链接需要原账户登录。本文件不是批注回传格式。"
      : "Quotes and context are from the saved source; unsaved drafts are excluded. Links require the owning account. This is not an import format."), "", ""].join("\n");
}

export function readableAnnotationEntry(record: AnnotationDocumentRecord, ordinal: number, zh = true, sourceBase?: string): string {
  let role = record.message_role || "unknown", kind = record.annotation_type;
  if (zh) {
    role = ({ user: "用户", assistant: "助手", system: "系统", unknown: "未知角色" } as Record<string, string>)[role] ?? role;
    kind = ({ bookmark: "书签", highlight: "高亮", underline: "下划线", strikethrough: "删除线", comment: "评论" } as Record<string, string>)[kind] ?? kind;
  }
  const lines = [`## ${ordinal}. ${inline(kind)} · ${inline(role)} ${record.message_seq || ""}`, ""];
  if (record.metadata?.section_title) lines.push(`${zh ? "章节" : "Section"}: ${inline(record.metadata.section_title)}`, "");
  if (record.start_block_index != null || record.annotation_type === "bookmark") lines.push(inline(annotationLocationLabel(record, zh)), "");
  if (!["valid", "remapped"].includes(record.anchor_status)) lines.push("> " + (zh ? "原文需要检查，不能保证精确定位。" : "Source needs review; exact location is not guaranteed."), "");
  if (sourceBase && record.message_id && record.conversation_id && record.id) lines.push(
    `[${zh ? "返回原文（需登录）" : "Open source (sign-in required)"}](<${sourceBase.replace(/\/$/, "")}/conversations/${record.conversation_id}?annotationId=${record.id}>)`, "");
  const quote = record.quoted_text || "";
  for (const [label, value] of [[zh ? "原文摘录" : "Saved quote", quote], [zh ? "保存时的上下文" : "Context when saved",
    record.prefix || record.suffix ? (record.prefix || "") + quote + (record.suffix || "") : ""]]) {
    if (!value) continue;
    let length = 3;
    for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
    const fence = "`".repeat(length);
    lines.push(`### ${label}`, "", fence + "text", value, fence, "");
  }
  lines.push("### " + (zh ? "批注内容" : "Comment"), "", record.comment_markdown || (zh ? "（无文字批注）" : "(No comment)"), "",
    `${zh ? "创建 / 更新 (UTC)" : "Created / updated (UTC)"}: ${record.created_at || ""} / ${record.updated_at || ""}`, "", "");
  return lines.join("\n");
}
export function annotationDocumentEntry(record: AnnotationDocumentRecord, ordinal: number): string {
  const position = record.message_seq != null ? `消息 ${record.message_seq} · ${record.message_role || "unknown"}` : "无法定位到当前原文";
  const lines = [`## ${position}`, "", `### 批注 ${ordinal} · ${record.annotation_type}`, "",
    `- 状态：${record.anchor_status}`, `- 颜色：${record.color || "none"}`,
    `- 创建时间：${record.created_at || ""}`, `- 更新时间：${record.updated_at || ""}`, ""];
  if (record.quoted_text) {
    let length = 3;
    for (const match of record.quoted_text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
    const fence = "`".repeat(length);
    lines.push("#### 原文摘录", "", fence + "text", record.quoted_text, fence, "");
  } else if (record.annotation_type !== "bookmark") lines.push("#### 原文摘录", "", "未保存原文摘录。", "");
  lines.push("#### 批注内容", "", record.comment_markdown || "（无文字批注）", "", "");
  return lines.join("\n");
}
