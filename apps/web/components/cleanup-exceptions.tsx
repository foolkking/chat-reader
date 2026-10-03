"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteCleanupException, getCleanupExceptionPreview, getCleanupExceptions, saveCleanupException } from "../lib/api";
import { cleanupRuleLabel } from "../lib/content-cleanup";
import type { CleanupException, CleanupExceptionPreview } from "../lib/types";
import { usePreferences } from "./preferences-provider";

function Scope({ item, zh }: { item: CleanupException | CleanupExceptionPreview; zh: boolean }) {
  return <div className="space-y-2 text-xs leading-5"><p className="font-medium">{cleanupRuleLabel(item.rule_name, item.detector_id, zh)} · v{item.revision} · {item.role}</p><pre className="whitespace-pre-wrap break-words rounded-lg bg-subtle p-3">{item.at_start ? (zh ? "[消息开始] " : "[Message start] ") : "…"}{item.context_before}<mark className="bg-[var(--warning-soft)] text-primary">{item.match_value}</mark>{item.context_after}{item.at_end ? (zh ? " [消息结束]" : " [Message end]") : "…"}</pre></div>;
}

export function CleanupExceptionEditor({ scanId, occurrenceId, onDone }: { scanId: string; occurrenceId: string; onDone: (saved: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const preview = useQuery({ queryKey: ["cleanup-exception-preview", scanId, occurrenceId], queryFn: () => getCleanupExceptionPreview(scanId, occurrenceId), staleTime: 0 });
  const save = useMutation({ mutationFn: () => saveCleanupException(scanId, occurrenceId, preview.data!.preview_token), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["cleanup-exceptions"] }); onDone(true); } });
  return <section className="space-y-3 rounded-lg border border-ui p-4" aria-label={zh ? "个人忽略例外" : "Personal exception"}><h3 tabIndex={-1} ref={headingRef} className="text-sm font-semibold">{zh ? "以后忽略这种情况" : "Ignore this case in future"}</h3><p className="text-xs leading-5 text-secondary">{zh ? "仅用于你的账户：规则版本、角色、匹配文本和前后最多 48 个字符都须精确相同。规则新版本或上下文变化时会重新提示。此候选本次也会保留；其他待审查项不变，可在规则库撤销。" : "Only for your account: the rule revision, role, exact text and up to 48 characters on each side must match. New rule versions or changed context are reviewed again. This candidate is kept; other pending items stay unchanged. Revoke in the rule library."}</p>{preview.isLoading ? <p role="status">{zh ? "正在读取适用范围…" : "Loading scope…"}</p> : null}{preview.data ? <Scope item={preview.data} zh={zh} /> : null}{preview.error || save.error ? <div role="alert"><p className="text-xs text-[var(--danger)]">{(preview.error ?? save.error)?.message}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { save.reset(); void preview.refetch(); }}>{zh ? "重新读取范围" : "Reload scope"}</button></div> : null}<div className="flex flex-wrap gap-2"><button type="button" disabled={save.isPending} onClick={() => onDone(false)} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消" : "Cancel"}</button><button type="button" disabled={!preview.data || preview.isFetching || save.isPending} onClick={() => save.mutate()} className="btn-secondary min-h-11 px-3 text-xs font-semibold">{save.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "确认保存个人例外" : "Confirm personal exception")}</button></div></section>;
}

export function CleanupExceptionList() {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["cleanup-exceptions", offset], queryFn: () => getCleanupExceptions(offset) });
  const revoke = useMutation({ mutationFn: deleteCleanupException, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["cleanup-exceptions"] }); if (query.data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 20)); } });
  return <section className="space-y-3 border-t border-ui pt-4"><h3 className="text-sm font-semibold">{zh ? "我的忽略例外" : "My exceptions"}</h3>{query.isLoading ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}{query.data?.total === 0 ? <p className="text-xs text-secondary">{zh ? "尚无长期忽略例外。" : "No persistent exceptions."}</p> : null}<div className="divide-y divide-[var(--border)]">{query.data?.items.map((item) => <article key={item.id} className="space-y-2 py-3"><Scope item={item} zh={zh} /><button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "撤销此例外" : "Revoke exception"}</button></article>)}</div>{query.data && query.data.total > 20 ? <nav className="flex items-center justify-between gap-2 text-xs"><button type="button" className="btn-secondary min-h-11 px-3" disabled={!offset} onClick={() => setOffset(offset - 20)}>{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + 20, query.data.total)} / {query.data.total}</span><button type="button" className="btn-secondary min-h-11 px-3" disabled={offset + 20 >= query.data.total} onClick={() => setOffset(offset + 20)}>{zh ? "下一页" : "Next"}</button></nav> : null}{query.error || revoke.error ? <div role="alert"><p className="text-xs text-[var(--danger)]">{(query.error ?? revoke.error)?.message}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void query.refetch()}>{zh ? "重试读取" : "Retry loading"}</button></div> : null}</section>;
}
