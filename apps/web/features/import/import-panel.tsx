"use client";

import { importErrorMessage, useImportCopy, type ImportCopy } from "./import-workspace-copy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, ScanSearch, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { ApiRequestError, cancelAdaptiveImportSession, commitImport, createAdaptiveImportSession, getAdaptiveImportSession, getImportStatus, getProjects, previewImport, retryTask, updateAdaptiveImportDestination } from "../../lib/api";
import type { AdaptiveImportSession, CommitImportResponse, ImportDuplicatePolicy, ImportPreviewResponse } from "../../lib/types";
import { readAccountCapabilities } from "../../lib/auth-client";
import { authenticationGeneration } from "../../lib/offline-access";
import { SupportLimitAction } from "../../components/support-limit-action";
import { ImportPreviewCard } from "./import-preview-card";
import { AdaptiveImportWorkspace } from "./adaptive-import-workspace";
import { FormatConversionGuide } from "./format-conversion-guide";
import { ImportNoiseReview } from "./import-noise-review";
import { createPastedTranscriptFile, pastedTranscriptByteLength } from "./pasted-transcript";

type ImportMode = "adaptive" | "archive";
type ImportSessionRestoreState = {
  phase: "idle" | "loading" | "error";
  error: unknown | null;
};
const ACTIVE_SESSION_KEY = "chat-reader:adaptive-import-session";

function sessionStorageKey(repairProfileId?: string | null): string {
  return repairProfileId ? `${ACTIVE_SESSION_KEY}:repair:${repairProfileId}` : ACTIVE_SESSION_KEY;
}

