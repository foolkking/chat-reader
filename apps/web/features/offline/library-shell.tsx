"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FolderTree, HardDrive, Library, LoaderCircle, MessagesSquare, RefreshCw, Search, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationReader } from "../conversations/conversation-reader";
import { getOfflineCatalog, getTask, queueOfflinePackage } from "../../lib/api";
import { importOfflinePackage, offlineDb, removeOfflineConversations, requestPersistentStorage, type OfflineConversationRecord, type OfflineSearchDocument } from "../../lib/offline-db";
import { offlineReaderDataSource } from "../../lib/reader-data-source";
import { initializeOfflineSearch, searchOffline } from "../../lib/offline-search";
import type { OfflineCatalogResponse } from "../../lib/types";

type DownloadState = { key: string; progress: number; label: string } | null;
type LibraryProjectGroup = { id: string | null; name: string; conversations: OfflineConversationRecord[]; total: number };

export function LibraryShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<OfflineConversationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("conversationId"));
  const [mobileOpen, setMobileOpen] = useState(!selectedId);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [download, setDownload] = useState<DownloadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; quota: number | null; usage: number | null } | null>(null);
  const [tab, setTab] = useState<"conversations" | "projects">("conversations");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfflineSearchDocument[]>([]);
  const refreshStartedRef = useRef(false);

  const catalogQuery = useQuery({
    queryKey: ["offline-catalog"],
    queryFn: getOfflineCatalog,
    enabled: online,
    retry: 1,
  });

  const reloadLocal = useCallback(async () => {
    const rows = await offlineDb.conversations.orderBy("last_read_at").reverse().toArray();
    const fallback = rows.length ? rows : await offlineDb.conversations.orderBy("downloaded_at").reverse().toArray();
    setConversations(fallback);
    const [documents, annotations, notebooks] = await Promise.all([
      offlineDb.searchDocuments.toArray(),
      offlineDb.annotations.toArray(),
      offlineDb.notebooks.toArray(),
    ]);
    const titles = new Map(fallback.map((item) => [item.id, item.display_title]));
    const privateDocuments: OfflineSearchDocument[] = [
      ...fallback.filter((item) => item.description_markdown).map((item) => ({
        id: `description:${item.id}`,
        conversation_id: item.id,
        message_id: null,
        document_type: "description",
        role: null,
        title: item.display_title,
        plain_text: item.description_markdown ?? "",
        search_text: item.description_markdown ?? "",
        order_key: null,
        turn_index: null,
        metadata: {},
      })),
      ...annotations.filter((item) => !item.is_deleted).map((item) => ({
        id: `annotation:${item.id}`,
        conversation_id: item.conversation_id,
        message_id: item.message_id,
        document_type: "annotation",
        role: null,
        title: titles.get(item.conversation_id) ?? "批注",
        plain_text: [item.quote, item.comment_markdown].filter(Boolean).join("\n"),
        search_text: [item.quote, item.comment_markdown].filter(Boolean).join("\n"),
        order_key: null,
        turn_index: null,
        metadata: { annotation_id: item.id },
      })),
      ...notebooks.map((item) => {
        const markdown = item.blocks.filter((block) => block.type === "markdown").map((block) => block.markdown ?? "").join("\n");
        return {
          id: `notebook:${item.id}`,
          conversation_id: item.conversation_id,
          message_id: null,
          document_type: "notebook",
          role: null,
          title: item.title || titles.get(item.conversation_id) || "精选笔记",
          plain_text: markdown,
          search_text: markdown,
          order_key: null,
          turn_index: null,
          metadata: { notebook_id: item.id },
        };
      }),
    ];
    await initializeOfflineSearch([...documents, ...privateDocuments]);
    if (!selectedId && fallback[0]) setSelectedId(fallback[0].id);
    const estimate: StorageEstimate | undefined = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    setStorage({ persisted: persisted ?? false, quota: estimate?.quota ?? null, usage: estimate?.usage ?? null });
  }, [selectedId]);

  useEffect(() => { void reloadLocal(); }, [reloadLocal]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const runDownload = useCallback(async (
    scope: "conversation" | "project" | "all",
    scopeId?: string,
    silent = false,
  ) => {
    if (!navigator.onLine) {
      if (!silent) setError("当前离线，无法下载或更新资料。");
      return;
    }
    const catalog = catalogQuery.data ?? await getOfflineCatalog();
    const estimate = estimateScope(catalog, scope, scopeId);
    const storageState = await requestPersistentStorage();
    setStorage(storageState);
    const available = storageState.quota !== null && storageState.usage !== null
      ? storageState.quota - storageState.usage
      : null;
    if (available !== null && estimate > available) throw new Error("浏览器可用空间不足，原离线版本已保留。");
    const key = `${scope}:${scopeId ?? "all"}`;
    if (!silent) setDownload({ key, progress: 1, label: "正在创建离线包" });
    const queued = await queueOfflinePackage({
      scope,
      conversation_id: scope === "conversation" ? scopeId : undefined,
      project_id: scope === "project" ? scopeId : undefined,
    });
    let task = await getTask(queued.job_id);
    for (let attempt = 0; attempt < 300 && !["committed", "failed"].includes(task.status); attempt += 1) {
      if (!silent) setDownload({ key, progress: task.progress, label: task.phase });
      await delay(750);
      task = await getTask(queued.job_id);
    }
    if (task.status !== "committed") throw new Error(task.error_message ?? "离线包生成失败。");
    const packageId = String(task.result.package_id ?? queued.package_id);
    const url = String(task.result.download_url ?? `/api/offline/packages/${packageId}/download`);
    if (!silent) setDownload({ key, progress: 96, label: "正在写入离线资料库" });
    await importOfflinePackage(packageId, await fetch(url, { credentials: "same-origin" }));
    if (!silent) setDownload({ key, progress: 100, label: "已完成" });
    await reloadLocal();
    if (!silent) window.setTimeout(() => setDownload(null), 800);
  }, [catalogQuery.data, reloadLocal]);

  useEffect(() => {
    const catalog = catalogQuery.data;
    if (!catalog || !conversations.length || refreshStartedRef.current || download) return;
    const changed = conversations.filter((local) => catalog.conversations.some((remote) => remote.id === local.id && remote.revision !== local.offline_revision));
    if (!changed.length) return;
    refreshStartedRef.current = true;
    void (async () => {
      for (const conversation of changed) {
        try { await runDownload("conversation", conversation.id, true); } catch { /* Keep the previous local version. */ }
      }
      await reloadLocal();
    })();
  }, [catalogQuery.data, conversations, download, reloadLocal, runDownload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchOffline(query).then(setSearchResults);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  function openConversation(conversationId: string, messageId?: string | null) {
    setSelectedId(conversationId);
    setMobileOpen(false);
    const params = new URLSearchParams({ conversationId });
    if (messageId) params.set("messageId", messageId);
    router.replace(`/library?${params.toString()}`);
  }

  async function removeLocal(ids: string[]) {
    await removeOfflineConversations(ids);
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null);
      router.replace("/library");
    }
    await reloadLocal();
  }

  const groupedProjects = useMemo(() => {
    const map = new Map<string, LibraryProjectGroup>();
    for (const project of catalogQuery.data?.projects ?? []) {
      map.set(project.id, { id: project.id, name: project.name, conversations: [], total: project.conversation_ids.length });
    }
    for (const conversation of conversations) {
      const key = conversation.project_id ?? "unclassified";
      const current = map.get(key) ?? {
        id: conversation.project_id,
        name: conversation.project_name ?? "未分类",
        conversations: [],
        total: 0,
      };
      map.set(key, { ...current, conversations: [...current.conversations, conversation], total: Math.max(current.total, current.conversations.length + 1) });
    }
    return Array.from(map.values());
  }, [catalogQuery.data?.projects, conversations]);

  const sidebar = (
    <LibrarySidebar
      online={online}
      catalog={catalogQuery.data}
      conversations={conversations}
      selectedId={selectedId}
      tab={tab}
      setTab={setTab}
      groupedProjects={groupedProjects}
      query={query}
      setQuery={setQuery}
      searchResults={searchResults}
      download={download}
      storage={storage}
      error={error ?? (catalogQuery.isError ? catalogQuery.error.message : null)}
      onClose={() => setMobileOpen(false)}
      onOpen={openConversation}
      onDownload={(scope, id) => { setError(null); void runDownload(scope, id).catch((reason: Error) => { setError(reason.message); setDownload(null); }); }}
      onRemove={(ids) => void removeLocal(ids)}
    />
  );

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <aside className="hidden h-full w-[clamp(17rem,22vw,22rem)] shrink-0 border-r border-ui bg-sidebar md:block">{sidebar}</aside>
      {mobileOpen ? <div className="fixed inset-0 z-[80] md:hidden"><button type="button" className="absolute inset-0 bg-black/35" aria-label="关闭资料库" onClick={() => setMobileOpen(false)} /><aside className="absolute inset-y-0 left-0 w-[88vw] max-w-[22rem] border-r border-ui bg-sidebar shadow-2xl">{sidebar}</aside></div> : null}
      <section className="min-w-0 flex-1">
        {selectedId ? (
          <ConversationReader key={`${selectedId}:${searchParams.get("messageId") ?? ""}`} conversationId={selectedId} dataSource={offlineReaderDataSource} libraryMode onOpenLibrary={() => setMobileOpen(true)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Library className="h-10 w-10 text-accent" /><h1 className="mt-4 text-xl font-semibold">离线资料库</h1><p className="mt-2 max-w-sm text-sm text-secondary">选择已下载对话，或联网后从左侧下载资料。</p><button type="button" onClick={() => setMobileOpen(true)} className="mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] md:hidden">打开资料库</button></div>
        )}
      </section>
    </main>
  );
}

