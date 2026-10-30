"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getProjects } from "../lib/api";
import { authenticationGeneration } from "../lib/offline-access";

// Scroll-only, bounded to this tab/account epoch. Do not persist search text in
// sessionStorage keys or carry one account's collection position into another.
const positions = new Map<string, number>();
let positionGeneration = -1;

// Quiet archive-ledger controls: existing paper/ink tokens, 4px spacing,
// restrained borders and the application font. Search leads, metadata follows.
export function useCollectionView(pageSize: number) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const params = new URLSearchParams(search?.toString());
  const raw = Number(params.get("offset") ?? 0);
  const offset = Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
  params.set("offset", String(offset));
  params.set("limit", String(pageSize));
  const scope = `${pathname}?${params}`;
  const rootRef = useRef<HTMLElement>(null);
  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(search?.toString());
    next.delete("offset");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  return { params, offset, scope, rootRef, update };
}

export function useCollectionScroll(rootRef: React.RefObject<HTMLElement | null>, scope: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const scroller = rootRef.current?.closest<HTMLElement>("[data-collection-scroll]");
    if (!scroller) return;
    const generation = authenticationGeneration();
    if (positionGeneration !== generation) { positions.clear(); positionGeneration = generation; }
    scroller.scrollTop = Math.max(0, positions.get(scope) ?? 0);
    const save = () => {
      if (authenticationGeneration() !== generation) return;
      positions.delete(scope);
      positions.set(scope, scroller.scrollTop);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
    scroller.addEventListener("scroll", save, { passive: true });
    return () => { save(); scroller.removeEventListener("scroll", save); };
  }, [ready, rootRef, scope]);
}

export const collectionControlClass = "min-h-11 rounded-lg border border-ui bg-surface px-3 text-base text-primary md:text-sm";

export function CollectionFilters({ q, projectId, zh, update, children, disabled = false }: {
  q: string; projectId: string; zh: boolean; update: (changes: Record<string, string>) => void;
  children?: React.ReactNode; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const projects = useQuery({ queryKey: ["projects", "search-filter"],
    queryFn: ({ signal }) => getProjects({ sort: "custom", direction: "asc" }, signal), staleTime: 60_000 });
  return <div className="flex flex-wrap items-end gap-3 border-b border-ui pb-4">
    <form className="flex min-w-0 flex-1 items-end gap-2" onSubmit={event => { event.preventDefault(); update({ q: draft.trim() }); }}>
      <label className="min-w-0 flex-1 text-xs text-secondary">{zh ? "关键词" : "Keywords"}
        <input className={`${collectionControlClass} mt-1 w-full`} value={draft} maxLength={200} disabled={disabled}
          onChange={event => setDraft(event.target.value)} type="search" />
      </label>
      <button className="btn-secondary min-h-11 px-3 text-sm" disabled={disabled}>{zh ? "搜索" : "Search"}</button>
    </form>
    <label className="text-xs text-secondary">{zh ? "项目" : "Project"}
      <select className={`${collectionControlClass} mt-1 block max-w-56`} value={projectId} disabled={disabled || projects.isError}
        onChange={event => update({ project_id: event.target.value })}>
        <option value="">{zh ? "全部项目" : "All projects"}</option>
        {(projects.data ?? []).filter(item => !item.is_default).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {projectId && !(projects.data ?? []).some(item => item.id === projectId) ? <option value={projectId}>{zh ? "当前项目" : "Selected project"}</option> : null}
      </select>
    </label>
    {projects.isError ? <button className="min-h-11 text-xs text-accent" onClick={() => void projects.refetch()}>{zh ? "重试项目筛选" : "Retry projects"}</button> : null}
    {children}
  </div>;
}

export function CollectionPagination({ offset, limit, hasMore, busy, zh, update }: {
  offset: number; limit: number; hasMore: boolean; busy: boolean; zh: boolean;
  update: (changes: Record<string, string>) => void;
}) {
  if (!offset && !hasMore) return null;
  return <nav className="flex items-center justify-between gap-3 border-t border-ui pt-3" aria-label={zh ? "列表分页" : "List pages"}>
    <button className="btn-secondary min-h-11 px-3 text-sm" disabled={!offset || busy} onClick={() => update({ offset: String(Math.max(0, offset - limit)) })}>{zh ? "上一页" : "Previous"}</button>
    <span className="text-xs text-secondary">{zh ? `第 ${Math.floor(offset / limit) + 1} 页` : `Page ${Math.floor(offset / limit) + 1}`}</span>
    <button className="btn-secondary min-h-11 px-3 text-sm" disabled={!hasMore || busy} onClick={() => update({ offset: String(offset + limit) })}>{zh ? "下一页" : "Next"}</button>
  </nav>;
}