export function ImportPanel({
  repairProfileId,
  resumeImportId,
  initialMode = "adaptive",
  initialFiles = [],
  targetProjectId: initialProjectId = null,
  onImportCommitted,
  onWorkspaceChange,
  onMappingStateChange,
}: {
  repairProfileId?: string | null;
  resumeImportId?: string | null;
  initialMode?: ImportMode;
  initialFiles?: File[];
  targetProjectId?: string | null;
  onImportCommitted?: () => void;
  onWorkspaceChange?: (open: boolean) => void;
  onMappingStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
} = {}) {
  const tr = useImportCopy();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const current = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const capabilities = useQuery({ queryKey: ["account-capabilities"], queryFn: ({ signal }) => readAccountCapabilities(signal), staleTime: 0, refetchOnWindowFocus: true });
  const projects = useQuery({
    queryKey: ["projects", "custom", "asc"],
    queryFn: ({ signal }) => getProjects({ sort: "custom", direction: "asc" }, signal),
    staleTime: 60_000,
  });
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [inputMethod, setInputMethod] = useState<"files" | "paste">("files");
  const [pastedText, setPastedText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [archivePreview, setArchivePreview] = useState<ImportPreviewResponse | null>(null);
  const [session, setSession] = useState<AdaptiveImportSession | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(initialProjectId);
  const [sessionRestore, setSessionRestore] = useState<ImportSessionRestoreState>({ phase: "idle", error: null });
  const [sessionRestoreRetry, setSessionRestoreRetry] = useState(0);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [terminalImportError, setTerminalImportError] = useState<string | null>(null);
  const [terminalImportId, setTerminalImportId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);
  const conversionId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<ImportDuplicatePolicy>("clone");
  const completedImportRef = useRef<string | null>(null);
  const resumeSessionRef = useRef(resumeImportId);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const targetSessionRef = useRef<string | null>(null);
  const activeSessionKey = sessionStorageKey(repairProfileId);
  const activeFileBytes = inputMethod === "paste"
    ? (pastedText ? pastedTranscriptByteLength(pastedText) : 0)
    : files.reduce((largest, file) => Math.max(largest, file.size), 0);
  const activeTotalBytes = inputMethod === "paste" ? activeFileBytes : files.reduce((bytes, file) => bytes + file.size, 0);
  const largestFileMiB = Math.ceil(activeFileBytes / (1024 * 1024));
  const fileOverLimit = capabilities.data && largestFileMiB > capabilities.data.maximum_import_size_mb;

  useEffect(() => onWorkspaceChange?.(Boolean(session)), [onWorkspaceChange, session]);
  useEffect(() => {
    if (!initialFiles.length) return;
    const droppedArchive = initialFiles.length === 1 && /\.cr$/i.test(initialFiles[0]?.name ?? "");
    setMode(droppedArchive ? "archive" : initialMode);
    setFiles(initialFiles);
  }, [initialFiles, initialMode]);
  useEffect(() => {
    if (!session?.import_id || targetSessionRef.current === session.import_id) return;
    targetSessionRef.current = session.import_id;
    setTargetProjectId(session.target_project_id !== undefined ? session.target_project_id : initialProjectId);
  }, [initialProjectId, session?.import_id, session?.target_project_id]);
  useEffect(() => {
    let active = true;
    const importId = resumeSessionRef.current ?? window.sessionStorage.getItem(activeSessionKey);
    if (!importId || session) return;
    const controller = new AbortController();
    setSessionRestore({ phase: "loading", error: null });
    void getAdaptiveImportSession(importId, controller.signal)
      .then(async (restored) => {
        if (!active || !current()) return;
        if (restored.state === "COMPLETED") {
          const result = await getImportStatus(restored.import_id);
          if (!active || !current()) return;
          if (result.status !== "committed") throw new Error("IMPORT_RESULT_UNCONFIRMED");
          setCommitResult(result);
        }
        if (["COMPLETED", "CANCELED"].includes(restored.state)) {
          resumeSessionRef.current = null;
          window.sessionStorage.removeItem(activeSessionKey);
          setSessionRestore({ phase: "idle", error: null });
          return;
        }
        window.sessionStorage.setItem(activeSessionKey, restored.import_id);
        resumeSessionRef.current = null;
        targetSessionRef.current = restored.import_id;
        setTargetProjectId(restored.target_project_id !== undefined ? restored.target_project_id : initialProjectId);
        setSession(restored);
        setSessionRestore({ phase: "idle", error: null });
      })
      .catch((error: unknown) => {
        if (!active || !current() || controller.signal.aborted) return;
        setSessionRestore({ phase: "error", error });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSessionKey, current, initialProjectId, resumeImportId, session, sessionRestoreRetry]);

  const analysisSessionQuery = useQuery({
    queryKey: ["adaptive-import-analysis", session?.import_id, generation.current],
    queryFn: async ({ signal }) => {
      const value = await getAdaptiveImportSession(session!.import_id, signal);
      return { value, generation: generation.current };
    },
    enabled: current() && Boolean(session && ["COLLECTING", "ANALYZING", "CANCELING"].includes(session.state)),
    refetchInterval: query => !query.state.data || ["COLLECTING", "ANALYZING", "CANCELING"].includes(query.state.data.value.state) ? 1500 : false,
    retry: 2,
  });
  useEffect(() => {
    const result = analysisSessionQuery.data;
    if (!result || !current() || result.generation !== authenticationGeneration() || result.value.import_id !== session?.import_id) return;
    setSession(result.value);
    if (!["COLLECTING", "ANALYZING", "CANCELING"].includes(result.value.state)) {
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    }
  }, [analysisSessionQuery.data, current, queryClient, session?.import_id]);

  const finishCommittedImport = useCallback((result: CommitImportResponse) => {
    if (!current()) return;
    if (completedImportRef.current === result.import_id) return;
    completedImportRef.current = result.import_id;
    setTerminalImportError(null);
    setTerminalImportId(null);
    window.sessionStorage.removeItem(activeSessionKey);
    // The adaptive workspace owns the pre-commit session. Once the server has
    // committed it, release that surface so the terminal result summary can be
    // rendered and the user can choose where to go next.
    setSession(null);
    setPendingImportId(null);
    setCommitResult(result);
    void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [activeSessionKey, current, queryClient]);
  const finishTerminalImport = useCallback((result: CommitImportResponse) => {
    if (!current()) return;
    setPendingImportId(null);
    setCommitResult(null);
    setTerminalImportId(result.import_id);
    setTerminalImportError(result.status === "cancelled" ? "IMPORT_COMMIT_CANCELLED" : "IMPORT_COMMIT_FAILED");
  }, [current]);

  const importStatusQuery = useQuery({
    queryKey: ["import-status", pendingImportId],
    queryFn: () => getImportStatus(pendingImportId!),
    enabled: Boolean(pendingImportId),
    refetchInterval: (query) => ["queued", "processing"].includes(query.state.data?.status ?? "") ? 1200 : false,
  });
  useEffect(() => {
    const result = importStatusQuery.data;
    if (!result) return;
    if (result.status === "committed") finishCommittedImport(result);
    else if (result.status === "failed" || result.status === "cancelled") finishTerminalImport(result);
  }, [finishCommittedImport, finishTerminalImport, importStatusQuery.data]);

  const adaptiveMutation = useMutation({
    mutationFn: (selectedFiles: File[]) => createAdaptiveImportSession(selectedFiles, repairProfileId, targetProjectId),
    onSuccess: (result) => {
      if (!current()) return;
      window.sessionStorage.setItem(activeSessionKey, result.import_id);
      targetSessionRef.current = result.import_id;
      setSession(result);
      setTargetProjectId(result.target_project_id !== undefined ? result.target_project_id : initialProjectId);
      setFiles([]);
      setArchivePreview(null);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelAdaptiveImportSession,
    onSuccess: () => {
      if (!current()) return;
      window.sessionStorage.removeItem(activeSessionKey);
      reset("adaptive");
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => { if (current()) { setArchivePreview(result); setSession(null); } },
  });
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: ImportDuplicatePolicy }) => commitImport(importId, { duplicatePolicy: policy, projectId: targetProjectId }),
    onSuccess: (result) => {
      if (!current()) return;
      setTerminalImportError(null);
      setCommitResult(result);
      if (result.status === "committed") finishCommittedImport(result);
      else if (result.status === "failed" || result.status === "cancelled") finishTerminalImport(result);
      else setPendingImportId(result.import_id);
    },
  });
  const retryImportMutation = useMutation({
    mutationFn: (importId: string) => retryTask(importId),
    onSuccess: (task) => {
      if (!current()) return;
      setTerminalImportError(null);
      setTerminalImportId(null);
      setCommitResult(null);
      setPendingImportId(task.job_id);
      if (session) {
        void getAdaptiveImportSession(task.job_id).then(next => { if (current()) setSession(next); }).catch(() => undefined);
      }
    },
  });
  const retryAnalysisMutation = useMutation({
    mutationFn: (taskId: string) => retryTask(taskId),
    onSuccess: task => {
      if (!current()) return;
      setSession(previous => previous?.analysis_task_id === task.job_id
        ? { ...previous, state: "ANALYZING", phase: "queued", progress: 0, error_message: null }
        : previous);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["adaptive-import-analysis", session?.import_id] });
    },
  });
  const destinationMutation = useMutation({
    mutationFn: ({ importId, projectId }: { importId: string; projectId: string | null }) => updateAdaptiveImportDestination(importId, projectId),
    onSuccess: (updated) => {
      if (!current()) return;
      setSession(updated);
      setTargetProjectId(updated.target_project_id ?? null);
      targetSessionRef.current = updated.import_id;
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const busy = sessionRestore.phase === "loading" || adaptiveMutation.isPending || archiveMutation.isPending || commitMutation.isPending || retryImportMutation.isPending || Boolean(pendingImportId);

  const validationError = useMemo(() => {
    if (capabilities.data && !capabilities.data.allow_user_import) return tr("管理员已关闭导入功能。");
    if (inputMethod === "paste") {
      if (!pastedText.trim()) return null;
      if (capabilities.data && activeFileBytes > capabilities.data.maximum_import_size_mb * 1024 * 1024) return tr("粘贴文本不能超过当前上限 {0} MiB。", capabilities.data.maximum_import_size_mb);
      const pasteTotalLimit = capabilities.data?.maximum_import_total_mb;
      if (pasteTotalLimit != null && activeTotalBytes > pasteTotalLimit * 1024 * 1024) return tr("粘贴文本超过本批导入上限 {0} MiB。", pasteTotalLimit);
      return null;
    }
    if (capabilities.data && files.some((file) => file.size > capabilities.data.maximum_import_size_mb * 1024 * 1024)) return tr("单个文件不能超过当前上限 {0} MiB。", capabilities.data.maximum_import_size_mb);
    const totalLimit = capabilities.data?.maximum_import_total_mb;
    if (totalLimit != null && files.reduce((bytes, file) => bytes + file.size, 0) > totalLimit * 1024 * 1024) return tr("本批文件合计不能超过 {0} MiB，请分批导入。", totalLimit);
    return validateFiles(files, mode, tr);
  }, [activeFileBytes, activeTotalBytes, files, inputMethod, mode, pastedText, capabilities.data, tr]);
  const targetProject = projects.data?.find((project) => project.id === targetProjectId);
  const destinationUnavailable = Boolean(targetProjectId && projects.isSuccess && !targetProject);

  function reset(nextMode = mode) {
    resumeSessionRef.current = null;
    setMode(nextMode);
    setInputMethod("files");
    setPastedText("");
    setFiles([]);
    setArchivePreview(null);
    setSession(null);
    setSessionRestore({ phase: "idle", error: null });
    setPendingImportId(null);
    setCommitResult(null);
    setTerminalImportError(null);
    setTerminalImportId(null);
    setConversionOpen(false);
    setDuplicatePolicy("clone");
    completedImportRef.current = null;
    adaptiveMutation.reset();
    archiveMutation.reset();
    commitMutation.reset();
    retryImportMutation.reset();
  }

  function chooseFiles(nextFiles: File[], nextMode = mode) {
    if (busy) return;
    window.sessionStorage.removeItem(activeSessionKey);
    reset(nextMode);
    setFiles(nextFiles);
  }

  function previewImportSource() {
    if (inputMethod === "paste") {
      const pastedFile = createPastedTranscriptFile(pastedText);
      if (pastedFile) adaptiveMutation.mutate([pastedFile]);
      return;
    }
    if (mode === "archive") archiveMutation.mutate(files);
    else adaptiveMutation.mutate(files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const nextFiles = Array.from(event.dataTransfer.files);
    chooseFiles(nextFiles);
  }

  if (session) {
    const analysisPending = ["COLLECTING", "ANALYZING", "CANCELING"].includes(session.state);
    const analysisFailed = session.state === "FAILED" && session.phase === "analysis_failed";
    if (analysisPending || analysisFailed || session.state === "CANCELED") {
      return (
        <section className="space-y-4" aria-labelledby="import-analysis-title" data-testid="import-analysis-status">
          <ImportDestinationPicker
            projects={projects.data ?? []}
            projectId={targetProjectId}
            onChange={(projectId) => destinationMutation.mutate({ importId: session.import_id, projectId })}
            disabled={destinationMutation.isPending || session.state === "CANCELING" || session.state === "CANCELED"}
            saving={destinationMutation.isPending}
            unavailable={destinationUnavailable}
            error={destinationMutation.error}
          />
          <h3 id="import-analysis-title" className="text-lg font-semibold text-primary">
            {tr(analysisFailed ? "导入分析未完成" : session.state === "CANCELED" ? "导入分析已取消" : session.state === "CANCELING" ? "正在停止导入分析" : session.phase === "queued" ? "已加入后台分析队列" : "正在后台分析文件")}
          </h3>
          <p className="text-sm leading-6 text-secondary">{session.state === "CANCELED"
            ? tr("本次临时来源已移除，尚未导入对话。你可以重新选择文件。")
            : tr("这批 {0} 个文件已保存在服务器。你可以关闭此窗口继续阅读，在任务中心查看进度和结果。", session.file_count)}</p>
          {analysisPending ? <div role="progressbar" aria-label={tr("导入分析")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, session.progress ?? 0))} className="h-1 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, session.progress ?? 0))}%` }} />
          </div> : null}
          {analysisFailed ? <p role="alert" className="text-sm text-[var(--danger)]">{tr("首轮分析失败，尚未导入对话。源文件仍保留，可在任务中心重试或重新选择文件。")}</p> : null}
          {analysisSessionQuery.error ? <ErrorLine message={analysisSessionQuery.error} onRetry={() => { void analysisSessionQuery.refetch(); }} retrying={analysisSessionQuery.isFetching} /> : null}
          {cancelMutation.error || retryAnalysisMutation.error ? <ErrorLine message={cancelMutation.error ?? retryAnalysisMutation.error} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11 px-4 text-sm" onClick={() => { onImportCommitted?.(); window.dispatchEvent(new Event("chat-reader:open-task-center")); }}>{tr("查看后台任务")}</button>
            {analysisFailed && session.analysis_task_id ? <button type="button" disabled={retryAnalysisMutation.isPending} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => retryAnalysisMutation.mutate(session.analysis_task_id!)}>{tr(retryAnalysisMutation.isPending ? "正在提交重试…" : "重试分析")}</button> : null}
            {session.state !== "CANCELING" ? <button type="button" disabled={cancelMutation.isPending || retryAnalysisMutation.isPending} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => cancelMutation.mutate(session.import_id)}>{tr(analysisFailed || session.state === "CANCELED" ? "重新选择文件" : "取消本次分析")}</button> : null}
          </div>
        </section>
      );
    }
    return (
      <section className="space-y-4">
        <ImportDestinationPicker
          projects={projects.data ?? []}
          projectId={targetProjectId}
          onChange={(projectId) => destinationMutation.mutate({ importId: session.import_id, projectId })}
          disabled={destinationMutation.isPending || commitMutation.isPending || Boolean(pendingImportId)}
          saving={destinationMutation.isPending}
          unavailable={destinationUnavailable}
          error={destinationMutation.error}
        />
        <AdaptiveImportWorkspace
          onMappingStateChange={onMappingStateChange}
          session={session}
          onSession={setSession}
          onBack={() => cancelMutation.mutate(session.import_id)}
          onImport={() => commitMutation.mutate({ importId: session.import_id, policy: duplicatePolicy })}
          importing={commitMutation.isPending || Boolean(pendingImportId)}
          error={retryImportMutation.error ?? cancelMutation.error ?? commitMutation.error ?? terminalImportError ?? importStatusQuery.data?.error_message ?? null}
          onRetryImport={terminalImportId ? () => retryImportMutation.mutate(terminalImportId) : undefined}
          retryingImport={retryImportMutation.isPending}
          statusError={importStatusQuery.error}
          onRetryStatus={() => { void importStatusQuery.refetch(); }}
          statusRetrying={importStatusQuery.isFetching}
        />
      </section>
    );
  }

  const selectedLabel = inputMethod === "paste"
    ? (pastedText.trim() ? tr("已准备一段粘贴文本") : tr("尚未粘贴文本"))
    : files.length === 0 ? tr("尚未选择文件") : files.length === 1 ? files[0]?.name : tr("已选择 {0} 个文件", files.length);
  const archiveCanCommit = Boolean(archivePreview?.can_commit ?? archivePreview?.archive_summary);
  const totalOverLimit = capabilities.data?.maximum_import_total_mb != null && activeTotalBytes > capabilities.data.maximum_import_total_mb * 1024 * 1024;
  const sourceError = adaptiveMutation.error;
  const formatError = sourceError instanceof ApiRequestError && ["SOURCE_UNSUPPORTED", "JSON_INVALID", "NO_MESSAGE_STRUCTURE", "MARKDOWN_ENCODING_INVALID", "MARKDOWN_FENCE_UNCLOSED"].includes(sourceError.code ?? "");
  const showConversion = inputMethod === "files" && mode === "adaptive" && !commitResult && capabilities.data?.allow_user_import && !fileOverLimit && !totalOverLimit && files.length <= 500
    && !files.some(file => /\.(?:cr|zip)$/i.test(file.name) || file.name.toLowerCase() === "skill.md")
    && (!sourceError || formatError);

  return (
    <section className="space-y-5">
      {sessionRestore.phase === "loading" ? <p role="status" className="text-sm text-secondary">{tr("正在恢复已保存的导入会话…")}</p> : null}
      {sessionRestore.phase === "error" ? <ErrorLine message={sessionRestore.error} onRetry={() => { setSessionRestore({ phase: "loading", error: null }); setSessionRestoreRetry((attempt) => attempt + 1); }} /> : null}
      {repairProfileId ? <p className="text-sm leading-6 text-secondary">{tr("选择一组采用该格式的代表性源文件。验证成功后会保存新版本，旧版本继续可用。")}</p> : null}
      <ImportDestinationPicker
        projects={projects.data ?? []}
        projectId={targetProjectId}
        onChange={setTargetProjectId}
        disabled={busy || mode === "archive"}
        unavailable={destinationUnavailable}
      />
      {mode === "adaptive" && !repairProfileId ? <div className="flex flex-wrap gap-2" role="group" aria-label={tr("导入来源")}>
        <button type="button" aria-pressed={inputMethod === "files"} className={inputMethod === "files" ? "btn-primary min-h-11 px-3 text-sm" : "btn-secondary min-h-11 px-3 text-sm"} onClick={() => setInputMethod("files")}>{tr("选择文件")}</button>
        <button type="button" aria-pressed={inputMethod === "paste"} className={inputMethod === "paste" ? "btn-primary min-h-11 px-3 text-sm" : "btn-secondary min-h-11 px-3 text-sm"} onClick={() => setInputMethod("paste")}>{tr("粘贴文本")}</button>
      </div> : null}
      {inputMethod === "paste" && mode === "adaptive" && !repairProfileId ? <div className="space-y-2">
        <label htmlFor="pasted-transcript" className="block text-sm font-medium text-primary">{tr("粘贴 Markdown 或纯文本对话")}</label>
        <textarea
          id="pasted-transcript"
          data-testid="pasted-transcript-input"
          value={pastedText}
          onChange={(event) => setPastedText(event.currentTarget.value)}
          disabled={busy}
          spellCheck={false}
          rows={8}
          placeholder={tr("在此处粘贴文本；点击“分析并继续”后才会上传。")}
          className="w-full resize-y rounded-lg border border-ui bg-surface p-3 text-sm leading-6 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-60"
        />
        <p className="text-xs leading-5 text-secondary">{tr("不会自动读取剪贴板。文本只保留在此页面内存中，只有你明确开始分析时才上传；请勿粘贴不打算导入的敏感内容。")}</p>
        {pastedText.trim() ? <p className="text-xs text-secondary">{tr("输入大小：")}{(activeFileBytes / (1024 * 1024)).toFixed(2)} MiB</p> : null}
      </div> : <div
        onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border border-dashed text-center transition-colors ${conversionOpen ? "px-4 py-3" : "px-6 py-8"} ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui bg-subtle"}`}
      >
        {!conversionOpen ? <><UploadCloud className="mx-auto h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-primary">{tr("拖放文件到这里")}</p>
        <p className="my-2 text-xs text-secondary">{tr("或")}</p></> : null}
        <label className={`btn-secondary inline-flex min-h-11 focus-within:ring-2 focus-within:ring-[var(--focus)] items-center justify-center px-4 text-sm font-medium ${busy ? "cursor-wait opacity-50" : "cursor-pointer"}`}>
          {mode === "adaptive" ? tr("选择 JSON / Markdown 文件") : tr("选择 .cr 归档")}
          <input ref={fileInputRef} disabled={busy} data-dialog-initial-focus="true" key={mode} type="file" data-testid="import-file-input" multiple={mode === "adaptive"} className="sr-only" accept={mode === "adaptive" ? ".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm" : ".cr"} onChange={(event) => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) chooseFiles(selected); }} />
        </label>
        {files.length ? <p className="mt-3 break-all text-sm text-secondary">{inputMethod === "files" ? selectedLabel : tr("已保留 {0} 个文件选项", files.length)}</p> : null}
      </div>}
      {validationError ? <ErrorLine message={validationError} /> : null}
      {capabilities.data ? <SupportLimitAction capabilities={capabilities.data} limit="import_size_mb" active={Boolean(fileOverLimit || !capabilities.data.allow_user_import)} requestedValue={largestFileMiB} returnFocus={() => previewButtonRef.current} onReturn={() => { void capabilities.refetch(); }} /> : null}
      {capabilities.data ? <p className="text-xs text-secondary">{tr("当前单文件上限：")}{capabilities.data.maximum_import_size_mb} MiB</p> : capabilities.isError ? <div role="alert" className="text-sm text-secondary">{tr("无法读取导入限制。")}<button type="button" className="btn-secondary ml-2 min-h-11 px-3" onClick={() => void capabilities.refetch()}>{tr("重试")}</button></div> : <p role="status" className="text-sm text-secondary">{tr("正在读取导入限制…")}</p>}
      {adaptiveMutation.isError ? <ErrorLine message={adaptiveMutation.error} action="mutation" /> : null}
      {archiveMutation.isError ? <ErrorLine message={archiveMutation.error} action="mutation" /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error} action="commit" /> : null}
      {(retryImportMutation.error || terminalImportError) ? <ErrorLine message={retryImportMutation.error ?? terminalImportError} action="commit" onRetry={terminalImportId ? () => retryImportMutation.mutate(terminalImportId) : undefined} retrying={retryImportMutation.isPending} /> : null}
      {importStatusQuery.error ? <ErrorLine message={importStatusQuery.error} onRetry={() => { void importStatusQuery.refetch(); }} retrying={importStatusQuery.isFetching} /> : null}
      {showConversion ? <div className="border-y border-ui">
        <button type="button" disabled={busy} aria-expanded={conversionOpen} aria-controls={conversionId} onClick={() => setConversionOpen(open => !open)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm text-secondary hover:text-primary disabled:opacity-50">{tr("格式不支持？")}<ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${conversionOpen ? "rotate-180" : ""}`} aria-hidden="true" /></button>
        {conversionOpen ? <div id={conversionId} className="pb-4 pt-2"><FormatConversionGuide resultAction={<button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => fileInputRef.current?.click()}>{files.length > 1 ? tr("重新选择本批文件") : tr("选择转换后的文件")}</button>} /></div> : null}
      </div> : null}
      <div className="flex flex-wrap gap-3">
        <button ref={previewButtonRef} type="button" disabled={!(inputMethod === "paste" ? pastedText.trim() : files.length) || Boolean(validationError) || busy || !capabilities.data} data-testid="preview-import-button" onClick={previewImportSource} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-medium">
          {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />{tr("正在识别格式")}</> : mode === "adaptive" ? <><ScanSearch className="h-4 w-4" />{tr("分析并继续")}</> : tr("检查归档")}
        </button>
        {archivePreview ? <button type="button" disabled={!archiveCanCommit || commitMutation.isPending} data-testid="commit-import-button" onClick={() => commitMutation.mutate({ importId: archivePreview.import_id, policy: duplicatePolicy })} className="btn-secondary min-h-10 px-4 text-sm font-medium">{commitMutation.isPending ? tr("正在导入") : tr("恢复归档")}</button> : null}
      </div>
      {archivePreview ? <ImportPreviewCard preview={archivePreview} /> : null}
      {archivePreview?.duplicate_conversation_id ? <div className="border-l-2 border-[var(--warning)] pl-3 text-sm text-secondary"><p>{tr("系统中已有相同归档。默认会创建副本，不覆盖原记录。")}</p><Link href={`/conversations/${archivePreview.duplicate_conversation_id}`} className="mt-2 inline-block font-medium text-accent underline">{tr("打开已有对话")}</Link></div> : null}
      {commitResult?.status === "committed" && !pendingImportId ? <ImportCompletionSummary result={commitResult} onClose={() => onImportCommitted?.()} onOpenFirst={(conversationId) => { onImportCommitted?.(); router.push(`/conversations/${conversationId}`); }} /> : null}
    </section>
  );
}

