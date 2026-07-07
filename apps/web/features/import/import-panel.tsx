"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { commitImport, previewImport } from "../../lib/api";
import type { CommitImportResponse, ImportPreviewResponse } from "../../lib/types";
import { ImportPreviewCard } from "./import-preview-card";

export function ImportPanel() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);

  const selectedLabel = useMemo(() => {
    if (files.length === 0) {
      return "No files selected";
    }
    if (files.length === 1) {
      return files[0]?.name ?? "1 file selected";
    }
    return `${files.length} files selected`;
  }, [files]);

  const previewMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => {
      setPreview(result);
      setCommitResult(null);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const commitMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: (result) => {
      setCommitResult(result);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const canCommit = Boolean(preview?.can_commit ?? preview?.conversation_preview ?? preview?.conversation_previews?.length);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Import</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">Preview and commit files</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Upload supported exports, preview the detected canonical conversation, then commit it to the reader.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
          Choose files
          <input
            type="file"
            multiple
            className="sr-only"
            accept=".json,.md,.markdown,.txt,.csv"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setPreview(null);
              setCommitResult(null);
            }}
          />
        </label>
        <span className="text-sm text-slate-600">{selectedLabel}</span>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={files.length === 0 || previewMutation.isPending}
          onClick={() => previewMutation.mutate(files)}
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {previewMutation.isPending ? "Previewing" : "Preview Import"}
        </button>
        <button
          type="button"
          disabled={!preview || !canCommit || commitMutation.isPending}
          onClick={() => {
            if (preview) {
              commitMutation.mutate(preview.import_id);
            }
          }}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {commitMutation.isPending ? "Committing" : "Commit Import"}
        </button>
      </div>

      {previewMutation.isError ? <ErrorLine message={previewMutation.error.message} /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error.message} /> : null}

      {preview ? <ImportPreviewCard preview={preview} /> : null}

      {commitResult ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">
            Imported {commitResult.conversation_count} conversation
            {commitResult.conversation_count === 1 ? "" : "s"} with {commitResult.message_count} messages.
          </p>
          {commitResult.conversation_ids[0] ? (
            <Link
              href={`/conversations/${commitResult.conversation_ids[0]}`}
              className="mt-2 inline-block font-medium underline"
            >
              Open first conversation
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}
