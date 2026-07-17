"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState, type DragEvent } from "react";
import { commitImport, previewImport } from "../../lib/api";
import type { CommitImportResponse, ImportPreviewResponse } from "../../lib/types";
import { ImportPreviewCard } from "./import-preview-card";

export function ImportPanel() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<"reject" | "copy">("reject");

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
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: "reject" | "copy" }) =>
      commitImport(importId, { duplicatePolicy: policy }),
    onSuccess: (result) => {
      setCommitResult(result);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const canCommit = Boolean(preview?.can_commit ?? preview?.conversation_preview ?? preview?.conversation_previews?.length ?? preview?.archive_summary);

  function chooseFiles(nextFiles: File[]) {
    setFiles(nextFiles);
    setPreview(null);
    setCommitResult(null);
    setDuplicatePolicy("reject");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[#111827]">导入数据</h2>
        <p className="mt-2 text-sm leading-6 text-[#6b7280]">支持 `.cr` 快速归档，也可配对导入 ChatGPT Exporter 的 JSON 与 Markdown 文件。</p>
      </div>

      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border border-dashed p-6 text-center transition ${dragging ? "border-[#10a37f] bg-[#ecfdf5]" : "border-[#d1d5db] bg-[#f7f7f8]"}`}
      >
        <p className="text-sm font-medium text-[#374151]">拖放文件到这里</p>
        <p className="my-2 text-xs text-[#9ca3af]">或</p>
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-[#111827] shadow-sm ring-1 ring-[#e5e5e5] hover:bg-[#f9fafb]">
          选择文件
          <input
            type="file"
            data-testid="import-file-input"
            multiple
            className="sr-only"
            accept=".cr,.json,.md,.markdown,.txt,.csv"
            onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        <p className="mt-3 text-sm text-[#6b7280]">{selectedLabel}</p>
        <p className="mt-1 text-xs text-[#9ca3af]">`.cr`、JSON、Markdown、TXT、CSV</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={files.length === 0 || previewMutation.isPending}
          data-testid="preview-import-button"
          onClick={() => previewMutation.mutate(files)}
          className="min-h-10 rounded-lg bg-[#111827] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#d1d5db]"
        >
          {previewMutation.isPending ? "正在检查…" : "预览导入"}
        </button>
        <button
          type="button"
          disabled={!preview || !canCommit || commitMutation.isPending || Boolean(preview.duplicate_conversation_id && duplicatePolicy === "reject")}
          data-testid="commit-import-button"
          onClick={() => preview && commitMutation.mutate({ importId: preview.import_id, policy: duplicatePolicy })}
          className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-4 text-sm font-medium text-[#111827] disabled:cursor-not-allowed disabled:text-[#9ca3af]"
        >
          {commitMutation.isPending ? "正在提交…" : "开始导入"}
        </button>
      </div>

      {previewMutation.isError ? <ErrorLine message={previewMutation.error.message} /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error.message} /> : null}
      {preview ? <ImportPreviewCard preview={preview} /> : null}

      {preview?.duplicate_conversation_id ? (
        <div className="border-l-2 border-[#f59e0b] pl-3 text-sm text-[#4b5563]">
          <p>系统中已存在相同归档。</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/conversations/${preview.duplicate_conversation_id}`} className="font-medium text-[#047857] underline">打开已有对话</Link>
            <button type="button" onClick={() => setDuplicatePolicy("copy")} className={`font-medium ${duplicatePolicy === "copy" ? "text-[#047857]" : "text-[#6b7280] underline"}`}>仍然导入副本</button>
          </div>
        </div>
      ) : null}

      {commitResult ? (
        <div role="status" className="border-l-2 border-[#10a37f] bg-[#ecfdf5] px-4 py-3 text-sm text-[#065f46]">
          <p className="font-medium">{commitResult.status === "committed" ? `已导入 ${commitResult.conversation_count} 个对话，共 ${commitResult.message_count} 条消息。` : "导入任务已排队，可关闭窗口并在侧栏查看进度。"}</p>
          {commitResult.status === "committed" && commitResult.conversation_ids[0] ? <Link href={`/conversations/${commitResult.conversation_ids[0]}`} className="mt-2 inline-block font-medium underline">打开导入的对话</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

function ErrorLine({ message }: { message: string }) {
  return <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>;
}
