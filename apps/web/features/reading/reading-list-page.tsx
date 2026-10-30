"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, deleteUserFeatureEntry, getReadingListSummary, getUserFeatureEntries, saveUserFeatureEntry } from "../../lib/api";
import type { ReadingListSummaryItem, ReadingListValue } from "../../lib/types";
import { authenticationGeneration } from "../../lib/offline-access";
import { usePreferences } from "../../components/preferences-provider";
import { CollectionFilters, CollectionPagination, collectionControlClass, useCollectionScroll, useCollectionView } from "../../components/collection-view";
import { formatActivityTime } from "../../lib/activity-time";
import { readingListQueryKey } from "./reading-list-button";

type Action = "read" | "unread" | "remove";
type ItemResult = { id: string; title: string; outcome: "saved" | "confirmed" | "different" | "rejected" | "unknown" | "not_sent" };

export function ReadingListPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const view = useCollectionView(20);
  const { params, scope, offset, update, rootRef } = view;
  const state = params.get("state") ?? "unread";
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["reading-list-summary", scope], queryFn: ({ signal }) => getReadingListSummary(params, signal), staleTime: 15_000 });
  const items = query.data?.items ?? [];
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
  const selected = selection.scope === scope ? selection.ids.filter(id => items.some(item => item.entry.id === id)) : [];
  const [busy, setBusy] = useState(false);
  const lease = useRef(false);
  const mounted = useRef(true);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [confirm, setConfirm] = useState<ReadingListSummaryItem[] | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setConfirm(null); setNotice(null); setResults([]); }, [scope]);
  useCollectionScroll(rootRef, scope, Boolean(query.data));

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["reading-list-summary"] }), queryClient.invalidateQueries({ queryKey: readingListQueryKey })]);
  }
  async function apply(action: Action, targets: ReadingListSummaryItem[]) {
    if (lease.current || !targets.length) return;
    lease.current = true; setBusy(true); setConfirm(null); setNotice(null); setResults([]);
    const generation = authenticationGeneration();
    const active = () => mounted.current && generation === authenticationGeneration() && scopeRef.current === scope;
    const completed: ItemResult[] = [];
    try {
      for (const item of targets) {
        if (!active()) break;
        const { entry } = item;
        let outcome: ItemResult["outcome"] = "saved";
        try {
          if (action === "remove") await deleteUserFeatureEntry("reading-list", entry.id, entry.revision);
          else await saveUserFeatureEntry("reading-list", entry.id, { expected_revision: entry.revision, value: { ...entry.value, state: action } });
        } catch (error) {
          // Never replay a write, including on response loss or CAS conflict.
          outcome = error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status) ? "rejected" : "unknown";
          if (outcome === "unknown") {
            try {
              const current = (await getUserFeatureEntries<ReadingListValue>("reading-list")).find(row => row.id === entry.id);
              outcome = (action === "remove" && !current) || (action !== "remove" && current?.value.state === action) ? "confirmed" : "different";
            } catch { outcome = "unknown"; }
          }
        }
        if (!active()) break;
        completed.push({ id: entry.id, title: item.title || (zh ? "不可用条目" : "Unavailable entry"), outcome });
        setResults([...completed]);
        setNotice(zh ? `已处理 ${completed.length} / ${targets.length}` : `Processed ${completed.length} / ${targets.length}`);
        if (outcome === "unknown") break;
      }
      if (active()) {
        for (const item of targets.slice(completed.length)) completed.push({ id: item.entry.id, title: item.title || (zh ? "不可用条目" : "Unavailable entry"), outcome: "not_sent" });
        setResults([...completed]);
        setNotice(zh ? "操作结束。下方保留逐项结果；未确认的操作没有自动重试。" : "Finished. Review each result below; unconfirmed writes were not replayed.");
        setSelection({ scope, ids: [] });
        await refresh().catch(() => {}); // The query's own error/retry surface owns refresh failures.
      }
    } finally {
      lease.current = false;
      if (mounted.current && generation === authenticationGeneration()) setBusy(false);
    }
    lease.current = false;
  }

  return <section ref={rootRef} className="space-y-4" aria-busy={query.isFetching || busy}>
    <div className="flex flex-wrap gap-2" aria-label={zh ? "阅读状态" : "Reading status"}>
      {(["unread", "read", "all"] as const).map(value => <button key={value} className={`min-h-11 rounded-lg px-3 text-sm ${state === value ? "bg-subtle font-semibold text-primary" : "text-secondary hover:bg-subtle"}`} aria-pressed={state === value} disabled={busy} onClick={() => update({ state: value })}>
        {value === "unread" ? (zh ? "待读" : "Unread") : value === "read" ? (zh ? "已读" : "Read") : (zh ? "全部" : "All")} {query.data ? `(${query.data.counts[value]})` : ""}
      </button>)}
    </div>
    <CollectionFilters q={params.get("q") ?? ""} projectId={params.get("project_id") ?? ""} zh={zh} update={update} disabled={busy}>
      <label className="text-xs text-secondary">{zh ? "排序" : "Sort"}<select className={`${collectionControlClass} mt-1 block`} value={params.get("sort") ?? "added_desc"} disabled={busy} onChange={event => update({ sort: event.target.value })}>
        <option value="added_desc">{zh ? "最近加入" : "Newest added"}</option><option value="added_asc">{zh ? "最早加入" : "Oldest added"}</option><option value="last_read">{zh ? "最近阅读" : "Last reading position"}</option>
      </select></label>
    </CollectionFilters>
    {query.isPending ? <p role="status" className="py-6 text-sm text-secondary">{zh ? "正在读取待读清单…" : "Loading reading list…"}</p> : null}
    {query.isError ? <div role="alert" className="text-sm text-[var(--danger)]">{zh ? "清单暂时读取失败，请重试；不会删除已有条目。" : "Could not load the list. Retry; no entries have been deleted."}<button className="min-h-11 px-3 underline" onClick={() => void query.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
    {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
    {results.length ? <details className="border-y border-ui py-2" open><summary className="min-h-11 cursor-pointer py-3 text-sm">{zh ? "逐项操作结果" : "Per-item results"}</summary><ul className="space-y-2 text-sm">{results.map(result => <li key={result.id} className="flex flex-wrap justify-between gap-2"><span className="break-words">{result.title}</span><span className="text-secondary">{({
      saved: zh ? "保存已确认" : "Save acknowledged", confirmed: zh ? "只读核对一致" : "Confirmed by read-only check",
      different: zh ? "当前状态不同，请查看清单" : "Current state differs; review the list", rejected: zh ? "请求被拒绝" : "Request rejected",
      unknown: zh ? "结果未知，请刷新核对" : "Outcome unknown; refresh to check", not_sent: zh ? "尚未发送" : "Not sent",
    })[result.outcome]}</span></li>)}</ul></details> : null}
    {items.length ? <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy || !query.isSuccess} checked={selected.length === items.length} onChange={event => setSelection({ scope, ids: event.target.checked ? items.map(item => item.entry.id) : [] })} />{zh ? `本页已选 ${selected.length}` : `${selected.length} selected on this page`}</label>
        {selected.length ? <>{(["read", "unread", "remove"] as const).map(action => <button key={action} className="btn-secondary min-h-11 px-3 text-xs" disabled={busy || !query.isSuccess} onClick={() => {
          const targets = items.filter(item => selected.includes(item.entry.id));
          if (action === "remove") setConfirm(targets); else void apply(action, targets);
        }}>{action === "read" ? (zh ? "标为已读" : "Mark read") : action === "unread" ? (zh ? "标为待读" : "Mark unread") : (zh ? "移出清单" : "Remove")}</button>)}</> : null}
      </div>
      {confirm ? <div className="border-y border-ui py-3 text-sm"><p>{zh ? `移出 ${confirm.length} 项？不会删除对话。` : `Remove ${confirm.length} entries? Conversations will not be deleted.`}</p><button className="btn-secondary mt-2 min-h-11 px-3" onClick={() => void apply("remove", confirm)}>{zh ? "确认移出" : "Confirm removal"}</button><button className="min-h-11 px-3" onClick={() => setConfirm(null)}>{zh ? "取消" : "Cancel"}</button></div> : null}
      <div className="divide-y divide-ui border-y border-ui">{items.map(item => <article key={item.entry.id} className="flex min-w-0 items-start gap-3 py-4" data-testid={`reading-list-item-${item.entry.value.conversation_id}`}>
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" disabled={busy || !query.isSuccess} aria-label={`${zh ? "选择" : "Select"} ${item.title ?? (zh ? "不可用条目" : "Unavailable entry")}`} checked={selected.includes(item.entry.id)} onChange={event => setSelection({ scope, ids: event.target.checked ? [...selected, item.entry.id] : selected.filter(id => id !== item.entry.id) })} /></label>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-sm font-semibold text-primary">{item.available ? <Link href={`/conversations/${item.entry.value.conversation_id}`} className="hover:text-accent">{item.title || (zh ? "未命名对话" : "Untitled")}</Link> : (zh ? "对话不可用" : "Conversation unavailable")}</h2>
          <p className="mt-1 text-xs text-secondary">{item.projects.map(project => project.name).join(" · ") || (zh ? "未归类" : "Unclassified")} · {zh ? "加入于 " : "Added "}{formatActivityTime(item.entry.created_at, resolvedLocale)}</p>
          {item.last_read_at ? <p className="mt-1 text-xs text-secondary">{zh ? "阅读位置保存于 " : "Position saved "}{formatActivityTime(item.last_read_at, resolvedLocale)}</p> : null}
          {!item.available ? <p className="mt-1 text-xs text-secondary">{zh ? "当前无法读取此对话，可重试清单或移出此项。" : "This conversation is unavailable. Refresh the list or remove this entry."}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {item.available ? <Link className="inline-flex min-h-11 items-center text-sm font-medium text-accent" href={`/conversations/${item.entry.value.conversation_id}`}>{item.resume_available ? (zh ? "继续阅读" : "Continue reading") : (zh ? "开始阅读" : "Start reading")}</Link> : null}
            <button className="min-h-11 px-2 text-xs text-secondary hover:bg-subtle" disabled={busy || !query.isSuccess} onClick={() => void apply(item.entry.value.state === "read" ? "unread" : "read", [item])}>{item.entry.value.state === "read" ? (zh ? "标为待读" : "Mark unread") : (zh ? "标为已读" : "Mark read")}</button>
            <button className="min-h-11 px-2 text-xs text-secondary hover:bg-subtle" disabled={busy || !query.isSuccess} onClick={() => void apply("remove", [item])}>{zh ? "移出清单" : "Remove"}</button>
          </div>
        </div>
      </article>)}</div>
    </> : query.isSuccess ? <div className="state-empty border-y border-ui text-sm text-secondary"><p>{query.data.counts.all ? (zh ? "当前状态下没有条目。" : "No entries in this state.") : (zh ? "没有符合条件的条目；可清除筛选，或把需要稍后阅读的对话加入清单。" : "No matching entries. Clear filters or add a conversation to read later.")}</p><button className="mt-2 min-h-11 text-accent" onClick={() => update({ q: "", project_id: "", state: "all" })}>{zh ? "显示全部" : "Show all"}</button><Link href="/recent" className="ml-4 text-accent">{zh ? "最近阅读" : "Recent reading"}</Link></div> : null}
    {query.data ? <CollectionPagination offset={offset} limit={20} hasMore={query.data.has_more} busy={busy || query.isFetching} zh={zh} update={update} /> : null}
  </section>;
}
