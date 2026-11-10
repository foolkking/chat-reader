"use client";

import { importErrorMessage, importFailureMessage, importWarningMessage, importStateLabel, useImportCopy, type ImportCopy } from "./import-workspace-copy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, ScanSearch, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { ApiRequestError, cancelAdaptiveImportSession, cancelTask, commitImport, createAdaptiveImportSession, excludeAdaptiveImportSource, getAdaptiveImportSession, getImportStatus, getProjects, previewImport, replaceAdaptiveImportArtifact, resumeAdaptiveImportSession, retryTask, updateAdaptiveImportDestination } from "../../lib/api";
import type { AdaptiveImportSession, CommitImportResponse, ImportDuplicatePolicy, ImportPreviewResponse } from "../../lib/types";
import { readAccountCapabilities } from "../../lib/auth-client";
import { authenticationGeneration } from "../../lib/offline-access";
import { SupportLimitAction } from "../../components/support-limit-action";
import { usePreferences } from "../../components/preferences-provider";
import { ImportPreviewCard } from "./import-preview-card";
import { AdaptiveImportWorkspace } from "./adaptive-import-workspace";
import { FormatConversionGuide } from "./format-conversion-guide";
import { ImportNoiseReview } from "./import-noise-review";
import { createPastedTranscriptFile, pastedTranscriptByteLength } from "./pasted-transcript";
import { getUnfinishedImports } from "../../lib/api";
import { getActiveOfflineStorageContext } from "../../lib/offline-db";
import { measureImportImageLane } from "./image-import-lane";

type ImportMode = "adaptive" | "archive";
type ImportSessionRestoreState = {
  phase: "idle" | "loading" | "error";
  error: unknown | null;
};
type SourceRepairControl = {
  taskId: string | null; state: "uploading" | "unknown"; excludeArtifactId?: string;
  replaceArtifactId?: string; sourceRevision?: number;
};
const ACTIVE_SESSION_KEY = "chat-reader:adaptive-import-session";

