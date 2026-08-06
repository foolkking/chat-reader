"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FileArchive, FileJson2, FileText } from "lucide-react";
import { useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import {
  getConversationAttachments,
  getConversationExportUrl,
  getTask,
  queueConversationAttachmentBundleExport,
} from "../../lib/api";

type ConversationExportFormat = "canjson" | "markdown";

export function ExportPanel({
  conversationId,
  compact = false,
}: {
  conversationId: string;
  selectedMessageIds: string[];
  compact?: boolean;
  readingStartMessageId?: string | null;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [format, setFormat] = useState<ConversationExportFormat>("canjson");
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [includeNotebook, setIncludeNotebook] = useState(false);
  const [includeSourceRefs, setIncludeSourceRefs] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobKey, setJobKey] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const attachmentsQuery = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
    staleTime: 30_000,
  });
  const taskQuery = useQuery({
    queryKey: ["task", jobId],
    queryFn: () => getTask(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "committed" || status === "failed" || status === "cancelled" ? false : 1500;
    },
  });

  const attachments = attachmentsQuery.data ?? [];
  const unavailableCount = attachments.filter((item) => item.resolution_status !== "resolved" || !item.asset_object).length;
  const exportOptions = { includeDescription, includeAnnotations, includeNotebook, includeSourceRefs };
  const currentKey = JSON.stringify({ format, includeAttachments, ...exportOptions });
  const downloadUrl = jobKey === currentKey ? taskQuery.data?.result.download_url : null;
  const plainHref = getConversationExportUrl(conversationId, {
    format: format === "canjson" ? "canjson_v2" : "markdown_v2",
    includeMetadata: true,
    includeDescription,
    includeAnnotations,
    includeNotebook,
    includeSourceRefs,
  });
  const output = format === "canjson"
    ? includeAttachments ? ".context.zip" : ".canjsonl"
    : includeAttachments ? "-markdown.zip" : ".md";

  const resetQueuedResult = () => setQueueError(null);

  return (
    <section className="min-w-0 space-y-5">
      <div className="grid grid-cols-2 rounded-lg bg-subtle p-1" role="group" aria-label={zh ? "导出格式" : "Export format"}>
        <FormatButton active={format === "canjson"} onClick={() => { setFormat("canjson"); resetQueuedResult(); }} icon={<FileJson2 className="h-4 w-4" />} label="CanJSON" />
        <FormatButton active={format === "markdown"} onClick={() => { setFormat("markdown"); resetQueuedResult(); }} icon={<FileText className="h-4 w-4" />} label="Markdown" />
      </div>

      <OptionRow
        checked={includeAttachments}
        onChange={(checked) => { setIncludeAttachments(checked); resetQueuedResult(); }}
        label={zh ? "包含附件" : "Include attachments"}
        description={attachmentsQuery.isLoading
          ? (zh ? "正在检查当前对话文件" : "Checking conversation files")
          : zh
            ? `${attachments.length} 个文件，${unavailableCount} 个缺失或不可用`
            : `${attachments.length} files, ${unavailableCount} missing or unavailable`}
      />

      <details className="group rounded-lg border border-ui bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-primary">
          <span>{zh ? "更多内容选项" : "More content options"}</span>
          <ChevronDown className="h-4 w-4 text-secondary transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-1 border-t border-ui p-2">
          <CompactOption checked={includeDescription} onChange={setIncludeDescription} label={zh ? "包含对话简介" : "Include conversation description"} />
          <CompactOption checked={includeAnnotations} onChange={setIncludeAnnotations} label={zh ? "包含批注" : "Include annotations"} />
          <CompactOption checked={includeNotebook} onChange={setIncludeNotebook} label={zh ? "包含笔记" : "Include notebook"} />
          {format === "canjson" ? <CompactOption checked={includeSourceRefs} onChange={setIncludeSourceRefs} label={zh ? "包含来源引用" : "Include source references"} /> : null}
        </div>
      </details>

      <div className="rounded-lg bg-subtle px-3 py-3 text-sm leading-6 text-secondary">
        <div className="mb-1 flex items-center gap-2 font-medium text-primary">
          {includeAttachments ? <FileArchive className="h-4 w-4" /> : format === "canjson" ? <FileJson2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          <span>{zh ? `输出 ${output}` : `Output ${output}`}</span>
        </div>
        <p>
          {format === "canjson"
            ? includeAttachments
              ? (zh ? "AI 承接包包含完整当前对话、所选附加内容、附件元数据和可用文件；缺失文件会保留记录。" : "The AI context package contains the complete current conversation, selected secondary content, attachment metadata, and available files. Missing files remain recorded.")
              : (zh ? "结构化对话文件保留附件元数据和引用，但不包含文件二进制。" : "The structured conversation keeps attachment metadata and references without file binaries.")
            : includeAttachments
              ? (zh ? "解压后可直接在 Obsidian、Typora 或 VS Code 中打开，附件使用相对路径。" : "The extracted folder opens directly in Obsidian, Typora, or VS Code with relative attachment paths.")
              : (zh ? "单个 Markdown 文件；附件位置会显示为可读的未包含提示。" : "A single Markdown file with readable placeholders where files were omitted.")}
        </p>
      </div>

      {includeAttachments ? (
        downloadUrl && taskQuery.data?.status === "committed" ? (
          <a href={String(downloadUrl)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85">
            <Download className="h-4 w-4" />{zh ? "下载导出包" : "Download export"}
          </a>
        ) : (
          <button
            type="button"
            disabled={jobKey === currentKey && Boolean(jobId) && !["failed", "cancelled"].includes(taskQuery.data?.status ?? "queued")}
            onClick={() => void (async () => {
              setQueueError(null);
              try {
                const task = await queueConversationAttachmentBundleExport(
                  conversationId,
                  format === "canjson" ? "canjson_bundle" : "markdown_bundle",
                  exportOptions,
                );
                setJobId(task.job_id);
                setJobKey(currentKey);
              } catch (error) {
                setQueueError(error instanceof Error ? error.message : (zh ? "无法创建导出任务" : "Unable to create export"));
              }
            })()}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85 disabled:cursor-wait disabled:opacity-60"
          >
            <FileArchive className="h-4 w-4" />
            {jobKey === currentKey && jobId && taskQuery.data?.status !== "failed"
              ? (zh ? `正在生成 ${taskQuery.data?.progress ?? 0}%` : `Generating ${taskQuery.data?.progress ?? 0}%`)
              : (zh ? "生成导出包" : "Generate export")}
          </button>
        )
      ) : (
        <a href={plainHref} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85">
          <Download className="h-4 w-4" />{zh ? "下载文件" : "Download file"}
        </a>
      )}

      {queueError ? <p className="text-sm text-[var(--danger)]">{queueError}</p> : null}
      {jobKey === currentKey && taskQuery.data?.status === "failed" ? <p className="text-sm text-[var(--danger)]">{taskQuery.data.error_message || (zh ? "导出失败，请重试。" : "Export failed. Try again.")}</p> : null}
      {!compact && unavailableCount > 0 ? <p className="text-xs leading-5 text-secondary">{zh ? "缺失文件仍保留在元数据中，附件完整性会标记为 partial。" : "Missing files remain in metadata and make asset completeness partial."}</p> : null}
    </section>
  );
}

function OptionRow({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-ui px-3 text-sm text-primary">
      <span className="min-w-0"><span className="block font-medium">{label}</span><span className="block text-xs leading-5 text-secondary">{description}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
    </label>
  );
}

function CompactOption({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm text-primary hover:bg-subtle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </label>
  );
}

function FormatButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm ${active ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary"}`}>
      {icon}{label}
    </button>
  );
}
