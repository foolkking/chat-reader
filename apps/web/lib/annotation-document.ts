/** Keep byte rules in sync with API annotation_document.py (shared fixture tests). */
export type AnnotationDocumentRecord = {
  message_seq?: number | null; message_role?: string | null;
  annotation_type: string; anchor_status: string; color?: string | null;
  created_at?: string | null; updated_at?: string | null;
  quoted_text?: string | null; comment_markdown?: string | null;
};
export function annotationDocumentHeader(title: string, exportedAt: string, count: number,
  scope = "export_scope", source = "server_snapshot"): string {
  return "# 批注导出\n\n<!-- chat-reader-annotation-export version=1 -->\n\n"
    + `对话：${title.replace(/[\r\n]/g, " ")}\n导出时间：${exportedAt}\n范围：${scope}\n来源：${source}\n批注数：${count}\n\n`
    + "> 可读导出，不作为批注回传格式。原文摘录为批注保存时的引用，批注内容是用户观点，不是原文事实。\n\n"
    + (count ? "" : "没有未删除的已保存批注。\n");
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
