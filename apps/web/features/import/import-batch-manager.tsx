"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiRequestError, cancelAdaptiveImportSession, cancelTask, getAdaptiveImportSession, getUnfinishedImports, retryTask, type UnfinishedImport } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import { useImportDialog } from "../../components/import-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { importStateLabel } from "./import-workspace-copy";
import { dispositionOutcome, restoreDisposition, type ImportDispositionControl } from "./import-disposition-state";
import type { AdaptiveImportSession } from "../../lib/types";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";

export function ImportBatchManager({ onSessions, renderStages }: {
  onSessions?: (items: UnfinishedImport[], total: number) => void;
  renderStages?: (item: UnfinishedImport) => ReactNode;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [offset, setOffset] = useState(0);
  const root = useRef<HTMLElement>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const query = useQuery({
    queryKey: ["unfinished-imports", authenticationGeneration(), offset],
    queryFn: ({ signal }) => getUnfinishedImports(offset, signal),
    refetchInterval: 5000, retry: false,
  });
  useEffect(() => { onSessions?.(query.data?.items ?? [], query.data?.total ?? 0); }, [onSessions, query.data]);
  useEffect(() => {
    // A confirmed discard can remove its focused row. Recover only lost focus,
    // never take it from another control the person has already chosen.
    if (focusOrigin.current && !focusOrigin.current.isConnected && document.activeElement === document.body) {
      (root.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? root.current)?.focus({ preventScroll: true });
    }
  }, [query.data]);
  return <section ref={root} tabIndex={-1} onFocusCapture={event => { focusOrigin.current = event.target; }}
    aria-label={zh ? "导入批次" : "Import batches"} className="mb-5 space-y-2 outline-none">
    <h3 className="text-sm font-semibold">{zh ? "导入批次" : "Import batches"}{query.data ? ` (${query.data.total ?? query.data.items.length})` : ""}</h3>
    {query.isError ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void query.refetch()}>{zh ? "批次读取失败，重新核对" : "Cannot read batches. Check again"}</button>
      : query.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在读取…" : "Loading…"}</p>
        : query.data.items.length ? <div className="divide-y divide-ui">{query.data.items.map(item => <BatchRow key={item.import_id} item={item} stages={renderStages?.(item)} />)}</div>
          : <p className="text-sm text-secondary">{zh ? "没有待处理导入。" : "No pending imports."}</p>}
    <div className="flex gap-3">{offset > 0 ? <button className="min-h-11 text-sm text-accent" onClick={() => setOffset(value => Math.max(0, value - 20))}>{zh ? "上一页" : "Previous"}</button> : null}
      {query.data?.has_more ? <button className="min-h-11 text-sm text-accent" onClick={() => setOffset(value => value + 20)}>{zh ? "下一页" : "Next"}</button> : null}</div>
  </section>;
}

function BatchRow({ item, stages }: { item: UnfinishedImport; stages?: ReactNode }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const { openImportDialog } = useImportDialog();
  return <article className="space-y-2 py-4" data-import-session-id={item.import_id}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h4 className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</h4>
      <span className="shrink-0 text-xs text-secondary">{importStateLabel(item.state, zh)}</span>
    </div>
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
      <span>{item.target_project_name || (zh ? "未归类" : "Unclassified")}</span>
      <time dateTime={item.updated_at} title={zh ? "最后活动" : "Last activity"}>{new Date(item.updated_at).toLocaleString(resolvedLocale)}</time>
      {!item.source_available ? <span className="text-[var(--danger)]">{zh ? "来源不可用" : "Source unavailable"}</span>
        : item.draft_status !== "ready" ? <span>{zh ? "预览需重建" : "Preview needs rebuilding"}</span> : null}
    </p>
    {item.error_message ? <p className="break-words border-l-2 border-[var(--danger)] pl-3 text-sm text-[var(--danger)]">{item.error_message}</p> : null}
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => {
        window.dispatchEvent(new Event("chat-reader:close-task-center")); openImportDialog({ resumeImportId: item.import_id });
      }}>{zh ? "查看详情" : "View details"}</button>
      <ImportDisposition importId={item.import_id} updatedAt={item.updated_at} cleanup={item.source_cleanup} title={item.title} taskId={item.analysis_task_id} canStop={!stages && item.allowed_actions?.includes("stop_retain")} canDiscard={item.allowed_actions?.includes("discard")} />
    </div>
    {item.created_at ? <details className="text-xs text-secondary">
      <summary className="min-h-11 cursor-pointer content-center">{zh ? "批次信息" : "Batch info"}</summary>
      <p className="pb-2">{zh ? "创建于 " : "Created "}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(resolvedLocale)}</time> · {item.source_available ? (zh ? "来源保留" : "Source retained") : (zh ? "来源不可用" : "Source unavailable")}</p>
    </details> : null}
    {stages ? <div className="mt-2 border-l border-ui pl-3" aria-label={zh ? "本批处理阶段" : "Batch stages"}>{stages}</div> : null}
  </article>;
}

