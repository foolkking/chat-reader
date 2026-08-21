"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileJson2, LoaderCircle, ScanSearch, UploadCloud, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { cancelAdaptiveImportSession, commitImport, createAdaptiveImportSession, getAdaptiveImportSession, getImportStatus, previewImport } from "../../lib/api";
import type { AdaptiveImportSession, CommitImportResponse, ImportDuplicatePolicy, ImportPreviewResponse } from "../../lib/types";
import { ImportPreviewCard } from "./import-preview-card";
import { AdaptiveImportWorkspace } from "./adaptive-import-workspace";

type ImportMode = "adaptive" | "archive";
const ACTIVE_SESSION_KEY = "chat-reader:adaptive-import-session";

function sessionStorageKey(repairProfileId?: string | null): string {
  return repairProfileId ? `${ACTIVE_SESSION_KEY}:repair:${repairProfileId}` : ACTIVE_SESSION_KEY;
}

export function ImportPanel({
  repairProfileId,
  onImportCommitted,
  onWorkspaceChange,
}: {
  repairProfileId?: string | null;
  onImportCommitted?: () => void;
  onWorkspaceChange?: (open: boolean) => void;
} = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>("adaptive");
  const [files, setFiles] = useState<File[]>([]);
  const [archivePreview, setArchivePreview] = useState<ImportPreviewResponse | null>(null);
  const [session, setSession] = useState<AdaptiveImportSession | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<ImportDuplicatePolicy>("clone");
  const navigatedImportRef = useRef<string | null>(null);
  const activeSessionKey = sessionStorageKey(repairProfileId);

  useEffect(() => onWorkspaceChange?.(Boolean(session)), [onWorkspaceChange, session]);
  useEffect(() => {
    const importId = window.sessionStorage.getItem(activeSessionKey);
    if (!importId || session) return;
    void getAdaptiveImportSession(importId)
      .then((restored) => {
        if (["COMPLETED", "CANCELED", "FAILED"].includes(restored.state)) {
          window.sessionStorage.removeItem(activeSessionKey);
          return;
        }
        setSession(restored);
      })
      .catch(() => window.sessionStorage.removeItem(activeSessionKey));
  }, [activeSessionKey, session]);

  const finishCommittedImport = useCallback((result: CommitImportResponse) => {
    if (navigatedImportRef.current === result.import_id) return;
    navigatedImportRef.current = result.import_id;
    window.sessionStorage.removeItem(activeSessionKey);
    setPendingImportId(null);
    setCommitResult(result);
    void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    const conversationId = result.conversation_ids[0];
    if (!conversationId) return;
    onImportCommitted?.();
    router.push(`/conversations/${conversationId}`);
  }, [activeSessionKey, onImportCommitted, queryClient, router]);

  const importStatusQuery = useQuery({
    queryKey: ["import-status", pendingImportId],
    queryFn: () => getImportStatus(pendingImportId!),
    enabled: Boolean(pendingImportId),
    refetchInterval: (query) => ["queued", "processing"].includes(query.state.data?.status ?? "") ? 1200 : false,
  });
  useEffect(() => {
    if (importStatusQuery.data?.status === "committed") finishCommittedImport(importStatusQuery.data);
  }, [finishCommittedImport, importStatusQuery.data]);

  const adaptiveMutation = useMutation({
    mutationFn: (selectedFiles: File[]) => createAdaptiveImportSession(selectedFiles, repairProfileId),
    onSuccess: (result) => {
      window.sessionStorage.setItem(activeSessionKey, result.import_id);
      setSession(result);
      setArchivePreview(null);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelAdaptiveImportSession,
    onSuccess: () => {
      window.sessionStorage.removeItem(activeSessionKey);
      reset("adaptive");
    },
  });
  const archiveMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => { setArchivePreview(result); setSession(null); },
  });
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: ImportDuplicatePolicy }) => commitImport(importId, { duplicatePolicy: policy }),
    onSuccess: (result) => {
      setCommitResult(result);
      if (result.status === "committed") finishCommittedImport(result);
      else setPendingImportId(result.import_id);
    },
  });

  const validationError = useMemo(() => validateFiles(files, mode), [files, mode]);

  function reset(nextMode = mode) {
    setMode(nextMode);
    setFiles([]);
    setArchivePreview(null);
    setSession(null);
    setPendingImportId(null);
    setCommitResult(null);
    setDuplicatePolicy("clone");
    navigatedImportRef.current = null;
    adaptiveMutation.reset();
    archiveMutation.reset();
    commitMutation.reset();
  }

  function chooseFiles(nextFiles: File[], nextMode = mode) {
    reset(nextMode);
    setFiles(nextFiles);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const nextFiles = Array.from(event.dataTransfer.files);
    chooseFiles(nextFiles, nextFiles.length === 1 && fileExtension(nextFiles[0]?.name ?? "") === ".cr" ? "archive" : "adaptive");
  }

  if (session) {
    return (
      <AdaptiveImportWorkspace
        session={session}
        onSession={setSession}
        onBack={() => cancelMutation.mutate(session.import_id)}
        onImport={() => commitMutation.mutate({ importId: session.import_id, policy: duplicatePolicy })}
        importing={commitMutation.isPending || Boolean(pendingImportId)}
        error={cancelMutation.error?.message ?? commitMutation.error?.message ?? importStatusQuery.data?.error_message ?? null}
      />
    );
  }

  const busy = adaptiveMutation.isPending || archiveMutation.isPending;
  const selectedLabel = files.length === 0 ? "尚未选择文件" : files.length === 1 ? files[0]?.name : `已选择 ${files.length} 个文件`;
  const archiveCanCommit = Boolean(archivePreview?.can_commit ?? archivePreview?.archive_summary);

  return (
    <section className="space-y-5">
      <p className="text-sm leading-6 text-secondary">{repairProfileId ? "选择一组采用该格式的代表性源文件。验证成功后会保存新版本，旧版本继续可用。" : "选择对话源文件。已知格式会直接准备导入；陌生结构只需设置一次，以后会自动识别。"}</p>
      <div className="grid grid-cols-1 rounded-lg bg-subtle p-1 min-[440px]:grid-cols-2" role="group" aria-label="导入类型">
        <ModeButton active={mode === "adaptive"} icon={FileJson2} label="JSON / Markdown" description="已知与已学习格式" onClick={() => reset("adaptive")} initialFocus />
        {!repairProfileId ? <ModeButton active={mode === "archive"} icon={Archive} label=".cr 归档" description="恢复 Chat Reader 归档" onClick={() => reset("archive")} /> : <div className="flex min-h-12 items-center px-3 text-xs text-secondary">修复只接受 JSON / Markdown</div>}
      </div>
      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border border-dashed px-6 py-8 text-center transition-colors ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui bg-subtle"}`}
      >
        <UploadCloud className="mx-auto h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-primary">拖放文件到这里</p>
        <p className="my-2 text-xs text-secondary">或</p>
        <label className="btn-secondary inline-flex min-h-10 cursor-pointer items-center justify-center px-4 text-sm font-medium">
          {mode === "adaptive" ? "选择 JSON / Markdown 文件" : "选择 .cr 归档"}
          <input key={mode} type="file" data-testid="import-file-input" multiple={mode === "adaptive"} className="sr-only" accept={mode === "adaptive" ? ".json,.jsonl,.gz,.md,.markdown" : ".cr"} onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))} />
        </label>
        <p className="mt-3 break-all text-sm text-secondary">{selectedLabel}</p>
        <p className="mt-1 text-xs text-secondary">{mode === "adaptive" ? "支持单 JSON、单 Markdown、JSON + Markdown 及批量文件" : ".cr 使用独立归档恢复流程"}</p>
      </div>
      {validationError ? <ErrorLine message={validationError} /> : null}
      {adaptiveMutation.isError ? <ErrorLine message={adaptiveMutation.error.message} /> : null}
      {archiveMutation.isError ? <ErrorLine message={archiveMutation.error.message} /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error.message} /> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!files.length || Boolean(validationError) || busy} data-testid="preview-import-button" onClick={() => mode === "archive" ? archiveMutation.mutate(files) : adaptiveMutation.mutate(files)} className="btn-primary min-h-10 px-4 text-sm font-medium">
          {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在识别格式</> : mode === "adaptive" ? <><ScanSearch className="h-4 w-4" />分析并继续</> : "检查归档"}
        </button>
        {archivePreview ? <button type="button" disabled={!archiveCanCommit || commitMutation.isPending} data-testid="commit-import-button" onClick={() => commitMutation.mutate({ importId: archivePreview.import_id, policy: duplicatePolicy })} className="btn-secondary min-h-10 px-4 text-sm font-medium">{commitMutation.isPending ? "正在导入" : "恢复归档"}</button> : null}
      </div>
      {archivePreview ? <ImportPreviewCard preview={archivePreview} /> : null}
      {archivePreview?.duplicate_conversation_id ? <div className="border-l-2 border-[var(--warning)] pl-3 text-sm text-secondary"><p>系统中已有相同归档。默认会创建副本，不覆盖原记录。</p><Link href={`/conversations/${archivePreview.duplicate_conversation_id}`} className="mt-2 inline-block font-medium text-accent underline">打开已有对话</Link></div> : null}
      {commitResult && !pendingImportId ? <div role="status" className="border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-accent">已导入 {commitResult.conversation_count} 个对话。</div> : null}
    </section>
  );
}

