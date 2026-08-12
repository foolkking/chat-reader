import type { ImportAlignmentIssue, ImportPreviewResponse } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";

export function ImportPreviewCard({ preview }: { preview: ImportPreviewResponse }) {
  const conversation = preview.conversation_preview ?? preview.conversation_previews?.[0] ?? null;
  const archive = preview.archive_summary;
  const bundle = conversation?.source_profile === "chat_reader_bundle_v1" || readArchiveString(archive, "format") === "chat-reader-attachment-bundle";

  return (
    <div className="border-y border-ui py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-secondary">导入预览</p>
          <h3 className="mt-1 text-base font-semibold text-primary">
            {conversation?.title ?? readArchiveString(archive, "title") ?? "已识别源文件"}
          </h3>
        </div>
        <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-secondary">
          {preview.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <PreviewStat label="文件" value={String(preview.files.length)} />
        <PreviewStat label="消息" value={String(conversation?.message_count ?? readArchiveNumber(archive, "message_count") ?? 0)} testId="import-message-count" />
        <PreviewStat label="格式" value={bundle ? "附件对话包 v1" : archive ? `.cr v${readArchiveNumber(archive, "format_version") ?? 2}` : sourceProfileLabel(conversation?.source_profile)} />
      </dl>

      {bundle ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="bundle-preview-stats">
          <PreviewStat label="附件" value={String(readArchiveNumber(archive, "attachment_count") ?? 0)} testId="bundle-attachment-count" />
          <PreviewStat label="可用附件" value={String(readArchiveNumber(archive, "resolved_attachment_count") ?? 0)} testId="bundle-resolved-count" />
          <PreviewStat label="缺失附件" value={String(readArchiveNumber(archive, "missing_attachment_count") ?? 0)} testId="bundle-missing-count" />
          <PreviewStat label="物理对象" value={String(readArchiveNumber(archive, "object_count") ?? 0)} testId="bundle-object-count" />
          <PreviewStat label="正文位置" value={String(readArchiveNumber(archive, "occurrence_count") ?? 0)} testId="bundle-occurrence-count" />
          <PreviewStat label="尚未放入正文" value={String(readArchiveNumber(archive, "unplaced_attachment_count") ?? 0)} testId="bundle-unplaced-count" />
          <PreviewStat label="扫描状态" value="按部署策略标记" />
        </dl>
      ) : archive ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <PreviewStat label="版本" value={String(readArchiveNumber(archive, "version_count") ?? 0)} />
          <PreviewStat label="Blocks" value={String(readArchiveNumber(archive, "block_count") ?? 0)} />
          <PreviewStat label="恢复路径" value="快速恢复" />
        </dl>
      ) : conversation ? (
        <>
          {conversation.first_user_message_markdown ? (
            <div className="mt-4 max-h-80 overflow-y-auto border-l-2 border-ui pl-3 text-sm leading-6">
              <MarkdownRenderer text={conversation.first_user_message_markdown} isAssistant={false} />
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-secondary">{previewConversationText(conversation.first_user_message)}</p>
          )}
          {conversation.alignment_summary && Object.keys(conversation.alignment_summary).length > 0 ? (
            <div className="mt-4 border-l-2 border-ui pl-3 text-xs leading-5 text-secondary">
              <span className="font-medium text-primary">配对校验：</span>{formatAlignmentSummary(conversation.alignment_summary)}
            </div>
          ) : null}
          {(conversation.ignored_json_empty_count || conversation.ignored_markdown_empty_count) ? (
            <p className="mt-2 text-xs leading-5 text-secondary" data-testid="import-empty-message-summary">
              已忽略空白消息：JSON {conversation.ignored_json_empty_count ?? 0} 条，Markdown {conversation.ignored_markdown_empty_count ?? 0} 条。
            </p>
          ) : null}
          {conversation.alignment_issues?.length ? (
            <div className="mt-4 border-l-2 border-[var(--danger)] pl-3" data-testid="import-alignment-issues">
              <p className="text-sm font-medium text-[var(--danger)]">存在未匹配的非空消息，当前预览不能提交。</p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-secondary">
                {conversation.alignment_issues.map((issue) => (
                  <li key={`${issue.source}-${issue.source_index}-${issue.reason}`}>
                    {formatAlignmentIssue(issue)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-secondary">
          文件已保存，但当前无法生成可提交的对话预览。
        </p>
      )}

      {preview.warnings && preview.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-amber-700">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatAlignmentIssue(issue: ImportAlignmentIssue): string {
  const source = issue.source === "json" ? "JSON" : "Markdown";
  const role = issue.role === "user" ? "用户" : issue.role === "assistant" ? "助手" : issue.role;
  const reason = issue.reason === "content_mismatch" ? "正文不一致" : issue.reason === "ambiguous" ? "对应关系不唯一" : "未找到对应消息";
  const timestamp = issue.timestamp ? ` · ${issue.timestamp}` : "";
  return `${source} 第 ${issue.source_index + 1} 项 · ${role}${timestamp} · ${reason}`;
}

function readArchiveString(archive: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = archive?.[key];
  return typeof value === "string" ? value : null;
}

function readArchiveNumber(archive: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = archive?.[key];
  return typeof value === "number" ? value : null;
}

function PreviewStat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md bg-subtle px-3 py-2">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="mt-1 truncate font-medium text-primary" data-testid={testId}>{value}</dd>
    </div>
  );
}

function previewConversationText(text?: string | null): string {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "Conversation preview is ready to commit.";
}

function sourceProfileLabel(profile?: string): string {
  switch (profile) {
    case "chatgpt_exporter_json": return "标准化 JSON";
    case "chatgpt_exporter_combo": return "标准化 JSON + Markdown";
    case "chat_reader_canjson_v1": return "CanJSON v1 (Legacy)";
    case "chat_reader_canjson_v2": return "CanJSON v2";
    case "chat_reader_cr_v2": return ".cr v2";
    case "chat_reader_bundle_v1": return "附件对话包 v1";
    default: return profile || "已识别格式";
  }
}

function formatAlignmentSummary(summary: Record<string, number>): string {
  const labels: Record<string, string> = {
    exact: "精确",
    normalized: "规范化",
    by_order: "按顺序",
    json_only: "仅 JSON",
    markdown_only: "仅 Markdown",
    ambiguous: "歧义",
  };
  return Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${labels[status] ?? status} ${count}`)
    .join(" · ");
}