/** Unknown writes survive closing the panel in the existing account-bound cache. */
export function ImportDisposition({ importId, updatedAt, title, taskId, cleanup, canStop, canDiscard, onChanged }: {
  importId: string; updatedAt?: string; title: string; taskId?: string | null; canStop?: boolean; canDiscard?: boolean;
  cleanup?: AdaptiveImportSession["source_cleanup"];
  onChanged?: (session: Awaited<ReturnType<typeof getAdaptiveImportSession>>) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const client = useQueryClient();
  const generation = authenticationGeneration();
  const key = ["import-disposition", generation, importId];
  const user = getCurrentOfflineRuntimeUserId();
  const storageKey = user ? `chat-reader:import-disposition:${user}:${importId}` : null;
  const persist = (value: ImportDispositionControl | null) => {
    try {
      if (storageKey && generation === authenticationGeneration()) {
        if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
        else sessionStorage.removeItem(storageKey);
      }
    } catch { /* The live account cache still blocks duplicate submissions. */ }
  };
  const state = useQuery<ImportDispositionControl | null>({ queryKey: key, queryFn: async () => null, enabled: false,
    initialData: () => {
      try { return storageKey ? restoreDisposition(sessionStorage, storageKey) : null; } catch { return null; }
    }, staleTime: Infinity, gcTime: Infinity });
  const operation = state.data;
  useEffect(() => {
    if (!operation && cleanup && cleanup.state !== "completed") {
      client.setQueryData(["import-disposition", generation, importId], {
        operationId: `cleanup:${cleanup.revision}`, action: "cleanup", state: "unknown",
      } satisfies ImportDispositionControl);
    }
  }, [cleanup, client, generation, importId, operation]);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const read = useQuery({
    // A previous check (even for the same batch) can never confirm a new write.
    queryKey: ["import-disposition-check", generation, importId, operation?.operationId],
    queryFn: ({ signal }) => getAdaptiveImportSession(importId, signal),
    enabled: operation?.state === "unknown",
    refetchInterval: query => operation?.state === "unknown" && !query.state.error
      && (["COLLECTING", "ANALYZING", "IMPORTING", "CANCELING"].includes(query.state.data?.state ?? "")
      || query.state.data?.source_cleanup?.state === "pending") ? 1500 : false,
    retry: false,
  });
  useEffect(() => {
    if (operation?.state !== "unknown" || !read.data || read.error || generation !== authenticationGeneration()) return;
    const current = client.getQueryData<ImportDispositionControl>(["import-disposition", generation, importId]);
    if (current?.operationId !== operation.operationId) return;
    const value = read.data;
    changed.current?.(value);
    if (dispositionOutcome(operation.action, value) || operation.rejected) {
      try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* Optional persistence. */ }
      client.setQueryData(["import-disposition", generation, importId], { ...operation,
        state: dispositionOutcome(operation.action, value) ? "confirmed" : "rejected" });
      void client.invalidateQueries({ queryKey: ["unfinished-imports"] });
      void client.invalidateQueries({ queryKey: ["active-tasks"] });
    }
  }, [client, generation, importId, operation, read.data, read.error, storageKey]);
  const run = async (action: ImportDispositionControl["action"]) => {
    const current = client.getQueryData<ImportDispositionControl>(key);
    if (current && ["pending", "unknown"].includes(current.state) && action !== "cleanup") return;
    if (action === "discard" && !await confirm({
      title: zh ? "放弃本次导入？" : "Discard this import?",
      description: `${title}\n${zh ? "停止并删除本批暂存来源和草稿。已导入对话、已保存格式保留。" : "Stop and delete this batch's temporary sources and draft. Imported conversations and saved formats remain."}`,
      danger: true, confirmLabel: zh ? "放弃本次导入" : "Discard import",
    })) return;
    if (generation !== authenticationGeneration()) return;
    // Recheck after the confirmation dialog: another mounted surface may own it.
    const latest = client.getQueryData<ImportDispositionControl>(key);
    if (latest !== current) return;
    const next: ImportDispositionControl = { operationId: crypto.randomUUID(), action, state: "pending" };
    client.setQueryData(key, next);
    persist(next);
    try {
      if (action === "discard") await cancelAdaptiveImportSession(importId, updatedAt);
      else if (action === "cleanup") await retryTask(importId);
      else if (action === "retain" && taskId) await cancelTask(taskId, undefined, "retain");
      else next.rejected = true;
    } catch (error) {
      // Network/5xx outcomes remain unknown, never replayed. A definite refusal
      // can be released only after a fresh authoritative session read.
      next.rejected = error instanceof ApiRequestError && [400, 403, 404, 409, 422].includes(error.status);
    }
    if (generation !== authenticationGeneration()) return;
    const unknown = { ...next, state: "unknown" as const };
    persist(unknown);
    client.setQueryData(key, unknown);
  };
  const busy = operation?.state === "pending" || operation?.state === "unknown";
  const cleanupFailed = operation?.state === "unknown" && ["failed", "blocked"].includes(read.data?.source_cleanup?.state ?? "");
  return <>
    {canStop ? <button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-sm disabled:opacity-50" onClick={() => void run("retain")}>{zh ? "停止并保留" : "Stop and keep"}</button> : null}
    {canDiscard ? <button type="button" disabled={busy || !updatedAt} className="min-h-11 px-3 text-sm text-[var(--danger)] disabled:opacity-50" onClick={() => void run("discard")}>{zh ? "放弃本次导入" : "Discard import"}</button> : null}
    {busy ? <span role="status" className="flex w-full flex-wrap items-center gap-x-2 text-xs text-secondary">{cleanupFailed
      ? (zh ? "已停止，来源清理未完成。" : "Stopped; source cleanup is incomplete.")
      : (zh ? "停止结果待确认；来源暂时保留。" : "Stop unconfirmed; sources retained for now.")}
      <button type="button" disabled={operation?.state === "pending" || read.isFetching} className="min-h-11 px-2 text-accent underline" onClick={() => void read.refetch()}>{zh ? "核对结果" : "Check result"}</button>
      {cleanupFailed && read.data?.source_cleanup?.retryable ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void run("cleanup")}>{zh ? "仅重试清理" : "Retry cleanup only"}</button> : null}
    </span> : null}
    {operation?.state === "rejected" ? <span role="alert" className="text-xs text-[var(--danger)]">{zh ? "操作未被接受，请核对批次状态。" : "Operation refused. Check this batch's status."}</span> : null}
    {operation?.state === "confirmed" ? <span role="status" className="text-xs text-secondary">{read.data?.state === "COMPLETED"
      ? (zh ? "停止前导入已完成；已有对话未删除。" : "Import completed before stopping; conversations remain.")
      : (zh ? "已核对处理结果" : "Outcome confirmed")}</span> : null}
  </>;
}
