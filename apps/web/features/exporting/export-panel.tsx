"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileArchive, FileJson2, FileText } from "lucide-react";
import { useEffect, useState, type MutableRefObject } from "react";
import { MaintenanceHint } from "./maintenance-hint";
import { RecoverableExportControl } from "./recoverable-export-control";
import { captureOfflineAccess, assertOfflineAccess } from "../../lib/offline-access";
import { usePreferences } from "../../components/preferences-provider";
import { useClipboardCopy } from "../../components/use-clipboard-copy";
import { ExportPresetsPanel } from "./export-presets-panel";
import {
  getConversationAttachments,
  continuationApi,
  getConversationExportUrl,
  resolveSkill,
  type ConversationExportRequest,
} from "../../lib/api";


type ConversationExportFormat = "context" | "canjson" | "markdown";
type SkillLocale = "zh-CN" | "en";
export type ExportPanelState = { format: ConversationExportFormat; includeContinuation: boolean; includeAttachments: boolean; includeDescription: boolean; includeAnnotations: boolean; includeNotebook: boolean; includeSourceRefs: boolean; selectedScope?: boolean; jobId: string | null; jobKey: string | null };

export function ExportPanel({
  conversationId,
  selectedMessageIds,
  compact = false,
  maintenance = false,
  onOpenContinuation,
  stateRef,
  sourceRevision,
}: {
  conversationId: string;
  selectedMessageIds: string[];
  compact?: boolean;
  readingStartMessageId?: string | null;
  maintenance?: boolean;
  onOpenContinuation?: () => void;
  stateRef?: MutableRefObject<ExportPanelState | null>;
  sourceRevision?: number;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [format, setFormat] = useState<ConversationExportFormat>(stateRef?.current?.format ?? "context");
  const [includeContinuation, setIncludeContinuation] = useState(stateRef?.current?.includeContinuation ?? true);
  const [includeAttachments, setIncludeAttachments] = useState(stateRef?.current?.includeAttachments ?? false);
  const [includeDescription, setIncludeDescription] = useState(stateRef?.current?.includeDescription ?? false);
  const [includeAnnotations, setIncludeAnnotations] = useState(stateRef?.current?.includeAnnotations ?? false);
  const [includeNotebook, setIncludeNotebook] = useState(stateRef?.current?.includeNotebook ?? false);
  const [includeSourceRefs, setIncludeSourceRefs] = useState(stateRef?.current?.includeSourceRefs ?? true);
  const [selectedScope, setSelectedScope] = useState(stateRef?.current?.selectedScope ?? false);
  const [jobId, setJobId] = useState<string | null>(stateRef?.current?.jobId ?? null);
  const [jobKey, setJobKey] = useState<string | null>(stateRef?.current?.jobKey ?? null);
  useEffect(() => {
    if (stateRef) stateRef.current = { format, includeContinuation, includeAttachments, includeDescription, includeAnnotations, includeNotebook, includeSourceRefs, selectedScope, jobId, jobKey };
  }, [stateRef, format, includeContinuation, includeAttachments, includeDescription, includeAnnotations, includeNotebook, includeSourceRefs, selectedScope, jobId, jobKey]);
  const continuationState = useQuery({
    queryKey: ["continuation", conversationId, "state"],
    queryFn: ({ signal }) => continuationApi.state(conversationId, signal),
    enabled: format === "context" && includeContinuation,
    staleTime: 0,
  });
  const needsContinuationState = format === "context" && includeContinuation;
  const continuationUnavailable = needsContinuationState && !continuationState.isSuccess;
  const attachmentsQuery = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
    staleTime: 30_000,
  });
  const attachments = attachmentsQuery.data ?? [];
  const unavailableCount = attachments.filter((item) => item.resolution_status !== "resolved" || !item.asset_object).length;
  const exportOptions = { includeDescription, includeAnnotations, includeNotebook, includeSourceRefs };
  const plain = format !== "context" && !includeAttachments;
  const messageIds = plain && selectedScope ? selectedMessageIds : undefined;
  const selectionEmpty = Boolean(plain && selectedScope && !selectedMessageIds.length);
  const currentKey = JSON.stringify({ conversationId, sourceRevision, continuationGeneration: needsContinuationState ? continuationState.data?.generation : null, format, includeAttachments, includeContinuation, messageIds, ...exportOptions });
  // A background refresh with cached, unchanged generation must not repeatedly
  // unmount a valid immutable download. A changed generation still breaks the key.
  const exportScope = `${maintenance ? "maintenance" : "export"}:${conversationId}`;
  const plainHref = getConversationExportUrl(conversationId, {
    format: format === "canjson" ? "canjson_v2" : "markdown_v2",
    includeMetadata: true,
    includeDescription,
    includeAnnotations,
    includeNotebook,
    includeSourceRefs,
    messageIds,
  });
  const output = format === "context" ? ".context.zip" : format === "canjson"
    ? includeAttachments ? ".context.zip" : ".canjsonl"
    : includeAttachments ? "-markdown.zip" : ".md";

  const request: ConversationExportRequest = format === "context" ? {
    format: "context_package", context_scope: "full_conversation",
    context_attachment_policy: includeAttachments ? "include" : "metadata_only",
    continuation_policy: includeContinuation ? "auto" : "raw_only",
  } : {
    format: format === "canjson" ? includeAttachments ? "canjson_bundle" : "canjson_v2"
      : includeAttachments ? "markdown_bundle" : "markdown_v2",
    include_metadata: true, include_description: includeDescription,
    annotation_scope: includeAnnotations ? "all" : "none",
    notebook_scope: includeNotebook ? "current" : "none", include_source_refs: includeSourceRefs,
    ...(messageIds ? { message_ids: messageIds } : {}),
  };

  return (
    <section className="min-w-0 space-y-5">
      {!maintenance ? <div className="grid grid-cols-3 rounded-lg bg-subtle p-1" role="group" aria-label={zh ? "导出格式" : "Export format"}>
        <FormatButton active={format === "context"} onClick={() => setFormat("context")} icon={<FileArchive className="h-4 w-4 shrink-0" />} label={zh ? "交给 AI" : "For AI"} />
        <FormatButton active={format === "canjson"} onClick={() => setFormat("canjson")} icon={<FileJson2 className="h-4 w-4" />} label="CanJSON" />
        <FormatButton active={format === "markdown"} onClick={() => setFormat("markdown")} icon={<FileText className="h-4 w-4" />} label="Markdown" />
      </div> : null}

      {!maintenance && format === "context" && onOpenContinuation ? <MaintenanceHint key={conversationId} conversationId={conversationId} onOpen={onOpenContinuation} /> : null}

      {plain && (selectedMessageIds.length > 0 || selectedScope) ? <fieldset className="flex flex-wrap items-center gap-x-4 text-sm text-primary">
        <legend className="sr-only">{zh ? "导出范围" : "Export scope"}</legend>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={!selectedScope} onChange={() => setSelectedScope(false)} />{zh ? "完整对话" : "Full conversation"}</label>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" checked={selectedScope} onChange={() => setSelectedScope(true)} />{zh ? `所选 ${selectedMessageIds.length} 条消息` : `${selectedMessageIds.length} selected messages`}</label>
      </fieldset> : null}
      {selectionEmpty ? <p role="status" className="text-sm text-secondary">{zh ? "请在正文选择要导出的消息，或改为完整对话；不会自动扩大范围。" : "Select messages in the Reader or choose Full conversation. The scope will not expand automatically."}</p> : null}
      {!plain && selectedScope ? <p className="text-xs text-secondary">{zh ? "附件包和上下文包使用完整对话；切回无附件文件可继续导出所选消息。" : "Attachment and Context packages use the full conversation. Switch back to a file without attachments to export the selection."}</p> : null}

      <OptionRow
        checked={includeAttachments}
        onChange={setIncludeAttachments}
        label={zh ? "包含附件" : "Include attachments"}
        description={attachmentsQuery.isLoading
          ? (zh ? "正在检查当前对话文件" : "Checking conversation files")
          : attachmentsQuery.isError ? (zh ? "文件数量暂不可用" : "File count unavailable") : zh
            ? `${attachments.length} 个文件，${unavailableCount} 个缺失或不可用`
            : `${attachments.length} files, ${unavailableCount} missing or unavailable`}
      />

      {attachmentsQuery.isError ? <button type="button" disabled={attachmentsQuery.isFetching} onClick={() => void attachmentsQuery.refetch()} className="min-h-10 text-sm text-accent">{zh ? "重试读取附件" : "Retry loading attachments"}</button> : null}
      {maintenance ? null : format === "context" ? <OptionRow
        checked={includeContinuation}
        onChange={setIncludeContinuation}
        label={zh ? "包含接续文件" : "Include continuation files"}
        description={zh ? "包含最近保存的 Current / Index；关闭后只导出原始对话。" : "Include the latest saved Current / Index. Turn off for Raw-only."}
      /> : <details className="group rounded-lg border border-ui bg-surface">
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
      </details>}

      {!maintenance ? <div className="rounded-lg bg-subtle px-3 py-3 text-sm leading-6 text-secondary">
        <div className="mb-1 flex items-center gap-2 font-medium text-primary">
          {format === "context" || includeAttachments ? <FileArchive className="h-4 w-4" /> : format === "canjson" ? <FileJson2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          <span>{zh ? `输出 ${output}` : `Output ${output}`}</span>
        </div>
        <p>
          {format === "context"
            ? (zh ? "一个供 AI 继续工作的 Context 文件，包含当前对话、简介、批注、笔记和附件记录；附件文件可选。" : "One Context file for continuing with AI: current conversation, description, annotations, notebook, and attachment records. File binaries are optional.")
            : format === "canjson"
            ? includeAttachments
              ? (zh ? "结构化附件包包含当前对话、所选附加内容、附件元数据和可用文件；缺失文件保留记录。" : "The structured bundle contains the current conversation, selected secondary content, attachment metadata, and available files. Missing files remain recorded.")
              : (zh ? "结构化对话文件保留附件元数据和引用，但不包含文件二进制。" : "The structured conversation keeps attachment metadata and references without file binaries.")
            : includeAttachments
              ? (zh ? "解压后可直接在 Obsidian、Typora 或 VS Code 中打开，附件使用相对路径。" : "The extracted folder opens directly in Obsidian, Typora, or VS Code with relative attachment paths.")
              : (zh ? "单个 Markdown 文件；附件位置会显示为可读的未包含提示。" : "A single Markdown file with readable placeholders where files were omitted.")}
        </p>
      </div> : null}

      {needsContinuationState && continuationState.isError ? <button type="button" className="min-h-11 text-sm text-[var(--danger)]" onClick={() => void continuationState.refetch()}>{zh ? "接续文件状态读取失败，重试" : "Could not read continuation status; retry"}</button> : null}
      <RecoverableExportControl key={currentKey} conversationId={conversationId} identity={currentKey}
        request={request} zh={zh} scope={exportScope}
        disabled={selectionEmpty || continuationUnavailable || (needsContinuationState && continuationState.isFetching)}
        deliveryDisabled={continuationUnavailable}
        initialJobId={jobKey === currentKey ? jobId : null}
        plainHref={format !== "context" && !includeAttachments ? plainHref : undefined}
        onAccepted={task => { setJobId(task.job_id); setJobKey(currentKey); }}
        renderDelivery={format === "context" ? control => <ContextPackageDelivery downloadUrl="" downloadControl={control}
          defaultSkillLocale={zh ? "zh-CN" : "en"} purpose={maintenance ? "maintenance" : "acquisition"} /> : undefined}
      />
      {!compact && unavailableCount > 0 ? <p className="text-xs leading-5 text-secondary">{zh ? "缺失文件仍保留在元数据中，附件完整性会标记为 partial。" : "Missing files remain in metadata and make asset completeness partial."}</p> : null}
      {!maintenance ? <ExportPresetsPanel
        current={{ format, include_continuation: includeContinuation, include_attachments: includeAttachments, include_description: includeDescription, include_annotations: includeAnnotations, include_notebook: includeNotebook, include_source_refs: includeSourceRefs }}
        onApply={(preset) => {
          setFormat(preset.format);
          setIncludeContinuation(preset.include_continuation);
          setIncludeAttachments(preset.include_attachments);
          setIncludeDescription(preset.include_description);
          setIncludeAnnotations(preset.include_annotations);
          setIncludeNotebook(preset.include_notebook);
          setIncludeSourceRefs(preset.include_source_refs);
        }}
      /> : null}
    </section>
  );
}

