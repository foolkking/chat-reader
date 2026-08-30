"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FileArchive, FileJson2, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { offlineDb } from "../../lib/offline-db";
import { exportOfflineConversation, type OfflineExportFormat } from "../../lib/offline-export";
import { ContextPackageDelivery } from "./export-panel";

type ExportResultState = {
  url: string;
  filename: string;
  contextPackage: boolean;
  missingAttachmentCount: number;
};

export function OfflineExportPanel({ conversationId }: { conversationId: string }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [format, setFormat] = useState<OfflineExportFormat>("canjson");
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [includeNotebook, setIncludeNotebook] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResultState | null>(null);
  const attachmentCountQuery = useQuery({
    queryKey: ["offline-export-attachment-count", conversationId],
    queryFn: () => offlineDb.attachments.where("conversation_id").equals(conversationId).count(),
    staleTime: 10_000,
  });

  useEffect(() => () => {
    if (result?.url) URL.revokeObjectURL(result.url);
  }, [result]);

  function resetResult() {
    setError(null);
    setResult(null);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const exported = await exportOfflineConversation(conversationId, {
        format,
        includeAttachments,
        includeDescription,
        includeAnnotations,
        includeNotebook,
      });
      setResult({
        url: URL.createObjectURL(exported.blob),
        filename: exported.filename,
        contextPackage: exported.contextPackage,
        missingAttachmentCount: exported.missingAttachmentCount,
      });
    } catch (reason) {
      setError(reason instanceof Error ? localizeOfflineExportError(reason.message, zh) : (zh ? "无法生成离线导出。" : "Unable to create the offline export."));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="min-w-0 space-y-5" data-testid="offline-export-panel">
      <div className="rounded-lg bg-subtle px-3 py-2 text-xs leading-5 text-secondary">
        {zh ? "离线导出使用当前已下载快照，不连接服务器。未缓存的附件只保留元数据。" : "Offline export uses the downloaded snapshot and never contacts the server. Uncached files remain as metadata only."}
      </div>
      <div className="grid grid-cols-2 rounded-lg bg-subtle p-1" role="group" aria-label={zh ? "导出格式" : "Export format"}>
        <FormatButton active={format === "canjson"} onClick={() => { setFormat("canjson"); resetResult(); }} icon={<FileJson2 className="h-4 w-4" />} label="CanJSON" />
        <FormatButton active={format === "markdown"} onClick={() => { setFormat("markdown"); resetResult(); }} icon={<FileText className="h-4 w-4" />} label="Markdown" />
      </div>
      <label className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-ui px-3 text-sm text-primary">
        <span className="min-w-0"><span className="block font-medium">{zh ? "包含已缓存附件" : "Include cached attachments"}</span><span className="block text-xs leading-5 text-secondary">{zh ? `${attachmentCountQuery.data ?? 0} 个附件记录` : `${attachmentCountQuery.data ?? 0} attachment records`}</span></span>
        <input type="checkbox" checked={includeAttachments} onChange={(event) => { setIncludeAttachments(event.target.checked); resetResult(); }} className="h-5 w-5 accent-[var(--accent)]" />
      </label>
      <details className="group rounded-lg border border-ui bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-primary"><span>{zh ? "更多内容选项" : "More content options"}</span><ChevronDown className="h-4 w-4 text-secondary transition-transform group-open:rotate-180" /></summary>
        <div className="space-y-1 border-t border-ui p-2">
          <CompactOption checked={includeDescription} onChange={(value) => { setIncludeDescription(value); resetResult(); }} label={zh ? "包含对话简介" : "Include conversation description"} />
          <CompactOption checked={includeAnnotations} onChange={(value) => { setIncludeAnnotations(value); resetResult(); }} label={zh ? "包含批注" : "Include annotations"} />
          <CompactOption checked={includeNotebook} onChange={(value) => { setIncludeNotebook(value); resetResult(); }} label={zh ? "包含笔记" : "Include notebook"} />
        </div>
      </details>
      <div className="rounded-lg bg-subtle px-3 py-3 text-sm leading-6 text-secondary">
        <div className="mb-1 flex items-center gap-2 font-medium text-primary">{includeAttachments ? <FileArchive className="h-4 w-4" /> : format === "canjson" ? <FileJson2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}<span>{format === "canjson" ? includeAttachments ? ".context.zip" : ".canonical.jsonl" : includeAttachments ? "-markdown.zip" : ".md"}</span></div>
        <p>{zh ? "导出只包含该离线副本中已有的当前版本数据。" : "The export contains the current-version data available in this offline copy."}</p>
      </div>
      {result ? result.contextPackage ? (
        <ContextPackageDelivery downloadUrl={result.url} downloadFilename={result.filename} defaultSkillLocale={zh ? "zh-CN" : "en"} offline />
      ) : (
        <a href={result.url} download={result.filename} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85"><Download className="h-4 w-4" />{zh ? "下载导出文件" : "Download export"}</a>
      ) : (
        <button type="button" disabled={generating} onClick={() => void generate()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85 disabled:cursor-wait disabled:opacity-60"><FileArchive className="h-4 w-4" />{generating ? (zh ? "正在本地生成…" : "Generating locally…") : (zh ? "生成离线导出" : "Generate offline export")}</button>
      )}
      {result?.missingAttachmentCount ? <p className="text-xs leading-5 text-secondary">{zh ? `${result.missingAttachmentCount} 个附件未缓存，已保留元数据但未写入文件。` : `${result.missingAttachmentCount} uncached attachments remain as metadata and were not written as files.`}</p> : null}
      {error ? <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}

function FormatButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm ${active ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary"}`}>{icon}{label}</button>;
}

function CompactOption({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm text-primary hover:bg-subtle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /></label>;
}

function localizeOfflineExportError(message: string, zh: boolean): string {
  if (!zh) return message;
  if (message.includes("256 MiB")) return "离线导出超过 256 MiB 浏览器安全上限，请联网后导出。";
  if (message.includes("not found")) return "找不到当前离线对话。";
  return "无法生成离线导出，请重试。";
}