function ImportDestinationPicker({
  projects,
  projectId,
  onChange,
  disabled,
  saving = false,
  unavailable,
  error,
}: {
  projects: Array<{ id: string; name: string; is_default: boolean; is_archived: boolean }>;
  projectId: string | null;
  onChange: (projectId: string | null) => void;
  disabled: boolean;
  saving?: boolean;
  unavailable: boolean;
  error?: unknown;
}) {
  const tr = useImportCopy();
  const activeProjects = projects.filter((project) => !project.is_default && !project.is_archived);
  return (
    <div className="border-y border-ui py-2 text-xs text-secondary" data-testid="import-destination">
      <label htmlFor="import-destination-select" className="mb-1 block font-medium text-primary">{tr("导入位置")}</label>
      <select
        id="import-destination-select"
        data-testid="import-destination-select"
        value={projectId ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        className="min-h-10 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-60"
      >
        <option value="">{tr("未归类")}</option>
        {projectId && !projects.some((project) => project.id === projectId)
          ? <option value={projectId}>{unavailable ? tr("项目不可用") : tr("当前项目")}</option>
          : null}
        {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      {saving ? <p role="status" className="mt-1">{tr("正在保存导入位置…")}</p> : null}
      {unavailable ? <p role="alert" className="mt-1 text-[var(--danger)]">{tr("原项目已不可用，请从有效项目页面重新打开导入。")}</p> : null}
      {error ? <ErrorLine message={error} action="mutation" /> : null}
    </div>
  );
}

function ImportCompletionSummary({
  result,
  onClose,
  onOpenFirst,
}: {
  result: CommitImportResponse;
  onClose: () => void;
  onOpenFirst: (conversationId: string) => void;
}) {
  const tr = useImportCopy();
  const firstConversationId = result.conversation_ids[0] ?? null;
  const multiple = result.conversation_count > 1;
  const visibleIds = result.conversation_ids.slice(0, 8);
  return (
    <div role="status" data-testid="import-completion-summary" className="space-y-3 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4 text-sm text-primary">
      <div>
        <p className="font-semibold text-accent">{tr("导入已完成")}</p>
        <p className="mt-1 text-secondary">{tr("已提交 {0} 个对话，共 {1} 条消息。", result.conversation_count, result.message_count)}</p>
      </div>
      {result.warnings.length ? <div className="border-l-2 border-[var(--warning)] pl-3 text-xs text-secondary">
        <p className="font-medium text-primary">{tr("导入提示")} · {result.warnings.length}</p>
        <ul className="mt-1 list-disc space-y-1 break-words pl-4">{result.warnings.slice(0, 4).map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        {result.warnings.length > 4 ? <details className="mt-2" data-testid="import-remaining-warnings">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{tr("展开其余 {0} 条提示", result.warnings.length - 4)}</summary>
          <ul className="list-disc space-y-1 break-words pl-4">{result.warnings.slice(4).map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </details> : null}
      </div> : null}
      <ImportNoiseReview importId={result.import_id} />
      {visibleIds.length ? <div className="space-y-1"><p className="text-xs font-medium text-secondary">{multiple ? tr("已导入的对话") : tr("已导入对话")}</p><div className="flex flex-wrap gap-x-3 gap-y-1">{visibleIds.map((conversationId, index) => <button key={conversationId} type="button" onClick={() => onOpenFirst(conversationId)} className="text-xs text-accent underline underline-offset-2 hover:text-primary">{tr("打开第 {0} 条", index + 1)}</button>)}</div>{result.conversation_ids.length > visibleIds.length ? <p className="text-xs text-secondary">{tr("另有")}{result.conversation_ids.length - visibleIds.length} {tr("个对话可在资料库中查看。")}</p> : null}</div> : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {multiple ? <Link href="/" onClick={onClose} className="btn-primary min-h-9 px-3 text-sm font-medium">{tr("查看导入的对话")}</Link> : firstConversationId ? <button type="button" onClick={() => onOpenFirst(firstConversationId)} className="btn-primary min-h-9 px-3 text-sm font-medium">{tr("打开对话")}</button> : null}
        {multiple && firstConversationId ? <button type="button" onClick={() => onOpenFirst(firstConversationId)} className="btn-secondary min-h-9 px-3 text-sm font-medium">{tr("打开第一条")}</button> : null}
        <button type="button" onClick={onClose} className="btn-secondary min-h-9 px-3 text-sm font-medium">{tr("关闭")}</button>
      </div>
    </div>
  );
}

function validateFiles(files: File[], mode: ImportMode, tr: ImportCopy): string | null {
  if (!files.length) return null;
  const extensions = files.map((file) => fileExtension(file.name));
  if (mode === "archive") return files.length === 1 && extensions[0] === ".cr" ? null : tr(".cr 归档必须单独导入。");
  if (extensions.includes(".cr")) return tr("请在设置的数据与备份中恢复 .cr 归档。");
  if (files.some((file) => file.name.toLowerCase().endsWith(".context.zip"))) return tr("请打开目标对话，在批注旁的上下文面板中更新 Current / Index。");
  if (files.some((file) => file.name.toLowerCase() === "skill.md")) return tr("这是 Skill 文件，请在设置的 Skill 管理中上传。");
  if (extensions.some((extension) => ![".json", ".jsonl", ".gz", ".md", ".markdown", ".txt", ".html", ".htm"].includes(extension))) return tr("仅支持 JSON、Markdown 或文本源文件。");
  if (files.length > 500) return tr("一次最多分析 500 个文件。");
  return null;
}

function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".canonical.jsonl.gz")) return ".gz";
  if (lower.endsWith(".canonical.jsonl")) return ".jsonl";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function ErrorLine({ message, action = "read", onRetry, retrying = false }: {
  message: unknown;
  action?: "read" | "mutation" | "commit";
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const tr = useImportCopy();
  return (
    <div role="alert" className={`border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)] ${onRetry ? "flex flex-wrap items-center justify-between gap-3" : ""}`}>
      <span>{importErrorMessage(message, tr, action)}</span>
      {onRetry ? <button type="button" disabled={retrying} onClick={onRetry} className="btn-secondary inline-flex min-h-9 shrink-0 items-center gap-2 px-3 text-xs font-medium">
        {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{tr("重试")}
      </button> : null}
    </div>
  );
}
