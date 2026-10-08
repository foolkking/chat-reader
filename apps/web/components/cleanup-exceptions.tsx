"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, deleteCleanupException, getCleanupExceptionPreview, getCleanupExceptions, saveCleanupException } from "../lib/api";
import { authenticationGeneration } from "../lib/offline-access";
import { cleanupRuleLabel } from "../lib/content-cleanup";
import type { CleanupException, CleanupExceptionPreview, CleanupOccurrenceRead, CleanupReviewPage, CleanupScanRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

function Scope({ item, zh }: { item: CleanupException | CleanupExceptionPreview; zh: boolean }) {
  const roles: Record<string, string> = { user: "用户", assistant: "助手", system: "系统", tool: "工具" };
  return <div className="min-w-0 space-y-2 text-xs leading-5">
    <p className="font-medium">{cleanupRuleLabel(item.rule_name, item.detector_id, zh)} · v{item.revision} · {zh ? roles[item.role] ?? item.role : item.role}</p>
    <pre tabIndex={0} aria-label={zh ? "精确忽略范围" : "Exact exception scope"} className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 font-sans [overflow-wrap:anywhere]">{item.at_start ? (zh ? "[消息开始] " : "[Message start] ") : "…"}{item.context_before}<mark className="bg-[var(--mark-bg)] font-medium text-[var(--mark-text)]">{item.match_value}</mark>{item.context_after}{item.at_end ? (zh ? " [消息结束]" : " [Message end]") : "…"}</pre>
  </div>;
}

function useRequestLifetime() {
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  return {
    active: () => mounted.current && generation.current === authenticationGeneration(),
    signal: () => { request.current?.abort(); request.current = new AbortController(); return request.current.signal; },
  };
}

function exceptionError(error: Error, zh: boolean, operation: "read" | "save" | "revoke") {
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return zh ? "此操作已不可用，请关闭后重新打开。" : "This action is unavailable. Close and reopen the review.";
  if (error instanceof ApiRequestError && error.status === 409) return zh ? "范围已变化或确认已过期，请重新读取；正文变化时需返回重新扫描。" : "The scope changed or confirmation expired. Reload the scope; rescan if the source changed.";
  if (operation === "save") return zh ? "保存结果未确认，请先检查保存结果。" : "Save is unconfirmed. Check the saved result first.";
  if (operation === "revoke") return zh ? "撤销结果未确认，可重试撤销；重复请求不会影响其他例外。" : "Revocation is unconfirmed. Retry safely; other exceptions are unaffected.";
  return zh ? "读取失败，请检查连接后重试。旧范围暂时不能确认。" : "Read failed. Check your connection and retry. The previous scope cannot be confirmed.";
}

export function CleanupExceptionEditor({ scanId, occurrenceId, onDone }: { scanId: string; occurrenceId: string; onDone: (saved: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const lifetime = useRequestLifetime();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [notice, setNotice] = useState(false);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const key = ["cleanup-exception-preview", scanId, occurrenceId];
  const preview = useQuery({ queryKey: key, queryFn: ({ signal }) => getCleanupExceptionPreview(scanId, occurrenceId, signal), staleTime: 0, retry: false });
  const finish = async (scan?: CleanupScanRead) => {
    await Promise.all([client.cancelQueries({ queryKey: ["cleanup-exceptions"] }), client.cancelQueries({ queryKey: ["cleanup-review", scanId] }), client.cancelQueries({ queryKey: ["content-cleanup-scan", scanId] })]);
    if (!lifetime.active()) return;
    if (scan) client.setQueryData(["content-cleanup-scan", scanId], scan);
    for (const [queryKey, previous] of client.getQueriesData<CleanupReviewPage<CleanupOccurrenceRead>>({ queryKey: ["cleanup-review", scanId, "page"] })) {
      if (!previous?.items.some(item => item.id === occurrenceId)) continue;
      const selectedOnly = (queryKey[3] as { selected_only?: boolean })?.selected_only;
      client.setQueryData(queryKey, { ...previous,
        items: selectedOnly ? previous.items.filter(item => item.id !== occurrenceId) : previous.items.map(item => item.id === occurrenceId ? { ...item, decision: "KEEP" } : item),
        total: Math.max(0, previous.total - (selectedOnly ? 1 : 0)),
      });
    }
    void client.invalidateQueries({ queryKey: ["cleanup-exceptions"] });
    onDone(true);
  };
  const save = useMutation({
    mutationFn: () => saveCleanupException(scanId, occurrenceId, preview.data!.preview_token, lifetime.signal()),
    onSuccess: result => { if (lifetime.active()) return finish(result.scan); },
    onError: error => { if (lifetime.active() && !(error instanceof ApiRequestError && [401, 403, 404, 409, 422].includes(error.status))) setNeedsCheck(true); },
  });
  const read = useMutation({
    mutationFn: async () => { await client.cancelQueries({ queryKey: key }); return getCleanupExceptionPreview(scanId, occurrenceId, lifetime.signal()); },
    onSuccess: async result => {
      if (!lifetime.active()) return;
      client.setQueryData(key, result);
      if (needsCheck && result.exception_saved && result.decision === "KEEP") { await finish(result.scan); return; }
      setNotice(needsCheck); setNeedsCheck(false); save.reset();
    },
  });
  const busy = save.isPending || read.isPending || preview.isFetching;
  const failure = read.error ?? preview.error ?? save.error;
  return <section className="space-y-3 rounded-lg border border-ui p-3 sm:p-4" aria-label={zh ? "个人忽略例外" : "Personal exception"}>
    <div className="flex items-start justify-between gap-2"><h3 tabIndex={-1} ref={headingRef} className="text-sm font-semibold">{zh ? "以后忽略这种情况" : "Ignore this case in future"}</h3><button type="button" disabled={save.isPending} onClick={() => onDone(false)} className="btn-secondary min-h-11 shrink-0 px-3 text-xs">{zh ? "取消" : "Cancel"}</button></div>
    <p className="text-sm leading-6 text-secondary">{zh ? "仅对你生效。本项会保留，其他待审查项不变。" : "Only for your account. This item is kept; other pending items stay unchanged."}</p>
    {preview.isLoading ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取适用范围…" : "Loading scope…"}</p> : null}
    {preview.data ? <Scope item={preview.data} zh={zh} /> : null}
    <details className="text-xs leading-5 text-secondary"><summary className="min-h-11 cursor-pointer py-3 text-primary">{zh ? "适用范围与撤销" : "Scope and revocation"}</summary><p>{zh ? "规则版本、角色、匹配文本和前后最多 48 个字符须完全相同；规则或上下文变化时会重新提示。可在规则库“我的忽略例外”中撤销，不会改动正文。" : "The rule revision, role, text and up to 48 characters on each side must match exactly. Changed rules or context are reviewed again. Revoke under My exceptions in the rule library; content is unchanged."}</p></details>
    {failure ? <p role="alert" className="text-sm text-[var(--danger)]">{exceptionError(failure, zh, read.isError || preview.isError ? "read" : "save")}</p> : null}
    {notice ? <p role="status" className="text-xs text-secondary">{zh ? "当前状态尚未满足此次保存。请检查范围，再明确确认。" : "The current state does not match this save yet. Review the scope and confirm again."}</p> : null}
    <div className="flex flex-wrap gap-2">
      {failure || needsCheck ? <button type="button" disabled={busy} onClick={() => { setNotice(false); read.mutate(); }} className="btn-secondary min-h-11 px-3 text-xs">{read.isPending ? (zh ? "正在读取…" : "Loading…") : needsCheck ? (zh ? "检查保存结果" : "Check save result") : (zh ? "重新读取范围" : "Reload scope")}</button> : null}
      <button type="button" disabled={!preview.data || busy || Boolean(failure) || needsCheck} onClick={() => save.mutate()} className="btn-primary min-h-11 px-3 text-xs font-semibold">{save.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "确认保存个人例外" : "Confirm personal exception")}</button>
    </div>
  </section>;
}

export function CleanupExceptionList() {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const lifetime = useRequestLifetime();
  const [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const restoreIndex = useRef<number | null>(null);
  const query = useQuery({ queryKey: ["cleanup-exceptions", offset], queryFn: ({ signal }) => getCleanupExceptions(offset, signal), retry: false });
  const revoke = useMutation({
    mutationFn: (id: string) => deleteCleanupException(id, lifetime.signal()),
    onSuccess: async (_unused, id) => {
      await client.cancelQueries({ queryKey: ["cleanup-exceptions"] });
      if (!lifetime.active()) return;
      restoreIndex.current = Math.max(0, query.data?.items.findIndex(item => item.id === id) ?? 0);
      const removed = query.data?.items.some(item => item.id === id) ? 1 : 0;
      client.setQueriesData<CleanupReviewPage<CleanupException>>({ queryKey: ["cleanup-exceptions"] }, previous => previous ? { ...previous, items: previous.items.filter(item => item.id !== id), total: Math.max(0, previous.total - removed) } : undefined);
      setFeedback(true);
      void client.invalidateQueries({ queryKey: ["cleanup-exceptions"] });
    },
  });
  const lastOffset = Math.max(0, Math.ceil((query.data?.total ?? 0) / 20) - 1) * 20;
  useEffect(() => {
    if (!query.data) return;
    if (!query.isError && offset > lastOffset) { setOffset(lastOffset); return; }
    if (restoreIndex.current !== null && !revoke.isPending) {
      const buttons = sectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-exception-revoke]");
      const button = !query.isFetching && !query.isError ? buttons?.[Math.min(restoreIndex.current, buttons.length - 1)] : null;
      restoreIndex.current = null;
      const target = button ?? sectionRef.current?.querySelector<HTMLElement>("h3");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    }
  }, [offset, lastOffset, query.data, query.isError, query.isFetching, revoke.isPending]);
  const busy = revoke.isPending || query.isFetching;
  return <section ref={sectionRef} aria-label={zh ? "我的忽略例外" : "My exceptions"} className="space-y-3 border-t border-ui pt-4">
    <div className="flex items-center justify-between gap-2"><h3 tabIndex={-1} className="text-sm font-semibold">{zh ? "我的忽略例外" : "My exceptions"}</h3><button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { setFeedback(false); void query.refetch(); }}>{query.isFetching ? (zh ? "正在读取…" : "Loading…") : (zh ? "刷新例外" : "Refresh exceptions")}</button></div>
    {feedback ? <p role="status" className="text-xs text-secondary">{zh ? "例外已撤销，后续扫描会重新检查这种情况。正文保持不变。" : "Exception revoked. Future scans will check this case again. Content is unchanged."}</p> : null}
    {query.isLoading ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {query.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{zh ? "例外读取失败，下方已有内容是上次结果。" : "Exceptions could not load. Any items below are from the previous read."}</p><button type="button" disabled={busy} className="btn-secondary mt-2 min-h-11 px-3" onClick={() => void query.refetch()}>{zh ? "重试读取" : "Retry loading"}</button></div> : null}
    {revoke.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{exceptionError(revoke.error, zh, "revoke")}</p><button type="button" disabled={busy} className="btn-secondary mt-2 min-h-11 px-3" onClick={() => revoke.mutate(revoke.variables)}>{zh ? "重试撤销" : "Retry revocation"}</button></div> : null}
    {query.isSuccess && query.data.total === 0 ? <p className="text-xs text-secondary">{zh ? "尚无长期忽略例外。" : "No persistent exceptions."}</p> : null}
    <div className="divide-y divide-[var(--border)]">{query.data?.items.map(item => <article key={item.id} className="space-y-2 py-3"><Scope item={item} zh={zh} /><button data-exception-revoke type="button" disabled={busy || query.isError || revoke.isError} onClick={() => { setFeedback(false); revoke.mutate(item.id); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "撤销此例外" : "Revoke exception"}</button></article>)}</div>
    {offset > 0 || (query.data?.total ?? 0) > 20 ? <nav aria-label={zh ? "例外分页" : "Exception pages"} className="flex items-center justify-between gap-2 text-xs">
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy || !offset || revoke.isError} onClick={() => { restoreIndex.current = 0; setOffset(Math.max(0, offset - 20)); }}>{zh ? "上一页" : "Previous"}</button>
      <span>{Math.floor(offset / 20) + 1} / {Math.max(1, Math.ceil((query.data?.total ?? offset + 1) / 20))}</span>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy || query.isError || revoke.isError || !query.data || offset + 20 >= query.data.total} onClick={() => { restoreIndex.current = 0; setOffset(offset + 20); }}>{zh ? "下一页" : "Next"}</button>
    </nav> : null}
  </section>;
}