function ModeButton({ active, icon: Icon, label, description, onClick, initialFocus = false }: { active: boolean; icon: LucideIcon; label: string; description: string; onClick: () => void; initialFocus?: boolean }) {
  return <button type="button" data-dialog-initial-focus={initialFocus ? "true" : undefined} aria-pressed={active} onClick={onClick} className={`min-w-0 rounded-md px-3 py-2 text-left transition-colors ${active ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}><span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0" /><span>{label}</span></span><span className="mt-0.5 block text-xs leading-5 text-secondary">{description}</span></button>;
}

function validateFiles(files: File[], mode: ImportMode): string | null {
  if (!files.length) return null;
  const extensions = files.map((file) => fileExtension(file.name));
  if (mode === "archive") return files.length === 1 && extensions[0] === ".cr" ? null : ".cr 归档必须单独导入。";
  if (extensions.some((extension) => ![".json", ".jsonl", ".gz", ".md", ".markdown"].includes(extension))) return "只支持 JSON 和 Markdown 对话源文件。";
  if (files.length > 500) return "一次最多分析 500 个文件。";
  return null;
}

function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".canonical.jsonl.gz")) return ".gz";
  if (lower.endsWith(".canonical.jsonl")) return ".jsonl";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function ErrorLine({ message }: { message: string }) { return <div role="alert" className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</div>; }
