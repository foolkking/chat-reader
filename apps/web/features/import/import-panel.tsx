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
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-conversations"] });
    },
  });

  const canCommit = Boolean(preview?.can_commit ?? preview?.conversation_preview ?? preview?.conversation_previews?.length);

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-[#10a37f]">Import</p>
        <h2 className="mt-1 text-lg font-semibold text-[#111827]">Preview and commit files</h2>
        <p className="mt-2 text-sm leading-6 text-[#6b7280]">
          Upload supported exports, preview the detected canonical conversation, then commit it to the reader.
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-[#d1d5db] bg-[#f7f7f8] p-5 text-center">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#111827] shadow-sm ring-1 ring-[#e5e5e5] hover:bg-[#f9fafb]">
          Select files
          <input
            type="file"
            data-testid="import-file-input"
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
        <p className="mt-3 text-sm text-[#6b7280]">{selectedLabel}</p>
        <p className="mt-1 text-xs text-[#9ca3af]">Supported: JSON, Markdown, TXT, CSV</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={files.length === 0 || previewMutation.isPending}
          data-testid="preview-import-button"
          onClick={() => previewMutation.mutate(files)}
          className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#d1d5db]"
        >
          {previewMutation.isPending ? "Previewing" : "Preview Import"}
        </button>
        <button
          type="button"
          disabled={!preview || !canCommit || commitMutation.isPending}
          data-testid="commit-import-button"
          onClick={() => {
            if (preview) {
              commitMutation.mutate(preview.import_id);
            }
          }}
          className="rounded-lg border border-[#d1d5db] bg-white px-4 py-2 text-sm font-medium text-[#111827] disabled:cursor-not-allowed disabled:text-[#9ca3af]"
        >
          {commitMutation.isPending ? "Committing" : "Commit Import"}
        </button>
      </div>

      {previewMutation.isError ? <ErrorLine message={previewMutation.error.message} /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error.message} /> : null}

      {preview ? <ImportPreviewCard preview={preview} /> : null}

      {commitResult ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">
            Imported {commitResult.conversation_count} conversation
            {commitResult.conversation_count === 1 ? "" : "s"} with {commitResult.message_count} messages.
          </p>
          {commitResult.conversation_ids[0] ? (
            <Link
              href={`/conversations/${commitResult.conversation_ids[0]}`}
              data-testid="open-imported-conversation-link"
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
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}
