"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileArchive, FileJson2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { commitImport, getImportPreview, getImportStatus, getTask, previewAttachmentBundle, previewImport } from "../../lib/api";
import type { BundlePreviewAccepted, CommitImportResponse, ImportDuplicatePolicy, ImportPreviewResponse } from "../../lib/types";
import { ImportPreviewCard } from "./import-preview-card";

type ImportMode = "standard" | "bundle" | "archive";

export function ImportPanel({ onImportCommitted }: { onImportCommitted?: () => void } = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>("standard");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [pendingBundlePreview, setPendingBundlePreview] = useState<BundlePreviewAccepted | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<ImportDuplicatePolicy>("clone");
  const navigatedImportRef = useRef<string | null>(null);

  const importStatusQuery = useQuery({
    queryKey: ["import-status", pendingImportId],
    queryFn: () => getImportStatus(pendingImportId!),
    enabled: Boolean(pendingImportId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 1200 : false;
    },
  });

  const bundleTaskQuery = useQuery({
    queryKey: ["bundle-preview-task", pendingBundlePreview?.task_id],
    queryFn: () => getTask(pendingBundlePreview!.task_id),
    enabled: Boolean(pendingBundlePreview),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 1000 : false;
    },
  });

  const savedBundlePreviewQuery = useQuery({
    queryKey: ["bundle-import-preview", pendingBundlePreview?.import_id],
    queryFn: () => getImportPreview(pendingBundlePreview!.import_id),
    enabled: Boolean(pendingBundlePreview && bundleTaskQuery.data?.status === "committed"),
    retry: 2,
  });

  const finishCommittedImport = useCallback((result: CommitImportResponse) => {
    if (navigatedImportRef.current === result.import_id) return;
    navigatedImportRef.current = result.import_id;
    setPreview(null);
    setFiles([]);
    setPendingImportId(null);
    setCommitResult(result);
    void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    const conversationId = result.conversation_ids[0];
    if (!conversationId) return;
    onImportCommitted?.();
    router.push(`/conversations/${conversationId}`);
  }, [onImportCommitted, queryClient, router]);

  useEffect(() => {
    if (importStatusQuery.data?.status === "committed") {
      finishCommittedImport(importStatusQuery.data);
    }
  }, [finishCommittedImport, importStatusQuery.data]);

  useEffect(() => {
    if (!savedBundlePreviewQuery.data) return;
    setPreview(savedBundlePreviewQuery.data);
    setCommitResult(null);
  }, [savedBundlePreviewQuery.data]);

  const validationError = useMemo(() => validateFiles(files, mode), [files, mode]);
  const selectedLabel = useMemo(() => {
    if (files.length === 0) return "尚未选择文件";
    if (files.length === 1) return files[0]?.name ?? "已选择 1 个文件";
    return `已选择 ${files.length} 个文件`;
  }, [files]);

  const previewMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => {
      setPreview(result);
      setCommitResult(null);
    },
  });
  const bundlePreviewMutation = useMutation({
    mutationFn: previewAttachmentBundle,
    onSuccess: (result) => {
      setPendingBundlePreview(result);
      setPreview(null);
      setCommitResult(null);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    },
  });
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: ImportDuplicatePolicy }) =>
      commitImport(importId, { duplicatePolicy: policy }),
    onSuccess: (result) => {
      setPreview(null);
      setFiles([]);
      setCommitResult(result);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (result.status === "committed") {
        finishCommittedImport(result);
      } else {
        setPendingImportId(result.import_id);
      }
    },
  });
  const canCommit = Boolean(preview?.can_commit ?? preview?.conversation_preview ?? preview?.conversation_previews?.length ?? preview?.archive_summary);

  function chooseFiles(nextFiles: File[], nextMode = mode) {
    setMode(nextMode);
    setFiles(nextFiles);
    setPreview(null);
    setCommitResult(null);
    setPendingImportId(null);
    setPendingBundlePreview(null);
    navigatedImportRef.current = null;
    setDuplicatePolicy("clone");
    previewMutation.reset();
    bundlePreviewMutation.reset();
    commitMutation.reset();
  }

  function selectMode(nextMode: ImportMode) {
    if (nextMode === mode) return;
    chooseFiles([], nextMode);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const nextFiles = Array.from(event.dataTransfer.files);
    const extension = nextFiles.length === 1 ? fileExtension(nextFiles[0]?.name ?? "") : "";
    const droppedMode: ImportMode = extension === ".cr" ? "archive" : extension === ".crbundle" ? "bundle" : "standard";
    chooseFiles(nextFiles, droppedMode);
  }

  const previewPending = previewMutation.isPending
    || bundlePreviewMutation.isPending
    || Boolean(pendingBundlePreview && ["queued", "processing"].includes(bundleTaskQuery.data?.status ?? "queued"))
    || savedBundlePreviewQuery.isFetching;

  function startPreview() {
    if (mode === "bundle") {
      const file = files[0];
      if (file) bundlePreviewMutation.mutate(file);
      return;
    }
    previewMutation.mutate(files);
  }

  return (
    <section className="space-y-5">
      <p className="text-sm leading-6 text-secondary">请选择标准化对话、带附件对话包或兼容归档。CanJSON v1/v2 会从 JSON 文件自动识别。</p>

      <div className="grid grid-cols-1 rounded-lg bg-subtle p-1 sm:grid-cols-3" role="group" aria-label="导入形式">
        <ModeButton
          active={mode === "standard"}
          icon={<FileJson2 className="h-4 w-4" />}
          label="JSON / CanJSON"
          description="JSON 必需，Markdown 可选"
          onClick={() => selectMode("standard")}
        />
        <ModeButton
          active={mode === "bundle"}
          icon={<FileArchive className="h-4 w-4" />}
          label="附件对话包"
          description=".crbundle 异步校验"
          onClick={() => selectMode("bundle")}
        />
        <ModeButton
          active={mode === "archive"}
          icon={<Archive className="h-4 w-4" />}
          label=".cr 归档"
          description="旧对话归档兼容导入"
          onClick={() => selectMode("archive")}
        />
      </div>

      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border border-dashed p-6 text-center transition ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui bg-subtle"}`}
      >
        <p className="text-sm font-medium text-primary">拖放文件到这里</p>
        <p className="my-2 text-xs text-secondary">或</p>
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-surface px-4 text-sm font-medium text-primary shadow-sm ring-1 ring-[var(--border)] hover:bg-raised">
          {mode === "standard" ? "选择 JSON 与可选 Markdown" : mode === "bundle" ? "选择 .crbundle 附件包" : "选择 .cr 归档"}
          <input
            key={mode}
            type="file"
            data-testid="import-file-input"
            multiple={mode === "standard"}
            className="sr-only"
            accept={mode === "standard" ? ".json,.jsonl,.gz,.md,.markdown" : mode === "bundle" ? ".crbundle,application/vnd.chat-reader.bundle+zip" : ".cr"}
            onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        <p className="mt-3 break-all text-sm text-secondary">{selectedLabel}</p>
        <p className="mt-1 text-xs text-secondary">
          {mode === "standard" ? "兼容 JSON / CanJSON；Markdown 作为配对显示正文" : mode === "bundle" ? "校验对话、附件索引、对象完整性与消息引用" : "兼容读取旧 Chat Reader .cr 对话归档"}
        </p>
      </div>

      {validationError ? <ErrorLine message={validationError} /> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={files.length === 0 || Boolean(validationError) || previewPending}
          data-testid="preview-import-button"
          onClick={startPreview}
          className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {previewPending ? (mode === "bundle" ? "正在校验附件包…" : "正在检查…") : "预览导入"}
        </button>
        <button
          type="button"
          disabled={!preview || !canCommit || commitMutation.isPending}
          data-testid="commit-import-button"
          onClick={() => preview && commitMutation.mutate({ importId: preview.import_id, policy: duplicatePolicy })}
          className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {commitMutation.isPending ? "正在提交…" : "开始导入"}
        </button>
      </div>

      {previewMutation.isError ? <ErrorLine message={previewMutation.error.message} /> : null}
      {bundlePreviewMutation.isError ? <ErrorLine message={bundlePreviewMutation.error.message} /> : null}
      {bundleTaskQuery.data?.status === "failed" ? <ErrorLine message={bundleTaskQuery.data.error_message ?? "附件包校验失败。"} /> : null}
      {savedBundlePreviewQuery.isError ? <ErrorLine message={savedBundlePreviewQuery.error.message} /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error.message} /> : null}
      {preview ? <ImportPreviewCard preview={preview} /> : null}

      {pendingImportId ? (
        <div role="status" className="border-l-2 border-[#10a37f] bg-[#ecfdf5] px-4 py-3 text-sm text-[#065f46]">
          <p className="font-medium">
            {importStatusQuery.data?.status === "failed"
              ? "导入失败，请在任务列表中重试。"
              : `导入中：${importStatusQuery.data?.processed_messages ?? commitResult?.processed_messages ?? 0}/${importStatusQuery.data?.total_messages ?? commitResult?.total_messages ?? 0}`}
          </p>
          {importStatusQuery.data?.error_message ? <p className="mt-1">{importStatusQuery.data.error_message}</p> : null}
        </div>
      ) : null}

      {preview && !preview.can_commit ? (
        <div role="alert" className="border-l-2 border-[#f59e0b] bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
          {mode === "bundle"
            ? "附件包未通过完整性或引用校验。请根据上方报告修复缺失、损坏或无效引用后重新预览。"
            : mode === "archive"
              ? "归档未通过兼容性或完整性校验，无法导入。"
              : "配对文件存在消息数量、角色、顺序或歧义冲突。请修复 Markdown，或移除 Markdown 后仅使用 JSON 重新预览。"}
        </div>
      ) : null}

      {preview?.duplicate_conversation_id ? (
        <div className="border-l-2 border-[#f59e0b] pl-3 text-sm text-[#4b5563]">
          <p>系统中已存在相同内容。默认会克隆为新的对话，原记录不会被覆盖。</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/conversations/${preview.duplicate_conversation_id}`} className="font-medium text-[#047857] underline">打开已有对话</Link>
            <button type="button" onClick={() => setDuplicatePolicy("clone")} className={`font-medium ${duplicatePolicy === "clone" ? "text-[#047857]" : "text-[#6b7280] underline"}`}>导入为副本</button>
          </div>
        </div>
      ) : null}

      {commitResult && !pendingImportId ? (
        <div role="status" className="border-l-2 border-[#10a37f] bg-[#ecfdf5] px-4 py-3 text-sm text-[#065f46]">
          <p className="font-medium">{commitResult.status === "committed" ? `已导入 ${commitResult.conversation_count} 个对话，共 ${commitResult.message_count} 条消息。` : "导入任务已排队，可关闭窗口并在侧栏查看进度。"}</p>
          {commitResult.status === "committed" && commitResult.conversation_ids[0] ? <Link href={`/conversations/${commitResult.conversation_ids[0]}`} className="mt-2 inline-block font-medium underline">打开导入的对话</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

function ModeButton({ active, icon, label, description, onClick }: { active: boolean; icon: ReactNode; label: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-w-0 rounded-md px-3 py-2 text-left transition ${active ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">{icon}<span className="truncate">{label}</span></span>
      <span className="mt-0.5 block truncate text-xs text-secondary">{description}</span>
    </button>
  );
}

function validateFiles(files: File[], mode: ImportMode): string | null {
  if (files.length === 0) return null;
  const extensions = files.map((file) => fileExtension(file.name));
  if (mode === "archive") {
    return files.length === 1 && extensions[0] === ".cr" ? null : "完整归档形式只接受一个 .cr 文件。";
  }
  if (mode === "bundle") {
    return files.length === 1 && extensions[0] === ".crbundle" ? null : "附件对话包只接受一个 .crbundle 文件。";
  }
  const dataFiles = extensions.filter((extension) => [".json", ".jsonl", ".gz"].includes(extension));
  const markdownFiles = extensions.filter((extension) => [".md", ".markdown"].includes(extension));
  if (dataFiles.length !== 1) return "标准化对话必须选择一个 JSON 或 CanJSON 文件。";
  if (markdownFiles.length > 1) return "最多只能配对一个 Markdown 文件。";
  if (dataFiles.length + markdownFiles.length !== files.length) return "仅支持 JSON、CanJSON 和可选 Markdown 配对文件。";
  return null;
}

function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".canonical.jsonl.gz")) return ".gz";
  if (lower.endsWith(".canonical.jsonl")) return ".jsonl";
  if (lower.endsWith(".crbundle")) return ".crbundle";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function ErrorLine({ message }: { message: string }) {
  return <div role="alert" className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</div>;
}
