import type { ImportPreviewResponse } from "../../lib/types";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";

export function ImportPreviewCard({ preview }: { preview: ImportPreviewResponse }) {
  const conversation = preview.conversation_preview ?? preview.conversation_previews?.[0] ?? null;
  const archive = preview.archive_summary;

  return (
    <div className="border-y border-slate-200 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">导入预览</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            {conversation?.title ?? readArchiveString(archive, "title") ?? "已识别源文件"}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {preview.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <PreviewStat label="文件" value={String(preview.files.length)} />
        <PreviewStat label="消息" value={String(conversation?.message_count ?? readArchiveNumber(archive, "message_count") ?? 0)} />
        <PreviewStat label="格式" value={archive ? `.cr v${readArchiveNumber(archive, "format_version") ?? 1}` : conversation?.source_profile ?? "ChatGPT export"} />
      </dl>

      {archive ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <PreviewStat label="版本" value={String(readArchiveNumber(archive, "version_count") ?? 0)} />
          <PreviewStat label="Blocks" value={String(readArchiveNumber(archive, "block_count") ?? 0)} />
          <PreviewStat label="恢复路径" value="快速恢复" />
        </dl>
      ) : conversation ? (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {previewConversationText(conversation.first_user_message)}
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-600">
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

function readArchiveString(archive: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = archive?.[key];
  return typeof value === "string" ? value : null;
}

function readArchiveNumber(archive: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = archive?.[key];
  return typeof value === "number" ? value : null;
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "Conversation preview is ready to commit.";
}