export function ContextPackageDelivery({ downloadUrl, downloadFilename, downloadControl, defaultSkillLocale, offline = false, purpose = "acquisition" }: { downloadUrl: string; downloadFilename?: string; downloadControl?: React.ReactNode; defaultSkillLocale: SkillLocale; offline?: boolean; purpose?: "acquisition" | "maintenance" }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const skillLocale = defaultSkillLocale;
  const category = purpose === "maintenance" ? "CONTEXT_MAINTENANCE" : "EXPORT_CONTEXT";
  const resolved = useQuery({ queryKey: ["resolved-skill", category, skillLocale], queryFn: () => resolveSkill(category, skillLocale), enabled: !offline });
  const offlineUrl = purpose === "maintenance" ? "/skills/context-continuation-maintainer.zip" : "/skills/context-acquisition.zip";
  const cached = useQuery({ queryKey: ["cached-guide-skill", offlineUrl], enabled: offline, networkMode: "always", queryFn: async () => {
    const access = captureOfflineAccess();
    const response = await caches.match(offlineUrl);
    assertOfflineAccess(access);
    return response?.ok ?? false;
  } });
  const bundleUrl = offline ? cached.data ? offlineUrl : null : resolved.data?.bundle_url;
  const request = purpose === "maintenance"
    ? (zh ? "请使用我提供的维护 Skill 更新这个 .context.zip 内的 Current 和 Index，保留原始对话和附件，输出新的 .context.zip。" : "Use the supplied maintenance Skill to update Current and Index in this .context.zip. Preserve the raw conversation and attachments and return a new .context.zip.")
    : (zh ? "请使用我提供的接续 Skill 读取这个 .context.zip 并继续任务。" : "Use the supplied acquisition Skill to read this .context.zip and continue the task.");
  const { copy, state: copyState, manualRef } = useClipboardCopy(request);
  return <section className="space-y-3 border-t border-ui pt-3" data-testid="context-package-delivery">
    <p className="text-xs text-secondary">{offline ? (zh ? "使用缓存的系统默认 Skill ZIP。" : "Uses the cached system-default Skill ZIP.") : resolved.data?.name}</p>
    {downloadControl ?? <button type="button" className="btn-primary min-h-11 w-full px-3" onClick={() => { const link = document.createElement("a"); link.href = downloadUrl; link.download = downloadFilename ?? ""; link.click(); }}>{zh ? "下载上下文包" : "Download Context Package"}</button>}
    <div className="flex flex-wrap gap-3 text-sm">
      {bundleUrl ? <a href={bundleUrl} download className="min-h-11 py-3 text-accent">{purpose === "maintenance" ? (zh ? "下载维护 Skill" : "Download maintenance Skill") : (zh ? "下载接续 Skill" : "Download acquisition Skill")}</a> : null}
      <button type="button" disabled={copyState === "copying"} className="min-h-11 text-secondary disabled:opacity-50" onClick={() => void copy()}>{copyState === "copying" ? (zh ? "正在复制…" : "Copying…") : (zh ? "复制使用说明" : "Copy usage instructions")}</button>
    </div>
    {resolved.isError ? <button type="button" onClick={() => void resolved.refetch()} className="text-sm text-[var(--danger)]">{zh ? "Skill 读取失败，重试" : "Skill unavailable; retry"}</button> : null}
    {offline && !cached.isPending && !cached.data ? <p className="text-xs text-secondary">{zh ? "此 Skill 尚未缓存，联网后可下载；上下文包仍可下载。" : "This Skill is not cached. Download it when online; your Context Package is still available."}</p> : null}
    {copyState === "copied" ? <p role="status" className="text-xs text-secondary">{zh ? "使用说明已复制" : "Usage instructions copied"}</p> : null}
    {copyState === "failed" ? <div className="space-y-2"><p role="alert" className="text-xs text-[var(--danger)]">{zh ? "无法复制，请选中下方说明手动复制。" : "Could not copy. Select the instructions below and copy them manually."}</p><textarea ref={manualRef} readOnly aria-label={zh ? "交给 AI 的使用说明" : "Instructions for your AI"} value={request} onFocus={event => event.currentTarget.select()} rows={5} className="w-full resize-y rounded-md border border-ui bg-surface p-3 text-sm leading-6 text-primary" /></div> : null}
  </section>;
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
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 text-sm text-primary hover:bg-subtle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </label>
  );
}

function FormatButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-sm ${active ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary"}`}>
      {icon}{label}
    </button>
  );
}
