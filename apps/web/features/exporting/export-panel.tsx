"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Copy, Download, Eye, FileArchive, FileJson2, FileText, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { usePreferences } from "../../components/preferences-provider";
import {
  getConversationAttachments,
  getConversationExportUrl,
  getTask,
  queueConversationAttachmentBundleExport,
} from "../../lib/api";

type ConversationExportFormat = "canjson" | "markdown";
type SkillLocale = "zh-CN" | "en";

const CONTEXT_SKILLS: Record<SkillLocale, {
  url: string;
  filename: string;
  label: string;
}> = {
  "zh-CN": {
    url: "/skills/chat-reader-conversation-context-acquisition-skill.v1.md",
    filename: "Chat-Reader-Conversation-Context-Acquisition-Skill.v1.md",
    label: "中文",
  },
  en: {
    url: "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md",
    filename: "Chat-Reader-Conversation-Context-Acquisition-Skill.v1-en.md",
    label: "English",
  },
};

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
          format === "canjson" ? (
            <ContextPackageDelivery downloadUrl={String(downloadUrl)} defaultSkillLocale={zh ? "zh-CN" : "en"} />
          ) : (
            <a href={String(downloadUrl)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85">
              <Download className="h-4 w-4" />{zh ? "下载导出包" : "Download export"}
            </a>
          )
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

export function ContextPackageDelivery({ downloadUrl, downloadFilename, defaultSkillLocale }: { downloadUrl: string; downloadFilename?: string; defaultSkillLocale: SkillLocale }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [skillLocale, setSkillLocale] = useState<SkillLocale>(defaultSkillLocale);
  const [skillText, setSkillText] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const skill = CONTEXT_SKILLS[skillLocale];

  useEffect(() => {
    const controller = new AbortController();
    setSkillText(null);
    setSkillError(null);
    setStatus(null);
    void fetch(skill.url, { signal: controller.signal, credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(setSkillText)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSkillError(zh ? "解析 Skill 加载失败，请重试。" : "The parsing Skill could not be loaded. Try again.");
        console.error("context-skill-load-failed", error);
      });
    return () => controller.abort();
  }, [skill.url, zh]);

  async function copySkill(successMessage?: string) {
    if (!skillText) {
      setStatus({ kind: "error", message: skillError ?? (zh ? "解析 Skill 尚未加载完成。" : "The parsing Skill is not loaded yet.") });
      return false;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(skillText);
      setStatus({ kind: "success", message: successMessage ?? (zh ? "解析 Skill 已复制。" : "Parsing Skill copied.") });
      return true;
    } catch {
      setStatus({ kind: "error", message: zh ? "解析 Skill 复制失败，请允许剪贴板访问后重试。" : "Copy failed. Allow clipboard access and try again." });
      return false;
    }
  }

  function downloadPackageAndCopySkill() {
    const copyAttempt = skillText && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(skillText)
      : Promise.reject(new Error("skill-unavailable"));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = downloadFilename ?? "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    void copyAttempt.then(() => {
      setStatus({ kind: "success", message: zh ? "下载已开始，解析 Skill 已复制。" : "Download started and the parsing Skill was copied." });
    }).catch(() => {
      setStatus({ kind: "error", message: zh ? "下载已开始，但 Skill 复制失败。请点击“复制解析 Skill”重试。" : "Download started, but the Skill could not be copied. Use Copy parsing Skill to retry." });
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-ui bg-surface p-3" aria-label={zh ? "AI 上下文" : "AI context"} data-testid="context-package-delivery">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">{zh ? "AI 上下文" : "AI context"}</h3>
          <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "在新 AI 中上传 Context Package，然后粘贴解析 Skill。" : "Upload the Context Package to a new AI, then paste the parsing Skill."}</p>
        </div>
        <div className="grid grid-cols-2 rounded-md bg-subtle p-1" role="group" aria-label={zh ? "Skill 语言" : "Skill language"}>
          {(Object.keys(CONTEXT_SKILLS) as SkillLocale[]).map((locale) => (
            <button key={locale} type="button" onClick={() => setSkillLocale(locale)} aria-pressed={skillLocale === locale} className={`min-h-9 rounded px-3 text-xs ${skillLocale === locale ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary"}`}>
              {CONTEXT_SKILLS[locale].label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={downloadPackageAndCopySkill} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85">
        <Download className="h-4 w-4" />{zh ? "下载 Context Package" : "Download Context Package"}
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={!skillText} onClick={() => void copySkill()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">
          <Copy className="h-4 w-4" />{zh ? "复制解析 Skill" : "Copy parsing Skill"}
        </button>
        <button type="button" disabled={!skillText} onClick={() => setViewerOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">
          <Eye className="h-4 w-4" />{zh ? "查看 Skill" : "View Skill"}
        </button>
      </div>
      {skillError ? <p className="text-xs text-[var(--danger)]" role="alert">{skillError}</p> : null}
      {status ? <p className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${status.kind === "success" ? "bg-[var(--callout-tip-bg)] text-[var(--callout-tip-text)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`} role={status.kind === "success" ? "status" : "alert"}>{status.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}<span>{status.message}</span></p> : null}
      <ContextSkillDialog open={viewerOpen} onClose={() => setViewerOpen(false)} skill={skill} text={skillText ?? ""} onCopy={() => void copySkill()} />
    </section>
  );
}

function ContextSkillDialog({ open, onClose, skill, text, onCopy }: {
  open: boolean;
  onClose: () => void;
  skill: (typeof CONTEXT_SKILLS)[SkillLocale];
  text: string;
  onCopy: () => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useDialogFocus({ open, rootRef, onClose, initialFocusRef: titleRef });
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[360] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="context-skill-title" tabIndex={-1} className="flex h-[100dvh] w-full flex-col overflow-hidden bg-page shadow-2xl sm:h-[min(86vh,900px)] sm:max-w-4xl sm:rounded-lg sm:border sm:border-ui">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-ui bg-surface px-4">
          <div className="min-w-0 flex-1">
            <h2 ref={titleRef} id="context-skill-title" tabIndex={-1} className="truncate text-sm font-semibold text-primary" title={skill.filename}>{zh ? "解析 Skill" : "Parsing Skill"}</h2>
            <p className="truncate text-[11px] text-secondary">Chat Reader Context Acquisition Skill</p>
          </div>
          <button type="button" onClick={onCopy} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-primary hover:bg-subtle"><Copy className="h-4 w-4" />{zh ? "复制" : "Copy"}</button>
          <a href={skill.url} download={skill.filename} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-primary hover:bg-subtle"><Download className="h-4 w-4" />{zh ? "下载" : "Download"}</a>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words font-mono text-xs leading-6 text-primary">{text}</pre>
        </div>
      </div>
    </div>,
    document.body,
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