function LibrarySidebar({ online, catalog, conversations, selectedId, tab, setTab, groupedProjects, query, setQuery, searchResults, download, storage, error, onClose, onOpen, onDownload, onRemove }: {
  online: boolean;
  catalog?: OfflineCatalogResponse;
  conversations: OfflineConversationRecord[];
  selectedId: string | null;
  tab: "conversations" | "projects";
  setTab: (value: "conversations" | "projects") => void;
  groupedProjects: LibraryProjectGroup[];
  query: string;
  setQuery: (value: string) => void;
  searchResults: OfflineSearchDocument[];
  download: DownloadState;
  storage: { persisted: boolean; quota: number | null; usage: number | null } | null;
  error: string | null;
  onClose: () => void;
  onOpen: (conversationId: string, messageId?: string | null) => void;
  onDownload: (scope: "conversation" | "project" | "all", id?: string) => void;
  onRemove: (ids: string[]) => void;
}) {
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ui px-4"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">CR</span><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">离线资料库</h1><p className="flex items-center gap-1 text-xs text-secondary">{online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{online ? "已联网" : "离线阅读"}</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary md:hidden" aria-label="关闭"><X className="h-5 w-5" /></button></header>
    <div className="shrink-0 space-y-3 border-b border-ui p-3">
      <label className="flex min-h-10 items-center gap-2 rounded-md border border-ui bg-surface px-3"><Search className="h-4 w-4 text-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="搜索本地正文、代码与批注" /></label>
      <div className="grid grid-cols-2 rounded-md bg-subtle p-1"><button type="button" onClick={() => setTab("conversations")} className={`min-h-9 rounded px-2 text-sm ${tab === "conversations" ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}><MessagesSquare className="mr-1 inline h-4 w-4" />对话</button><button type="button" onClick={() => setTab("projects")} className={`min-h-9 rounded px-2 text-sm ${tab === "projects" ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}><FolderTree className="mr-1 inline h-4 w-4" />项目</button></div>
      {online && catalog ? <button type="button" disabled={Boolean(download)} onClick={() => onDownload("all")} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50"><Download className="h-4 w-4" />下载全部 · {formatBytes(catalog.estimated_bytes)}</button> : null}
      {download ? <div className="space-y-1" role="status"><div className="h-1.5 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${download.progress}%` }} /></div><p className="flex items-center gap-1 text-xs text-secondary"><LoaderCircle className="h-3 w-3 animate-spin" />{download.label}</p></div> : null}
      {error ? <p className="rounded-md bg-[var(--danger-soft)] px-2 py-1.5 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {query ? <SearchResultList items={searchResults} conversations={conversations} onOpen={onOpen} /> : tab === "conversations" ? <ConversationRows conversations={conversations} selectedId={selectedId} catalog={catalog} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} /> : <ProjectRows projects={groupedProjects} catalog={catalog} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />}
      {!conversations.length && !query ? <p className="px-3 py-8 text-center text-sm text-secondary">尚未下载资料</p> : null}
    </div>
    <footer className="shrink-0 border-t border-ui px-4 py-3 text-xs text-secondary"><p className="flex items-center gap-2"><HardDrive className="h-4 w-4" />{storage?.usage !== null && storage?.usage !== undefined ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota ?? 0)}` : "浏览器本地存储"}</p><p className="mt-1">{storage?.persisted ? "已启用持久化存储" : "存储可能被浏览器清理；清除站点数据会删除本地资料"}</p>{online && selectedId ? <a href={`/conversations/${selectedId}`} className="mt-2 inline-flex font-medium text-accent hover:underline">前往服务器创建 .cr 备份</a> : null}</footer>
  </div>;
}

function ConversationRows({ conversations, selectedId, catalog, onOpen, onDownload, onRemove }: { conversations: OfflineConversationRecord[]; selectedId: string | null; catalog?: OfflineCatalogResponse; onOpen: (id: string) => void; onDownload: (scope: "conversation", id: string) => void; onRemove: (ids: string[]) => void }) {
  const localIds = new Set(conversations.map((item) => item.id));
  const rows = catalog ? [...conversations, ...catalog.conversations.filter((item) => !localIds.has(item.id)).map((item) => ({ id: item.id, display_title: item.display_title, description_markdown: null, first_user_message: null, project_name: item.project_name, offline_revision: item.revision, downloaded_at: "", last_read_at: null } as OfflineConversationRecord))] : conversations;
  return <div className="space-y-1">{rows.map((conversation) => {
    const local = localIds.has(conversation.id);
    const catalogItem = catalog?.conversations.find((item) => item.id === conversation.id);
    return <div key={conversation.id} className={`group flex items-start gap-2 rounded-md px-2 py-2 ${selectedId === conversation.id ? "bg-subtle" : "hover:bg-surface"}`}>
      <button type="button" disabled={!local} onClick={() => onOpen(conversation.id)} className="min-w-0 flex-1 text-left disabled:opacity-60">
        <p className="truncate text-sm font-medium">{conversation.display_title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-secondary">{conversation.description_markdown || conversation.first_user_message || conversation.project_name || "无摘要"}</p>
        <p className="mt-1 truncate text-[11px] text-secondary">{conversation.project_name ? `${conversation.project_name} · ` : ""}{local ? `本地更新 ${formatDate(conversation.updated_at ?? conversation.downloaded_at)}` : `预计 ${formatBytes(catalogItem?.estimated_bytes ?? 0)}`}</p>
      </button>
      {local ? <button type="button" onClick={() => onRemove([conversation.id])} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-secondary opacity-70 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label="删除本地副本" title="删除本地副本"><Trash2 className="h-4 w-4" /></button> : <button type="button" onClick={() => onDownload("conversation", conversation.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-accent hover:bg-subtle" aria-label={`下载对话，预计 ${formatBytes(catalogItem?.estimated_bytes ?? 0)}`} title={`下载 · ${formatBytes(catalogItem?.estimated_bytes ?? 0)}`}><Download className="h-4 w-4" /></button>}
    </div>;
  })}</div>;
}

function ProjectRows({ projects, catalog, onOpen, onDownload, onRemove }: { projects: LibraryProjectGroup[]; catalog?: OfflineCatalogResponse; onOpen: (id: string) => void; onDownload: (scope: "project", id: string) => void; onRemove: (ids: string[]) => void }) {
  return <div className="space-y-3">{projects.map((project) => {
    const catalogProject = project.id ? catalog?.projects.find((item) => item.id === project.id) : null;
    return <section key={project.id ?? project.name}>
      <div className="flex items-center gap-2 px-2 py-1"><FolderTree className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{project.name} <span className="font-normal text-secondary">{project.conversations.length}/{project.total} · {formatBytes(catalogProject?.estimated_bytes ?? 0)}</span></h2>{catalogProject ? <button type="button" onClick={() => onDownload("project", catalogProject.id)} className="flex h-7 w-7 items-center justify-center rounded text-secondary" aria-label={project.conversations.length ? "更新项目" : "下载项目"} title={project.conversations.length ? "更新项目" : "下载项目"}>{project.conversations.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}</button> : null}{project.conversations.length ? <button type="button" onClick={() => onRemove(project.conversations.map((item) => item.id))} className="flex h-7 w-7 items-center justify-center rounded text-secondary" aria-label="删除项目本地副本" title="删除项目本地副本"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>
      {project.conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => onOpen(conversation.id)} className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-sm hover:bg-surface"><span className="truncate">{conversation.display_title}</span></button>)}
      {!project.conversations.length ? <p className="px-3 py-2 text-xs text-secondary">尚未下载</p> : null}
    </section>;
  })}</div>;
}

function SearchResultList({ items, conversations, onOpen }: { items: OfflineSearchDocument[]; conversations: OfflineConversationRecord[]; onOpen: (conversationId: string, messageId?: string | null) => void }) {
  const titles = new Map(conversations.map((item) => [item.id, item.display_title]));
  return <div className="space-y-1">{items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item.conversation_id, item.message_id)} className="w-full rounded-md px-3 py-2 text-left hover:bg-surface"><p className="truncate text-sm font-medium">{item.title || titles.get(item.conversation_id) || "对话"}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-secondary">{item.plain_text.slice(0, 240)}</p></button>)}{!items.length ? <p className="px-3 py-8 text-center text-sm text-secondary">无本地结果</p> : null}</div>;
}

function estimateScope(catalog: OfflineCatalogResponse, scope: "conversation" | "project" | "all", id?: string): number {
  if (scope === "conversation") return catalog.conversations.find((item) => item.id === id)?.estimated_bytes ?? 0;
  if (scope === "project") return catalog.projects.find((item) => item.id === id)?.estimated_bytes ?? 0;
  return catalog.estimated_bytes;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string | null): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleDateString();
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
