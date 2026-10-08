"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useLayoutEffect, useEffect } from "react";
import { adminApi } from "../lib/admin-client";
import { AdminNoisePublicationRow } from "./admin-noise-publication-row";
import { usePreferences } from "./preferences-provider";

export function AdminNoiseRuleSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [offset, setOffset] = useState(0);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: ["admin-noise-rules", offset], queryFn: ({ signal }) => adminApi.noiseRules(offset, signal), staleTime: 0, retry: false });
  useLayoutEffect(() => { onDirtyChange?.(dirtyRows.size > 0); }, [dirtyRows, onDirtyChange]);
  useEffect(() => { if (query.isSuccess && !query.isFetching && !dirtyRows.size && offset > 0 && offset >= query.data.total) setOffset(Math.max(0, Math.ceil(query.data.total / 20) - 1) * 20); }, [query.isSuccess, query.isFetching, query.data, dirtyRows.size, offset]);
  return <section className="space-y-4">
    {query.isFetching ? <p role="status">{zh ? "正在读取候选规则…" : "Loading candidate rules…"}</p> : null}
    {query.error ? <Retry busy={query.isFetching} retry={() => void query.refetch()} zh={zh} /> : null}
    {query.isSuccess && query.data.total === 0 ? <p className="text-sm text-secondary">{zh ? "尚无已学习的文本规则。" : "No learned text rules yet."}</p> : null}
    <div className="divide-y divide-[var(--border)]">{query.data?.items.map((rule) => <AdminNoisePublicationRow key={rule.id} rule={rule} unavailable={query.isError || query.isFetching} onDirtyChange={(dirty) => setDirtyRows((previous) => { if (previous.has(rule.id) === dirty) return previous; const next = new Set(previous); if (dirty) next.add(rule.id); else next.delete(rule.id); return next; })} />)}</div>
    {query.data ? <Pages total={query.data.total} offset={offset} onChange={setOffset} disabled={dirtyRows.size > 0 || query.isFetching || query.isError} zh={zh} /> : null}
  </section>;
}

function Retry({ busy, retry, zh }: { busy: boolean; retry: () => void; zh: boolean }) {
  return <div role="alert"><p className="text-xs text-[var(--danger)]">{zh ? "规则读取失败。已有内容保留，重新读取后再操作。" : "Rules could not load. Previous entries remain; reload before making changes."}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={busy} onClick={retry}>{zh ? "重试读取规则" : "Retry loading rules"}</button></div>;
}

function Pages({ total, offset, onChange, disabled, zh }: { total: number; offset: number; onChange: (next: number) => void; disabled: boolean; zh: boolean }) {
  if (total <= 20) return null;
  return <nav aria-label={zh ? "规则分页" : "Rule pages"} className="flex flex-wrap items-center justify-between gap-2 text-xs"><button type="button" disabled={disabled || !offset} className="btn-secondary min-h-11 px-3" onClick={() => onChange(Math.max(0, offset - 20))}>{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + 20, total)} / {total}</span><button type="button" disabled={disabled || offset + 20 >= total} className="btn-secondary min-h-11 px-3" onClick={() => onChange(offset + 20)}>{zh ? "下一页" : "Next"}</button></nav>;
}