function sessionStorageKey(repairProfileId?: string | null): string {
  const userId = getActiveOfflineStorageContext().userId;
  const base = userId ? `${ACTIVE_SESSION_KEY}:account:${userId}` : ACTIVE_SESSION_KEY;
  return repairProfileId ? `${base}:repair:${repairProfileId}` : base;
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
  onMappingStateChange?: (state: { dirty: boolean; busy: boolean; background?: boolean }) => void;
} = {}) {
  const tr = useImportCopy();
  const { resolvedLocale, readerWidthMode, sectionTocMode } = usePreferences();
  const [imageLaneWidth, setImageLaneWidth] = useState<number | null>(null);
  const importLaneSnapshots = useRef(new Map<string, number>());
  useEffect(() => {
    const measure = () => setImageLaneWidth(measureImportImageLane({ readerWidthMode, sectionTocMode }));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [readerWidthMode, sectionTocMode]);
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const current = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  const paneEpoch = useRef(0);
  const mutationOwner = () => ({ epoch: paneEpoch.current, generation: authenticationGeneration() });
  const ownsMutation = (owner: ReturnType<typeof mutationOwner> | undefined) => Boolean(
    current() && owner?.epoch === paneEpoch.current && owner?.generation === authenticationGeneration(),
  );
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
  const savedCommitOptions = session?.analysis_summary?.commit_options as { image_lane_width?: number } | undefined;
  const committedLane = savedCommitOptions?.image_lane_width;
  const shownImageLane = committedLane ?? (session ? importLaneSnapshots.current.get(session.import_id) : undefined) ?? imageLaneWidth;
  const [targetProjectId, setTargetProjectId] = useState<string | null>(initialProjectId);
  const [sessionRestore, setSessionRestore] = useState<ImportSessionRestoreState>({ phase: "idle", error: null });
  const [sessionRestoreRetry, setSessionRestoreRetry] = useState(0);
  const [unfinishedOffset, setUnfinishedOffset] = useState(0);
  const unfinished = useQuery({
    queryKey: ["unfinished-imports", generation.current, unfinishedOffset],
    queryFn: ({ signal }) => getUnfinishedImports(unfinishedOffset, signal),
    enabled: !session && mode === "adaptive",
    retry: false,
  });
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [terminalImportError, setTerminalImportError] = useState<string | null>(null);
  const [terminalImportId, setTerminalImportId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);
  const conversionId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceSelectionRef = useRef(false);
  useEffect(() => {
    const input = fileInputRef.current;
    const cancelSelection = () => { replaceSelectionRef.current = false; };
    input?.addEventListener("cancel", cancelSelection);
    return () => input?.removeEventListener("cancel", cancelSelection);
  }, [mode, inputMethod, session?.import_id]);
  const fileListRef = useRef<HTMLOListElement>(null);
  const nextFileFocus = useRef<number | null>(null);
  const [excludeSourceId, setExcludeSourceId] = useState<string | null>(null);
  const [workspaceEditState, setWorkspaceEditState] = useState({ dirty: false, busy: false });
  const handleMappingStateChange = useCallback((state: { dirty: boolean; busy: boolean; background?: boolean }) => {
    setWorkspaceEditState(previous => previous.dirty === state.dirty && previous.busy === state.busy ? previous : state);
    onMappingStateChange?.(state);
  }, [onMappingStateChange]);
  useEffect(() => {
    if (nextFileFocus.current === null) return;
    const index = Math.min(nextFileFocus.current, files.length - 1);
    const action = fileListRef.current?.children[index]?.querySelector<HTMLButtonElement>("button");
    (action ?? fileInputRef.current)?.focus({ preventScroll: true });
    nextFileFocus.current = null;
  }, [files]);
  const [duplicatePolicy, setDuplicatePolicy] = useState<ImportDuplicatePolicy>("clone");
  const completedImportRef = useRef<string | null>(null);
  const resumeSessionRef = useRef(resumeImportId);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const targetSessionRef = useRef<string | null>(null);
  const activeSessionKey = sessionStorageKey(repairProfileId);
  const [savedImportId, setSavedImportId] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [stopUnconfirmed, setStopUnconfirmed] = useState(false);
  useEffect(() => { setSavedImportId(window.sessionStorage.getItem(activeSessionKey)); }, [activeSessionKey]);
  useEffect(() => {
    setStopUnconfirmed(false);
    if (session?.state !== "CANCELING") return;
    const timer = setTimeout(() => setStopUnconfirmed(true), 30_000);
    return () => clearTimeout(timer);
  }, [session?.import_id, session?.state]);
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
    // A saved pointer is an offer to resume, never an implicit navigation.
    const importId = resumeSessionRef.current;
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

  const analysisTaskId = session?.analysis_task_id ?? null;
  const analysisSessionQuery = useQuery({
    // Replacement/reanalysis keeps the import ID but queues a new task. A
    // recently completed task must not supply this task's terminal cache.
    queryKey: ["adaptive-import-analysis", session?.import_id, generation.current, analysisTaskId],
    queryFn: async ({ signal }) => {
      const value = await getAdaptiveImportSession(session!.import_id, signal);
      return { value, generation: generation.current, analysisTaskId };
    },
    enabled: current() && Boolean(session && ["COLLECTING", "ANALYZING", "CANCELING"].includes(session.state)),
    // Explicit retry can reuse a failed task ID. Re-enabling must read it even
    // within the provider's freshness window; only GETs are repeated here.
    staleTime: 0,
    refetchInterval: query => !query.state.data || ["COLLECTING", "ANALYZING", "CANCELING"].includes(query.state.data.value.state) ? 1500 : false,
    retry: 2,
  });
  useEffect(() => {
    const result = analysisSessionQuery.data;
    if (!result || !current() || result.generation !== authenticationGeneration()
      || result.value.import_id !== session?.import_id || result.analysisTaskId !== analysisTaskId) return;
    setSession(result.value);
    if (!["COLLECTING", "ANALYZING", "CANCELING"].includes(result.value.state)) {
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    }
  }, [analysisSessionQuery.data, analysisTaskId, current, queryClient, session?.import_id]);

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
    onMutate: mutationOwner,
    onSuccess: (result, _files, owner) => {
      if (!ownsMutation(owner)) return;
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
    onMutate: mutationOwner,
    onSuccess: (_result, _id, owner) => {
      if (!ownsMutation(owner)) return;
      window.sessionStorage.removeItem(activeSessionKey);
      setSavedImportId(null);
      reset("adaptive");
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: previewImport,
    onMutate: mutationOwner,
    onSuccess: (result, _files, owner) => { if (ownsMutation(owner)) { setArchivePreview(result); setSession(null); } },
  });
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: ImportDuplicatePolicy }) => {
      const lane = (session?.import_id === importId ? committedLane : undefined)
        ?? importLaneSnapshots.current.get(importId) ?? measureImportImageLane({ readerWidthMode, sectionTocMode });
      importLaneSnapshots.current.set(importId, lane);
      setImageLaneWidth(lane);
      return commitImport(importId, { duplicatePolicy: policy, projectId: targetProjectId, ...(mode === "adaptive" ? { imageLaneWidth: lane } : {}) });
    },
    onMutate: mutationOwner,
    onSuccess: (result, _variables, owner) => {
      if (!ownsMutation(owner)) return;
      setTerminalImportError(null);
      setCommitResult(result);
      if (result.status === "committed") finishCommittedImport(result);
      else if (result.status === "failed" || result.status === "cancelled") finishTerminalImport(result);
      else setPendingImportId(result.import_id);
    },
  });
  const retryImportMutation = useMutation({
    mutationFn: (importId: string) => retryTask(importId),
    onMutate: mutationOwner,
    onSuccess: (task, _id, owner) => {
      if (!ownsMutation(owner)) return;
      setTerminalImportError(null);
      setTerminalImportId(null);
      setCommitResult(null);
      setPendingImportId(task.job_id);
      if (session) {
        void getAdaptiveImportSession(task.job_id).then(next => { if (ownsMutation(owner)) setSession(next); }).catch(() => undefined);
      }
    },
  });
  const retryAnalysisMutation = useMutation({
    mutationFn: (taskId: string) => retryTask(taskId),
    onMutate: mutationOwner,
    onSuccess: (task, _id, owner) => {
      if (!ownsMutation(owner)) return;
      setSession(previous => previous?.analysis_task_id === task.job_id
        ? { ...previous, state: "ANALYZING", phase: "queued", progress: 0, error_message: null, failure: null }
        : previous);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["adaptive-import-analysis", session?.import_id] });
    },
  });
  const destinationMutation = useMutation({
    mutationFn: ({ importId, projectId }: { importId: string; projectId: string | null }) => updateAdaptiveImportDestination(importId, projectId),
    onMutate: mutationOwner,
    onSuccess: (updated, _variables, owner) => {
      if (!ownsMutation(owner)) return;
      setSession(updated);
      setTargetProjectId(updated.target_project_id ?? null);
      targetSessionRef.current = updated.import_id;
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const stopMutation = useMutation({
    mutationFn: (taskId: string) => cancelTask(taskId, undefined, "retain"),
    onMutate: mutationOwner,
    onSuccess: (task, _id, owner) => {
      if (!ownsMutation(owner)) return;
      if (["cancelling", "cancelled"].includes(task.status)) {
        // Reconcile the retained session with GET; do not manufacture a
        // PAUSED revision that could be used for a stale resume.
        setSession(previous => previous?.analysis_task_id === task.job_id ? { ...previous, state: "CANCELING" } : previous);
      }
      void queryClient.invalidateQueries({ queryKey: ["adaptive-import-analysis", session?.import_id] });
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const resumeMutation = useMutation({
    mutationFn: (value: { importId: string; updatedAt: string }) => resumeAdaptiveImportSession(value.importId, value.updatedAt),
    onMutate: mutationOwner,
    onSuccess: (next, _value, owner) => {
      if (!ownsMutation(owner)) return;
      setSession(next);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const sourceRepairKey = useMemo(() => ["import-source-repair", generation.current, session?.import_id] as const, [session?.import_id]);
  const sourceRepairControlQuery = useQuery<SourceRepairControl | null>({
    queryKey: sourceRepairKey, queryFn: async () => null, enabled: false,
    initialData: null, gcTime: Infinity, staleTime: Infinity,
  });
  const sourceRepairControl = sourceRepairControlQuery.data;
  const sourceRepairMutation = useMutation({
    mutationFn: (value: { importId: string; artifactId: string; file?: File; updatedAt: string; taskId: string | null; sourceRevision?: number }) =>
      value.file ? replaceAdaptiveImportArtifact(value.importId, value.artifactId, value.file, value.updatedAt)
        : excludeAdaptiveImportSource(value.importId, value.artifactId, value.updatedAt),
    onMutate: mutationOwner,
    onSuccess: (next, value, owner) => {
      // Cache acknowledgement may outlive this pane, never its account.
      if (owner?.generation === authenticationGeneration()) {
        queryClient.setQueryData(["import-source-repair", owner.generation, value.importId], null);
        // A pane reopened during this request must receive the acknowledgement,
        // not merely lose its lock while still displaying the old revision.
        queryClient.setQueryData(["adaptive-import-analysis", value.importId, owner.generation, value.taskId],
          { value: next, generation: owner.generation, analysisTaskId: value.taskId });
      }
      if (!ownsMutation(owner)) return;
      setExcludeSourceId(null);
      setSession(next);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
    onError: (error, value, owner) => {
      if (owner?.generation !== authenticationGeneration()) return;
      // Only an explicit rejection proves that choosing another source is safe.
      const rejected = error instanceof ApiRequestError && error.status >= 400 && error.status < 500
        && ![408, 429].includes(error.status);
      queryClient.setQueryData<SourceRepairControl | null>(["import-source-repair", owner.generation, value.importId],
        (): SourceRepairControl | null => rejected ? null : { taskId: value.taskId, state: "unknown",
          ...(!value.file ? { excludeArtifactId: value.artifactId }
            : { replaceArtifactId: value.artifactId, sourceRevision: value.sourceRevision }) });
    },
  });
  const sourceRepairUnknown = Boolean(sourceRepairControl && !sourceRepairMutation.isPending);
  useEffect(() => {
    if (!current() || !session || !sourceRepairControl) return;
    const excluded = sourceRepairControl.excludeArtifactId && session.sources
      && !session.sources.some(source => source.artifact_id === sourceRepairControl.excludeArtifactId);
    const replaced = sourceRepairControl.replaceArtifactId && sourceRepairControl.sourceRevision !== undefined
      && session.sources?.some(source => source.artifact_id === sourceRepairControl.replaceArtifactId
        && (source.source_revision ?? 0) > sourceRepairControl.sourceRevision!);
    if (!excluded && !replaced && (session.analysis_task_id ?? null) === sourceRepairControl.taskId) return;
    queryClient.setQueryData(sourceRepairKey, null);
    setExcludeSourceId(null);
    sourceRepairMutation.reset();
  }, [current, session, sourceRepairControl, queryClient, sourceRepairKey, sourceRepairMutation.reset]);
  useEffect(() => {
    const result = analysisSessionQuery.data;
    if (!result || !current() || result.generation !== authenticationGeneration()
      || result.value.import_id !== session?.import_id || result.analysisTaskId !== analysisTaskId) return;
    const state = result.value.state;
    if (stopMutation.isError && ["PAUSED", "CANCELED", "COMPLETED"].includes(state)) stopMutation.reset();
    if (resumeMutation.isError && state !== "PAUSED") resumeMutation.reset();
    if (cancelMutation.isError && state === "CANCELED") cancelMutation.reset();
    if (retryAnalysisMutation.isError && ["ANALYZING", "READY", "RESOLVING"].includes(state)) retryAnalysisMutation.reset();
  }, [analysisSessionQuery.data, analysisTaskId, current, session?.import_id, stopMutation.isError, stopMutation.reset,
    resumeMutation.isError, resumeMutation.reset, cancelMutation.isError, cancelMutation.reset, retryAnalysisMutation.isError, retryAnalysisMutation.reset]);
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
    if (files.some(file => file.size === 0)) return zh ? "文件为空，请替换或移出待选列表。" : "This file is empty. Replace it or remove it from the selection.";
    const totalLimit = capabilities.data?.maximum_import_total_mb;
    if (totalLimit != null && files.reduce((bytes, file) => bytes + file.size, 0) > totalLimit * 1024 * 1024) return tr("本批文件合计不能超过 {0} MiB，请分批导入。", totalLimit);
    return validateFiles(files, mode, tr);
  }, [activeFileBytes, activeTotalBytes, files, inputMethod, mode, pastedText, capabilities.data, tr, zh]);
  const selectedFileErrors = useMemo(() => files.map(file => validateFiles([file], mode, tr)
    ?? (file.size === 0 ? (zh ? "文件为空，请替换或移出待选列表。" : "This file is empty. Replace it or remove it from the selection.") : null)
    ?? (capabilities.data && file.size > capabilities.data.maximum_import_size_mb * 1024 * 1024
      ? tr("单个文件不能超过当前上限 {0} MiB。", capabilities.data.maximum_import_size_mb) : null)), [files, mode, tr, capabilities.data, zh]);
  const targetProject = projects.data?.find((project) => project.id === targetProjectId);
  const destinationUnavailable = Boolean(targetProjectId && projects.isSuccess && !targetProject);

  function reset(nextMode = mode) {
    paneEpoch.current++;
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
    setDiscardConfirm(false);
    setExcludeSourceId(null);
    setWorkspaceEditState({ dirty: false, busy: false });
    setDuplicatePolicy("clone");
    completedImportRef.current = null;
    adaptiveMutation.reset();
    archiveMutation.reset();
    commitMutation.reset();
    retryImportMutation.reset();
    retryAnalysisMutation.reset();
    cancelMutation.reset();
    stopMutation.reset();
    resumeMutation.reset();
    sourceRepairMutation.reset();
    onMappingStateChange?.({ dirty: false, busy: false });
  }

  function leaveRetainedSession() {
    setSavedImportId(session?.import_id ?? null);
    reset("adaptive");
    setSessionRestoreRetry(attempt => attempt + 1);
    void queryClient.invalidateQueries({ queryKey: ["unfinished-imports"] });
  }

  function chooseFiles(nextFiles: File[], nextMode = mode) {
    if (busy) return;
    window.sessionStorage.removeItem(activeSessionKey);
    setSavedImportId(null);
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
    if (nextFiles.length) chooseFiles(mode === "adaptive" ? [...files, ...nextFiles] : nextFiles);
  }

  if (session) {
    const analysisPending = ["COLLECTING", "ANALYZING", "CANCELING"].includes(session.state);
    const analysisFailed = session.state === "FAILED" && session.phase === "analysis_failed";
    const repairBusy = sourceRepairMutation.isPending || Boolean(sourceRepairControl);
    const repairDisabled = repairBusy || resumeMutation.isPending || resumeMutation.isError
      || retryAnalysisMutation.isPending || retryAnalysisMutation.isError || destinationMutation.isPending
      || workspaceEditState.dirty || workspaceEditState.busy || commitMutation.isPending || Boolean(pendingImportId)
      || !session.updated_at;
    const canRepairSources = ["FAILED", "PAUSED", "READY", "RESOLVING", "NEEDS_GROUPING", "BLOCKED"].includes(session.state)
      && !["queued", "processing", "committed"].includes(session.status ?? "");
    const changeSource = (artifactId: string, file?: File) => {
      if (repairDisabled || !session.updated_at || !current() || queryClient.getQueryData(sourceRepairKey)) return;
      const sourceRevision = session.sources?.find(source => source.artifact_id === artifactId)?.source_revision;
      queryClient.setQueryData<SourceRepairControl>(sourceRepairKey, {
        taskId: session.analysis_task_id ?? null, state: "uploading", ...(!file ? { excludeArtifactId: artifactId }
          : { replaceArtifactId: artifactId, sourceRevision }),
      });
      sourceRepairMutation.mutate({ importId: session.import_id, artifactId, file,
        updatedAt: session.updated_at, taskId: session.analysis_task_id ?? null, sourceRevision });
    };
    const sourceActions = canRepairSources && session.sources?.length ? <div data-testid="import-source-actions" className="divide-y divide-[var(--border)] border-y border-ui">
      {session.sources.map((source, index) => <div key={source.artifact_id} className="space-y-2 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words text-sm text-primary"><span className="mr-2 tabular-nums text-secondary">{index + 1}.</span>{source.filename}</span>
          <label className={`btn-secondary relative inline-flex min-h-11 items-center px-3 text-sm ${repairDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer focus-within:ring-2 focus-within:ring-[var(--focus)]"}`}>
            {zh ? "替换来源" : "Replace source"}
            <input type="file" className="sr-only" accept=".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm,.zip"
              aria-label={zh ? `替换来源：${source.filename}` : `Replace source: ${source.filename}`} disabled={repairDisabled}
              onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) changeSource(source.artifact_id, file); }} />
          </label>
          {session.sources!.length > 1 ? <button type="button" disabled={repairDisabled}
            aria-label={zh ? `移出本次导入：${source.filename}` : `Exclude from this import: ${source.filename}`}
            className="min-h-11 px-3 text-sm text-secondary hover:text-primary disabled:opacity-50"
            onClick={() => setExcludeSourceId(source.artifact_id)}>{zh ? "移出…" : "Exclude…"}</button> : null}
        </div>
        {excludeSourceId === source.artifact_id ? <div className="space-y-2 border-l-2 border-[var(--color-semantic-warning)] pl-3 text-sm">
          <p>{zh ? "将整份来源及其中的对话移出本次导入，本机原文件不变。其余来源会重新检查，之后仍需确认导入。"
            : "Exclude this entire source and its conversations from this import. Your local file is unchanged. Remaining sources will be checked again and still require confirmation."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={repairDisabled} className="btn-secondary min-h-11 px-3" onClick={() => changeSource(source.artifact_id)}>{zh ? "确认移出" : "Confirm exclusion"}</button>
            <button type="button" disabled={repairBusy} className="min-h-11 px-3 text-secondary" onClick={() => setExcludeSourceId(null)}>{zh ? "保留来源" : "Keep source"}</button>
          </div>
        </div> : null}
      </div>)}
      <p className="py-2 text-xs text-secondary">{zh ? "只调整选中的来源，其他文件保留；重新分析后仍需审阅并确认导入。" : "Only the selected source changes. Other files remain; review and confirm after analysis."}</p>
    </div> : null;
    const sourceFeedback = <>
      {sourceRepairMutation.isPending ? <p role="status" className="text-sm text-secondary">{sourceRepairControl?.excludeArtifactId
        ? (zh ? "正在提交移出请求…" : "Requesting source exclusion…")
        : (zh ? "正在上传替换来源…" : "Uploading replacement source…")}</p> : null}
      {sourceRepairUnknown ? <div role="status" className="space-y-2 border-l-2 border-[var(--color-semantic-warning)] pl-3 text-sm">
        <p>{sourceRepairControl?.excludeArtifactId
          ? (zh ? "移出结果尚未确认。请核对状态，不要重复提交。" : "The exclusion result is unconfirmed. Check its status before submitting again.")
          : (zh ? "替换结果尚未确认。请核对状态，不要重复上传；其他文件仍保留。" : "The replacement result is unconfirmed. Check its status before uploading again; other files remain.")}</p>
        <button type="button" className="btn-secondary min-h-11 px-3" disabled={analysisSessionQuery.isFetching} onClick={() => { void analysisSessionQuery.refetch(); }}>{tr("核对状态")}</button>
      </div> : sourceRepairMutation.error ? <div className="space-y-2">
        <ErrorLine message={sourceRepairMutation.error} />
        <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={analysisSessionQuery.isFetching}
          onClick={() => { void analysisSessionQuery.refetch(); }}>{tr("刷新会话状态")}</button>
      </div> : null}
    </>;
    const failure = typeof session.analysis_summary?.failure === "object" && session.analysis_summary.failure !== null
      ? session.analysis_summary.failure as Record<string, unknown>
      : null;
    const failureMessage = importFailureMessage(
      session.failure ?? failure, session.error_message, "analysis", zh,
    );
    if (analysisPending || analysisFailed || session.state === "CANCELED" || session.state === "PAUSED") {
      return (
        <section className="space-y-4" aria-labelledby="import-analysis-title" data-testid="import-analysis-status">
          <ImportDestinationPicker
            projects={projects.data ?? []}
            projectId={targetProjectId}
            onChange={(projectId) => destinationMutation.mutate({ importId: session.import_id, projectId })}
            disabled={repairBusy || destinationMutation.isPending || session.state === "CANCELING" || session.state === "CANCELED"}
            saving={destinationMutation.isPending}
            unavailable={destinationUnavailable}
            error={destinationMutation.error}
          />
          <h3 id="import-analysis-title" className="text-lg font-semibold text-primary">
            {session.state === "PAUSED" ? tr("分析已停止，来源与设置已保留") : session.phase === "waiting_resources" ? (zh ? "正在等待可用资源" : "Waiting for available resources") : tr(analysisFailed ? "导入分析未完成" : session.state === "CANCELED" ? "导入分析已取消" : session.state === "CANCELING" ? "正在停止导入分析" : session.phase === "queued" ? "已加入后台分析队列" : "正在后台分析文件")}
          </h3>
          <p className="text-sm leading-6 text-secondary">{session.state === "CANCELED"
            ? tr("本次临时来源已移除，尚未导入对话。你可以重新选择文件。")
            : tr("这批 {0} 个文件已保存在服务器。你可以关闭此窗口继续阅读，在任务中心查看进度和结果。", session.file_count)}</p>
          {session.phase === "waiting_resources" ? <p role="status" className="text-sm leading-6 text-secondary">{zh
            ? "当前资源不足以开始下一步，系统会自动间隔检查，累计等待最多 30 分钟。原文件和已完成处理保留，无需重新上传；可以关闭窗口继续阅读。"
            : "Resources are insufficient for the next step. Checks resume automatically for up to 30 minutes of total waiting. Sources and completed work are retained. You can close this window and keep reading."}</p> : null}
          {analysisPending ? <div role="progressbar" aria-label={tr("导入分析")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, session.progress ?? 0))} className="h-1 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, session.progress ?? 0))}%` }} />
          </div> : null}
          {analysisPending && session.analysis_progress ? <p role="status" className="text-xs tabular-nums text-secondary">
            {({
              archives: zh ? "检查 ZIP" : "Checking ZIP",
              recognition: zh ? "识别格式" : "Recognizing format",
              validation: zh ? "验证内容" : "Validating content",
              draft: zh ? "生成预览" : "Building preview",
            })[session.analysis_progress.stage]} · {session.analysis_progress.unit_index}/{session.analysis_progress.unit_total}
            {zh ? " 个处理单元，按选择顺序逐个处理" : " units, processed in selection order"}
          </p> : null}
          {analysisFailed ? <p role="alert" className="text-sm text-[var(--danger)]">{failureMessage
            ?? tr("首轮分析失败，尚未导入对话。源文件仍保留，可在任务中心重试或重新选择文件。")}</p> : null}
          {sourceActions}
          {sourceFeedback}
          {analysisSessionQuery.error ? <ErrorLine message={analysisSessionQuery.error} onRetry={() => { void analysisSessionQuery.refetch(); }} retrying={analysisSessionQuery.isFetching} /> : null}
          {stopUnconfirmed || stopMutation.error || resumeMutation.error || cancelMutation.error || retryAnalysisMutation.error ? <div role="status" className="space-y-2 border-l-2 border-[var(--warning)] pl-3 text-sm text-secondary">
            <p>{tr(stopUnconfirmed ? "停止尚未确认，不代表已经结束。可以核对状态，或先离开处理其他文件；原任务不会被重复提交。" : "操作结果需要核对。请先读取原任务状态，不要重复提交；来源不会因关闭窗口而删除。")}</p>
            <button type="button" className="btn-secondary min-h-11 px-3" disabled={analysisSessionQuery.isFetching} onClick={() => { void analysisSessionQuery.refetch(); }}>{tr("核对状态")}</button>
          </div> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11 px-4 text-sm" onClick={() => { onImportCommitted?.(); window.dispatchEvent(new Event("chat-reader:open-task-center")); }}>{tr("查看后台任务")}</button>
            {analysisFailed && session.analysis_task_id ? <button type="button" disabled={repairBusy || retryAnalysisMutation.isPending || retryAnalysisMutation.isError} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => { if (!queryClient.getQueryData(sourceRepairKey)) retryAnalysisMutation.mutate(session.analysis_task_id!); }}>{tr(retryAnalysisMutation.isPending ? "正在提交重试…" : "重试分析")}</button> : null}
            {session.state === "PAUSED" ? <button type="button" disabled={repairBusy || resumeMutation.isPending || resumeMutation.isError || session.source_status === "missing" || !session.updated_at} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => { if (session.updated_at && !queryClient.getQueryData(sourceRepairKey)) resumeMutation.mutate({ importId: session.import_id, updatedAt: session.updated_at }); }}>{tr(resumeMutation.isPending ? "正在提交…" : "继续分析")}</button> : null}
            {analysisPending && session.state !== "CANCELING" && session.analysis_task_id ? <button type="button" disabled={stopMutation.isPending || stopMutation.isError} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => stopMutation.mutate(session.analysis_task_id!)}>{tr(stopMutation.isPending ? "正在请求停止…" : "停止并保留")}</button> : null}
            <button type="button" className="btn-secondary min-h-11 px-4 text-sm" onClick={leaveRetainedSession}>{tr("返回文件选择")}</button>
            {!analysisPending && session.state !== "CANCELED" ? <button type="button" disabled={repairBusy} className="min-h-11 px-3 text-sm text-secondary" onClick={() => setDiscardConfirm(true)}>{tr("放弃本次导入…")}</button> : null}
          </div>
          {discardConfirm ? <div className="space-y-2 border-l-2 border-[var(--danger)] pl-3 text-sm">
            <p>{tr("放弃将删除本次暂存来源和导入草稿。已导入的其他对话不会改变。")}</p>
            <div className="flex gap-2"><button type="button" className="btn-secondary min-h-11 px-3 text-[var(--danger)]" disabled={cancelMutation.isPending || cancelMutation.isError} onClick={() => cancelMutation.mutate(session.import_id)}>{tr("确认放弃")}</button>
              <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => setDiscardConfirm(false)}>{tr("保留")}</button></div>
          </div> : null}
        </section>
      );
    }
    return (
      <section className="space-y-4">
        <ImportDestinationPicker
          projects={projects.data ?? []}
          projectId={targetProjectId}
          onChange={(projectId) => destinationMutation.mutate({ importId: session.import_id, projectId })}
          disabled={repairBusy || destinationMutation.isPending || commitMutation.isPending || Boolean(pendingImportId)}
          saving={destinationMutation.isPending}
          unavailable={destinationUnavailable}
          error={destinationMutation.error}
        />
        <p className="text-xs text-secondary">{zh
          ? `新图片默认适应 ${shownImageLane ?? "…"}px 阅读栏；确认导入时记录一次，原图保留。无法安全转换时会提示。`
          : `New images fit the ${shownImageLane ?? "…"}px reading column once on import. Originals are kept; unsupported conversions are reported.`}</p>
        {sourceActions ? <details open={repairBusy || excludeSourceId !== null ? true : undefined}>
          <summary className="min-h-11 cursor-pointer content-center text-sm text-secondary">{zh ? `调整来源文件（${session.sources!.length}）` : `Adjust source files (${session.sources!.length})`}</summary>
          {sourceActions}
        </details> : null}
        {sourceFeedback}
        {sourceRepairUnknown && analysisSessionQuery.error ? <ErrorLine message={analysisSessionQuery.error} /> : null}
        <AdaptiveImportWorkspace
          onMappingStateChange={handleMappingStateChange}
          session={session}
          onSession={setSession}
          onBack={leaveRetainedSession}
          onImport={() => commitMutation.mutate({ importId: session.import_id, policy: duplicatePolicy })}
          importing={repairBusy || commitMutation.isPending || Boolean(pendingImportId)}
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
      {mode === "adaptive" && (!unfinished.isSuccess || Boolean(unfinished.data?.items?.length) || unfinishedOffset > 0) ? <section className="space-y-2 border-b border-ui pb-3" aria-label={zh ? "待完成导入" : "Unfinished imports"}>
        <h3 className="text-sm font-semibold text-primary">{zh ? "待完成导入" : "Unfinished imports"}</h3>
        {unfinished.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取…" : "Loading…"}</p> : unfinished.error ? <ErrorLine message={unfinished.error} onRetry={() => void unfinished.refetch()} /> : unfinished.data?.items?.length ? <ul className="divide-y divide-[var(--border)]">{unfinished.data.items.map(item => <li key={item.import_id} data-import-session-id={item.import_id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1"><p className="truncate text-sm text-primary">{item.title}</p><p className="text-xs text-secondary">{importStateLabel(item.state, zh)} · <time dateTime={item.updated_at} title={new Date(item.updated_at).toLocaleString(zh ? "zh-CN" : "en-US")}>{new Date(item.updated_at).toLocaleString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</time>{!item.source_available ? (zh ? " · 源文件不可用；仍可查看已保存配置" : " · Source unavailable; saved configuration is readable") : item.draft_status === "expired" ? (zh ? " · 原文件仍保留，预览已过期" : " · Source retained; preview expired") : ""}</p></div>
          <button type="button" disabled={sessionRestore.phase === "loading"} className="btn-secondary min-h-11 px-3 text-sm disabled:opacity-50" onClick={() => { resumeSessionRef.current = item.import_id; setSessionRestoreRetry(value => value + 1); }}>{zh ? "继续处理" : "Resume"}</button>
        </li>)}</ul> : <p className="text-sm text-secondary">{zh ? "没有待完成的导入。" : "No unfinished imports."}</p>}
        <div className="flex gap-3">{unfinishedOffset > 0 ? <button type="button" className="min-h-11 min-w-11 text-sm text-accent" onClick={() => setUnfinishedOffset(value => Math.max(0, value - 20))}>{zh ? "上一页" : "Previous"}</button> : null}{unfinished.data?.has_more ? <button type="button" className="min-h-11 min-w-11 text-sm text-accent" onClick={() => setUnfinishedOffset(value => value + 20)}>{zh ? "下一页" : "Next"}</button> : null}</div>
      </section> : null}
      {savedImportId && !unfinished.data?.items?.some(item => item.import_id === savedImportId) ? <button type="button" disabled={sessionRestore.phase === "loading"} className="min-h-11 text-sm text-accent underline" onClick={() => {
        resumeSessionRef.current = savedImportId; setSessionRestoreRetry(attempt => attempt + 1);
      }}>{tr("查看上次保留的导入")}</button> : null}
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
        <button type="button" disabled={busy} aria-pressed={inputMethod === "files"} className={inputMethod === "files" ? "btn-primary min-h-11 px-3 text-sm" : "btn-secondary min-h-11 px-3 text-sm"} onClick={() => setInputMethod("files")}>{tr("选择文件")}</button>
        <button type="button" disabled={busy} aria-pressed={inputMethod === "paste"} className={inputMethod === "paste" ? "btn-primary min-h-11 px-3 text-sm" : "btn-secondary min-h-11 px-3 text-sm"} onClick={() => setInputMethod("paste")}>{tr("粘贴文本")}</button>
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
        className={`border border-dashed text-center transition-colors ${conversionOpen || files.length ? "px-4 py-3" : "px-6 py-8"} ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui bg-subtle"}`}
      >
        {!conversionOpen && !files.length ? <><UploadCloud className="mx-auto h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-primary">{tr("拖放文件到这里")}</p>
        <p className="my-2 text-xs text-secondary">{tr("或")}</p></> : null}
        <label className={`btn-secondary inline-flex min-h-11 focus-within:ring-2 focus-within:ring-[var(--focus)] items-center justify-center px-4 text-sm font-medium ${busy ? "cursor-wait opacity-50" : "cursor-pointer"}`}>
          {mode === "adaptive" ? (files.length ? (zh ? "添加文件" : "Add files") : tr("选择 JSON / Markdown / ZIP 文件")) : tr("选择 .cr 归档")}
          <input ref={fileInputRef} disabled={busy} data-dialog-initial-focus="true" key={mode} type="file" data-testid="import-file-input" multiple={mode === "adaptive"} className="sr-only" accept={mode === "adaptive" ? ".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm,.zip" : ".cr"} onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
            const replace = replaceSelectionRef.current; replaceSelectionRef.current = false;
            if (selected.length) chooseFiles(mode === "adaptive" && !replace ? [...files, ...selected] : selected);
          }} />
        </label>
        {files.length ? <p className="mt-3 break-all text-sm text-secondary">{inputMethod === "files" ? selectedLabel : tr("已保留 {0} 个文件选项", files.length)}</p> : null}
      </div>}
      {inputMethod === "files" && files.length ? <ol ref={fileListRef} className="divide-y divide-[var(--border)] border-y border-ui" aria-label={zh ? "待分析文件，按显示顺序处理" : "Selected files, analyzed in this order"} data-testid="import-selected-files">
        {files.map((file, index) => {
          const issue = selectedFileErrors[index];
          return <li key={`${index}-${file.name}`} className="py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-5 shrink-0 text-xs tabular-nums text-secondary">{index + 1}.</span>
              <div className="min-w-0 flex-1"><p className="break-words text-sm text-primary">{file.name}</p>
                <p className="text-xs tabular-nums text-secondary">{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KiB` : `${(file.size / (1024 * 1024)).toFixed(1)} MiB`}</p></div>
              <label className={`inline-flex min-h-11 items-center px-2 text-sm text-secondary ${busy ? "opacity-50" : "cursor-pointer hover:text-primary focus-within:ring-2 focus-within:ring-[var(--focus)]"}`}>
                {zh ? "替换" : "Replace"}
                <input type="file" disabled={busy} className="sr-only"
                  aria-label={zh ? `替换文件：${file.name}` : `Replace file: ${file.name}`}
                  accept={mode === "adaptive" ? ".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm,.zip" : ".cr"}
                  onChange={event => {
                    const replacement = event.currentTarget.files?.[0]; event.currentTarget.value = "";
                    if (replacement && !busy) { nextFileFocus.current = index; chooseFiles(files.map((old, offset) => offset === index ? replacement : old)); }
                  }} />
              </label>
              <button type="button" disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50"
                title={zh ? "移出待选列表" : "Remove from selection"} aria-label={zh ? `移除文件：${file.name}` : `Remove file: ${file.name}`}
                onClick={() => { if (!busy) { nextFileFocus.current = index; chooseFiles(files.filter((_file, offset) => offset !== index)); } }}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {issue ? <p role="alert" className="pl-7 text-xs text-[var(--danger)]">{issue}</p> : null}
          </li>;
        })}
        {mode === "adaptive" && files.length > 1 ? <li className="py-2 text-xs text-secondary">{zh ? "按上方顺序逐个分析；审阅整批后再确认导入。" : "Analyzed in the order above; review the whole batch before confirming import."}</li> : null}
      </ol> : null}
      {validationError && (inputMethod !== "files" || !selectedFileErrors.includes(validationError)) ? <ErrorLine message={validationError} /> : null}
      {capabilities.data ? <SupportLimitAction capabilities={capabilities.data} limit="import_size_mb" active={Boolean(fileOverLimit || !capabilities.data.allow_user_import)} requestedValue={largestFileMiB} returnFocus={() => previewButtonRef.current} onReturn={() => { void capabilities.refetch(); }} /> : null}
      {capabilities.data ? <p className="text-xs text-secondary">{tr("当前单文件上限：")}{capabilities.data.maximum_import_size_mb} MiB</p> : capabilities.isError ? <div role="alert" className="text-sm text-secondary">{tr("无法读取导入限制。")}<button type="button" className="btn-secondary ml-2 min-h-11 px-3" onClick={() => void capabilities.refetch()}>{tr("重试")}</button></div> : <p role="status" className="text-sm text-secondary">{tr("正在读取导入限制…")}</p>}
      {adaptiveMutation.isError ? <ErrorLine message={adaptiveMutation.error} action="mutation" /> : null}
      {archiveMutation.isError ? <ErrorLine message={archiveMutation.error} action="mutation" /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error} action="commit" /> : null}
      {(retryImportMutation.error || terminalImportError) ? <ErrorLine message={retryImportMutation.error ?? terminalImportError} action="commit" onRetry={terminalImportId ? () => retryImportMutation.mutate(terminalImportId) : undefined} retrying={retryImportMutation.isPending} /> : null}
      {importStatusQuery.error ? <ErrorLine message={importStatusQuery.error} onRetry={() => { void importStatusQuery.refetch(); }} retrying={importStatusQuery.isFetching} /> : null}
      {showConversion ? <div className="border-y border-ui">
        <button type="button" disabled={busy} aria-expanded={conversionOpen} aria-controls={conversionId} onClick={() => setConversionOpen(open => !open)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm text-secondary hover:text-primary disabled:opacity-50">{tr("格式不支持？")}<ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${conversionOpen ? "rotate-180" : ""}`} aria-hidden="true" /></button>
        {conversionOpen ? <div id={conversionId} className="pb-4 pt-2"><FormatConversionGuide resultAction={<button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => { replaceSelectionRef.current = true; fileInputRef.current?.click(); }}>{files.length > 1 ? tr("重新选择本批文件") : tr("选择转换后的文件")}</button>} /></div> : null}
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
        <p className="font-semibold text-accent">{tr(result.warnings.some(warning => /^ZIP missing attachments: \d+\./.test(warning)) ? "已导入，部分附件缺失" : "导入已完成")}</p>
        <p className="mt-1 text-secondary">{tr("已提交 {0} 个对话，共 {1} 条消息。", result.conversation_count, result.message_count)}</p>
      </div>
      {result.warnings.length ? <div className="border-l-2 border-[var(--warning)] pl-3 text-xs text-secondary">
        <p className="font-medium text-primary">{tr("导入提示")} · {result.warnings.length}</p>
        <ul className="mt-1 list-disc space-y-1 break-words pl-4">{result.warnings.slice(0, 4).map((warning, index) => <li key={index}>{importWarningMessage(warning, tr)}</li>)}</ul>
        {result.warnings.length > 4 ? <details className="mt-2" data-testid="import-remaining-warnings">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{tr("展开其余 {0} 条提示", result.warnings.length - 4)}</summary>
          <ul className="list-disc space-y-1 break-words pl-4">{result.warnings.slice(4).map((warning, index) => <li key={index}>{importWarningMessage(warning, tr)}</li>)}</ul>
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
  if (extensions.some((extension) => ![".json", ".jsonl", ".gz", ".md", ".markdown", ".txt", ".html", ".htm", ".zip"].includes(extension))) return tr("仅支持 JSON、Markdown、ZIP 或文本源文件。");
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
