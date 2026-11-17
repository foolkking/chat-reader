"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { getImportSourcePreview } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { AdaptiveImportGroup, AdaptiveImportSession } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

export function ImportSourcePreview({ session, group, showSourceName = true }: { session: AdaptiveImportSession; group: AdaptiveImportGroup; showSourceName?: boolean }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const generation = authenticationGeneration();
  const query = useQuery({
    queryKey: ["import-source-preview", generation, session.import_id, group.id, session.updated_at],
    queryFn: async ({ signal }) => {
      if (!session.updated_at) throw new Error("PREVIEW_VERSION_MISSING");
      const result = await getImportSourcePreview(session.import_id, group.id, session.updated_at, signal);
      if (generation !== authenticationGeneration() || result.import_id !== session.import_id
        || result.group_id !== group.id || result.family_id !== group.family_id
        || result.sources.length !== group.artifact_ids.length
        || result.sources.some(source => !group.artifact_ids.includes(source.artifact_id))) throw new Error("PREVIEW_SOURCE_MISMATCH");
      return result;
    },
    enabled: open && !!session.updated_at, retry: false, gcTime: 0,
  });
  return <div className={showSourceName ? "mt-2 border-t border-ui pt-2" : "mt-1"}>
    {showSourceName ? <p className="break-words text-sm text-primary [overflow-wrap:anywhere]">{group.files.map(file => file.filename).join(" · ")}</p> : null}
    <button type="button" aria-expanded={open} aria-controls={previewId} onClick={() => setOpen(value => !value)}
      className="min-h-11 text-sm text-accent underline-offset-4 hover:underline">
      {open ? (zh ? "收起预览" : "Hide preview") : (zh ? "来源与预览" : "Source & preview")}
    </button>
    {open ? <div id={previewId} className="space-y-3 rounded-md bg-subtle p-3 text-sm" aria-live="polite">
      <p className="break-words text-xs text-secondary [overflow-wrap:anywhere]">{group.files.map(file => file.filename).join(" · ")}</p>
      {!session.updated_at ? <p role="alert" className="text-secondary">{zh ? "批次信息不完整，请重新打开此批次。" : "Batch details are incomplete. Reopen this batch."}</p>
        : query.isPending ? <p>{zh ? "正在读取预览…" : "Loading preview…"}</p>
        : query.isError ? <><p role="alert" className="text-secondary">{zh ? "预览过期或来源已变。请刷新批次，或手动重建预览。" : "Preview expired or source changed. Refresh the batch or rebuild the preview."}</p><button type="button" onClick={() => void query.refetch()} className="btn-secondary min-h-11 px-3">{zh ? "重新核对" : "Check again"}</button></>
        : query.data?.preview ? <>
          <p className="font-semibold">{query.data.preview.title}</p>
          <p className="text-xs text-secondary">{query.data.conversation_count} {zh ? "个对话 · 正文节选" : "conversations · text sample"}</p>
          <div className="max-h-72 space-y-3 overflow-y-auto border-l border-ui pl-3">
            {query.data.preview.messages.map((message, index) => <div key={index}><p className="text-xs font-semibold text-secondary">{message.role === "user" ? (zh ? "用户" : "User") : message.role === "assistant" ? (zh ? "助手" : "Assistant") : message.role}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>{message.content_truncated ? <p className="text-xs text-secondary">{zh ? "样本已截断" : "Sample truncated"}</p> : null}</div>)}
          </div>
        </> : <p>{zh ? "没有正文样本。" : "No text sample available."}</p>}
    </div> : null}
  </div>;
}
