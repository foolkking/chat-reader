"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FolderTree, HardDrive, Library, LoaderCircle, PanelLeftClose, RefreshCw, Search, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ConversationReader } from "../conversations/conversation-reader";
import { getOfflineCatalog, getTask, queueOfflinePackage } from "../../lib/api";
import { importOfflinePackage, offlineDb, removeOfflineConversations, requestPersistentStorage, type OfflineConversationRecord, type OfflineSearchDocument } from "../../lib/offline-db";
import { offlineReaderDataSource } from "../../lib/reader-data-source";
import { initializeOfflineSearch, searchOffline } from "../../lib/offline-search";
import { getOfflineShellStatus, prepareOfflineShell, subscribeOfflineShellStatus, type OfflineShellStatus } from "../../lib/offline-shell";
import type { OfflineCatalogConversation, OfflineCatalogResponse } from "../../lib/types";
import { ReaderSidebarFrame } from "../../components/reader-sidebar-frame";
import { SidebarPreferences } from "../../components/sidebar-preferences";
import { usePreferences } from "../../components/preferences-provider";
import { MobilePageHeader } from "../../components/mobile-page-header";

type DownloadState = { key: string; progress: number; label: string } | null;
type OfflineAssetMode = "none" | "small" | "all";
type LibrarySidebarConversation = {
  id: string;
  displayTitle: string;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string | null;
  local: OfflineConversationRecord | null;
  catalog: OfflineCatalogConversation | null;
};
type LibraryProjectGroup = { id: string; name: string; conversations: LibrarySidebarConversation[]; total: number };
const APP_TITLE = "chat-reader";
const LAST_LIBRARY_CONVERSATION_KEY = "chat-reader:last-library-conversation";

export function LibraryShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [conversations, setConversations] = useState<OfflineConversationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams?.get("conversationId") ?? null);
  const [mobileOpen, setMobileOpen] = useState(!selectedId);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [download, setDownload] = useState<DownloadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; quota: number | null; usage: number | null } | null>(null);
  const [assetMode, setAssetMode] = useState<OfflineAssetMode>("all");
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);
  const [readerFocusMode, setReaderFocusMode] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfflineSearchDocument[]>([]);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);
  const autoRefreshRunningRef = useRef(false);
  const selectedConversation = selectedId ? conversations.find((item) => item.id === selectedId) ?? null : null;
  const offlineShellStatus = useSyncExternalStore(
    subscribeOfflineShellStatus,
    getOfflineShellStatus,
    getOfflineShellStatus,
  );

  // A cached Library navigation can complete without replaying the global
  // window-load hook that normally starts shell reconciliation. Keep the
  // status indicator truthful by retrying the same idempotent preparation
  // from the page that owns the offline shell.
  useEffect(() => {
    if (offlineShellStatus.availability !== "unknown" && offlineShellStatus.updatePhase !== "checking") return;
    void prepareOfflineShell().catch(() => undefined);
  }, [offlineShellStatus.availability, offlineShellStatus.updatePhase]);

  const catalogQuery = useQuery({
    queryKey: ["offline-catalog"],
    queryFn: getOfflineCatalog,
    enabled: online,
    retry: 1,
  });
  const requestedCatalogConversation = selectedId && !selectedConversation
    ? catalogQuery.data?.conversations.find((item) => item.id === selectedId) ?? null
    : null;
  const titleConversation = selectedConversation ?? requestedCatalogConversation;

  useEffect(() => {
    // ConversationReader owns the title while an offline copy is open. Keeping
    // this fallback out of that path prevents the parent effect from restoring
    // the generic app title after the reader has resolved its conversation.
    if (!selectedConversation) {
      document.title = titleConversation ? formatLibraryConversationTitle(titleConversation) : APP_TITLE;
    }
  }, [selectedConversation, titleConversation]);

  const reloadLocal = useCallback(async () => {
    const fallback = await offlineDb.conversations.toArray();
    fallback.sort((left, right) => libraryActivityTime(right) - libraryActivityTime(left));
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
    if (!selectedId && fallback[0]) {
      const rememberedId = window.localStorage.getItem(LAST_LIBRARY_CONVERSATION_KEY);
      setSelectedId(fallback.find((item) => item.id === rememberedId)?.id ?? fallback[0].id);
    }
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
  useEffect(() => {
    setDesktopSidebarExpanded(window.localStorage.getItem("chat-reader:reader-sidebar-expanded") !== "false");
    const storedAssetMode = window.localStorage.getItem("chat-reader:offline-asset-mode");
    if (storedAssetMode === "none" || storedAssetMode === "small" || storedAssetMode === "all") setAssetMode(storedAssetMode);
  }, []);

  const updateAssetMode = useCallback((value: OfflineAssetMode) => {
    setAssetMode(value);
    window.localStorage.setItem("chat-reader:offline-asset-mode", value);
  }, []);

  const setLibrarySidebarExpanded = useCallback((expanded: boolean) => {
    setDesktopSidebarExpanded(expanded);
    window.localStorage.setItem("chat-reader:reader-sidebar-expanded", String(expanded));
  }, []);

  const runDownload = useCallback(async (
    scope: "conversation" | "project" | "all",
    scopeId?: string,
    silent = false,
  ) => {
    const catalog = catalogQuery.data ?? await getOfflineCatalog();
    const scopedLocal = conversations.filter((conversation) => (
      scope === "all"
      || (scope === "conversation" && conversation.id === scopeId)
      || (scope === "project" && conversation.project_id === scopeId)
    ));
    const knownRevisions = Object.fromEntries(
      scopedLocal.map((conversation) => [conversation.id, conversation.offline_revision]),
    );
    const estimate = estimateScope(catalog, scope, scopeId, knownRevisions);
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
      known_revisions: knownRevisions,
      include_assets: assetMode,
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
  }, [assetMode, catalogQuery.data, conversations, reloadLocal]);

  useEffect(() => {
    const catalog = catalogQuery.data;
    if (!catalog || !conversations.length || download || autoRefreshRunningRef.current) return;
    const changed = conversations.filter((local) => catalog.conversations.some((remote) => remote.id === local.id && remote.revision !== local.offline_revision));
    const refreshKey = changed
      .map((local) => `${local.id}:${catalog.conversations.find((remote) => remote.id === local.id)?.revision ?? "missing"}`)
      .sort()
      .join("|");
    if (!refreshKey || lastAutoRefreshKeyRef.current === refreshKey) return;
    lastAutoRefreshKeyRef.current = refreshKey;
    autoRefreshRunningRef.current = true;
    void (async () => {
      let failed = false;
      try {
        for (const conversation of changed) {
          try {
            await runDownload("conversation", conversation.id, true);
          } catch {
            failed = true;
          }
        }
        await reloadLocal();
        if (failed) setError("部分离线对话未能更新，旧版本已保留。可联网后手动重试。");
      } finally {
        autoRefreshRunningRef.current = false;
      }
    })();
  }, [catalogQuery.data, conversations, download, reloadLocal, runDownload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchOffline(query).then(setSearchResults);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  function openConversation(conversationId: string, messageId?: string | null, blockIndex?: number | null, characterOffset?: number | null) {
    setSelectedId(conversationId);
    window.localStorage.setItem(LAST_LIBRARY_CONVERSATION_KEY, conversationId);
    setMobileOpen(false);
    const params = new URLSearchParams({ conversationId });
    if (messageId) params.set("messageId", messageId);
    if (blockIndex !== null && blockIndex !== undefined) params.set("blockIndex", String(blockIndex));
    if (characterOffset !== null && characterOffset !== undefined) params.set("characterOffset", String(characterOffset));
    router.replace(`/library?${params.toString()}`);
  }

  async function removeLocal(ids: string[]) {
    await removeOfflineConversations(ids);
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null);
      window.localStorage.removeItem(LAST_LIBRARY_CONVERSATION_KEY);
      router.replace("/library");
    }
    await reloadLocal();
  }

  const sidebarConversations = useMemo(
    () => mergeLibraryConversations(conversations, catalogQuery.data),
    [catalogQuery.data, conversations],
  );
  const groupedProjects = useMemo(() => {
    const map = new Map<string, LibraryProjectGroup>();
    for (const project of catalogQuery.data?.projects ?? []) {
      map.set(project.id, { id: project.id, name: project.name, conversations: [], total: project.conversation_ids.length });
    }
    for (const conversation of sidebarConversations) {
      if (!conversation.projectId) continue;
      const key = conversation.projectId;
      const current = map.get(key) ?? {
        id: conversation.projectId,
        name: conversation.projectName ?? "项目",
        conversations: [],
        total: 0,
      };
      map.set(key, { ...current, conversations: [...current.conversations, conversation], total: Math.max(current.total, current.conversations.length + 1) });
    }
    return Array.from(map.values());
  }, [catalogQuery.data?.projects, sidebarConversations]);
  const unclassifiedConversations = useMemo(
    () => sidebarConversations.filter((conversation) => !conversation.projectId),
    [sidebarConversations],
  );

  const sidebar = (
    <LibrarySidebar
      online={online}
      catalog={catalogQuery.data}
      conversations={conversations}
      sidebarConversations={sidebarConversations}
      unclassifiedConversations={unclassifiedConversations}
      selectedId={selectedId}
      groupedProjects={groupedProjects}
      query={query}
      setQuery={setQuery}
      searchResults={searchResults}
      download={download}
      storage={storage}
      assetMode={assetMode}
      offlineShellStatus={offlineShellStatus}
      error={error ?? (catalogQuery.isError ? catalogQuery.error.message : null)}
      onClose={() => setMobileOpen(false)}
      onCollapse={() => setLibrarySidebarExpanded(false)}
      onOpen={openConversation}
      onDownload={(scope, id) => { setError(null); void runDownload(scope, id).catch((reason: Error) => { setError(reason.message); setDownload(null); }); }}
      onAssetModeChange={updateAssetMode}
      onRetryShell={() => { setError(null); void prepareOfflineShell({ force: true }).catch((reason: Error) => setError(reason.message)); }}
      onRemove={(ids) => void removeLocal(ids)}
    />
  );
  const readerContent = selectedId && selectedConversation ? (
    <ConversationReader key={`${selectedId}:${selectedConversation.offline_revision}:${searchParams?.get("messageId") ?? ""}:${searchParams?.get("blockIndex") ?? ""}:${searchParams?.get("characterOffset") ?? ""}`} conversationId={selectedId} dataSource={offlineReaderDataSource} libraryMode onOpenLibrary={() => setMobileOpen(true)} onFocusModeChange={setReaderFocusMode} />
  ) : requestedCatalogConversation ? (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Library className="h-10 w-10 text-accent" /><h1 className="mt-4 max-w-xl text-xl font-semibold">{requestedCatalogConversation.display_title}</h1><p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "该对话尚未下载到离线资料库。联网后可从资料库下载，下载完成后会在这里离线阅读。" : "This conversation has not been downloaded. Connect to download it for offline reading."}</p><button type="button" disabled={!online || Boolean(download)} onClick={() => { setError(null); void runDownload("conversation", requestedCatalogConversation.id).catch((reason: Error) => { setError(reason.message); setDownload(null); }); }} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50"><Download className="h-4 w-4" />{zh ? "下载离线副本" : "Download offline copy"}</button><button type="button" onClick={() => setMobileOpen(true)} className="mt-3 min-h-10 rounded-md border border-ui px-4 text-sm font-medium text-primary">{zh ? "打开资料库" : "Open library"}</button></div>
  ) : selectedId ? (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center"><AlertTriangle className="h-10 w-10 text-amber-600" /><h1 className="mt-4 text-xl font-semibold">{zh ? "该对话尚未下载" : "Conversation not downloaded"}</h1><p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "当前离线资料库中没有这个对话。联网后打开资料库即可下载。" : "This conversation is not in the offline library. Connect to download it."}</p><button type="button" onClick={() => setMobileOpen(true)} className="mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)]">{zh ? "打开资料库" : "Open library"}</button></div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Library className="h-10 w-10 text-accent" /><h1 className="mt-4 text-xl font-semibold">{zh ? "离线资料库" : "Offline library"}</h1><p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "选择已下载对话，或联网后打开资料库下载。" : "Choose a downloaded conversation, or connect to add one."}</p><button type="button" onClick={() => setMobileOpen(true)} className="mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)]">{zh ? "打开资料库" : "Open library"}</button></div>
  );

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      {!readerFocusMode ? <ReaderSidebarFrame
        desktopExpanded={desktopSidebarExpanded}
        onDesktopExpand={() => setLibrarySidebarExpanded(true)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        railExtra={<Library className="mt-4 h-4 w-4 text-accent" aria-hidden="true" />}
      >
        {sidebar}
      </ReaderSidebarFrame> : null}
      <section className="flex min-w-0 flex-1 flex-col">
        {!selectedConversation && !readerFocusMode ? (
          <MobilePageHeader
            title={zh ? "离线资料库" : "Offline library"}
            description={zh ? "选择或下载对话以离线阅读" : "Choose or download a conversation to read offline"}
            onOpenSidebar={() => setMobileOpen(true)}
            className="md:hidden"
          />
        ) : null}
        <div className="min-h-0 flex-1">{readerContent}</div>
      </section>
    </main>
  );
}

function formatLibraryConversationTitle(conversation: { display_title: string; project_name?: string | null }): string {
  const title = conversation.display_title.trim() || APP_TITLE;
  const project = conversation.project_name?.trim();
  return project ? `${project} / ${title}` : title;
}

function LibrarySidebar({ online, catalog, conversations, sidebarConversations, unclassifiedConversations, selectedId, groupedProjects, query, setQuery, searchResults, download, storage, assetMode, offlineShellStatus, error, onClose, onCollapse, onOpen, onDownload, onAssetModeChange, onRetryShell, onRemove }: {
  online: boolean;
  catalog?: OfflineCatalogResponse;
  conversations: OfflineConversationRecord[];
  sidebarConversations: LibrarySidebarConversation[];
  unclassifiedConversations: LibrarySidebarConversation[];
  selectedId: string | null;
  groupedProjects: LibraryProjectGroup[];
  query: string;
  setQuery: (value: string) => void;
  searchResults: OfflineSearchDocument[];
  download: DownloadState;
  storage: { persisted: boolean; quota: number | null; usage: number | null } | null;
  assetMode: OfflineAssetMode;
  offlineShellStatus: OfflineShellStatus;
  error: string | null;
  onClose: () => void;
  onCollapse: () => void;
  onOpen: (conversationId: string, messageId?: string | null, blockIndex?: number | null, characterOffset?: number | null) => void;
  onDownload: (scope: "conversation" | "project" | "all", id?: string) => void;
  onAssetModeChange: (value: OfflineAssetMode) => void;
  onRetryShell: () => void;
  onRemove: (ids: string[]) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const selectedProjectId = sidebarConversations.find((conversation) => conversation.id === selectedId)?.projectId ?? null;
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(selectedProjectId ? [selectedProjectId] : []));
  useEffect(() => {
    if (!selectedProjectId) return;
    setExpandedProjects((current) => current.has(selectedProjectId) ? current : new Set([...current, selectedProjectId]));
  }, [selectedProjectId]);
  const knownRevisions = Object.fromEntries(conversations.map((conversation) => [conversation.id, conversation.offline_revision]));
  const pendingSummary = catalog ? summarizeScope(catalog, "all", undefined, knownRevisions) : { bytes: 0, count: 0 };
  const onlineHref = selectedId ? `/conversations/${selectedId}` : "/";
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ui px-4"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">CR</span><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{zh ? "离线资料库" : "Offline library"}</h1><p className="flex items-center gap-1 text-xs text-secondary">{online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{online ? (zh ? "已联网" : "Online") : (zh ? "离线阅读" : "Offline reading")}</p></div><button type="button" onClick={onCollapse} className="hidden h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-surface md:flex" aria-label={zh ? "收起侧栏" : "Collapse sidebar"} title={zh ? "收起侧栏" : "Collapse sidebar"}><PanelLeftClose className="h-5 w-5" /></button><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary md:hidden" aria-label={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button></header>
    <div className="shrink-0 space-y-3 border-b border-ui p-3">
      <label className="flex min-h-10 items-center gap-2 rounded-md border border-ui bg-surface px-3"><Search className="h-4 w-4 text-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={zh ? "搜索本地正文、代码与批注" : "Search offline text, code, and annotations"} /></label>
      <OfflineShellIndicator status={offlineShellStatus} online={online} onRetry={onRetryShell} />
      {online && catalog ? <label className="grid gap-1 text-xs text-secondary"><span>{zh ? "离线附件" : "Offline attachments"}</span><select value={assetMode} onChange={(event) => onAssetModeChange(event.target.value as OfflineAssetMode)} disabled={Boolean(download)} className="min-h-9 rounded-md border border-ui bg-surface px-2 text-sm text-primary disabled:opacity-50"><option value="none">{zh ? "仅附件信息" : "Metadata only"}</option><option value="small">{zh ? "小附件（≤10 MiB）" : "Small files (≤10 MiB)"}</option><option value="all">{zh ? "全部附件" : "All attachments"}</option></select></label> : null}
      {online && catalog ? <button type="button" disabled={Boolean(download) || pendingSummary.count === 0} onClick={() => onDownload("all")} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50"><Download className="h-4 w-4" />{pendingSummary.count > 0 ? (zh ? `更新 ${pendingSummary.count} 个对话 · ${formatBytes(pendingSummary.bytes)}` : `Update ${pendingSummary.count} conversations · ${formatBytes(pendingSummary.bytes)}`) : (zh ? "离线资料已是最新" : "Offline library is up to date")}</button> : null}
      {download ? <div className="space-y-1" role="status"><div className="h-1.5 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${download.progress}%` }} /></div><p className="flex items-center gap-1 text-xs text-secondary"><LoaderCircle className="h-3 w-3 animate-spin" />{download.label}</p></div> : null}
      {error ? <p className="rounded-md bg-[var(--danger-soft)] px-2 py-1.5 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {query ? <SearchResultList items={searchResults} conversations={conversations} onOpen={onOpen} /> : <>
        <section aria-labelledby="library-projects-heading">
          <div className="flex min-h-8 items-center justify-between px-2"><h2 id="library-projects-heading" className="text-xs font-semibold text-secondary">{zh ? "项目" : "Projects"}</h2><span className="text-[11px] text-secondary">{groupedProjects.length}</span></div>
          <ProjectRows projects={groupedProjects} selectedId={selectedId} expandedProjects={expandedProjects} setExpandedProjects={setExpandedProjects} catalog={catalog} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />
        </section>
        <section className="mt-4" aria-labelledby="library-conversations-heading">
          <div className="flex min-h-8 items-center justify-between px-2"><h2 id="library-conversations-heading" className="text-xs font-semibold text-secondary">{zh ? "未归类" : "Unclassified"}</h2><span className="text-[11px] text-secondary">{unclassifiedConversations.length}</span></div>
          <ConversationRows rows={unclassifiedConversations} selectedId={selectedId} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />
        </section>
      </>}
      {!sidebarConversations.length && !query ? <p className="px-3 py-8 text-center text-sm text-secondary">{zh ? "尚未下载资料" : "No offline conversations yet"}</p> : null}
    </div>
    <footer className="shrink-0 border-t border-ui px-3 py-3 text-xs text-secondary"><SidebarPreferences libraryMode onlineHref={onlineHref} /><div className="px-1 pt-2"><p className="flex items-center gap-2"><HardDrive className="h-4 w-4" />{storage?.usage !== null && storage?.usage !== undefined ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota ?? 0)}` : (zh ? "浏览器本地存储" : "Browser storage")}</p><p className="mt-1">{storage?.persisted ? (zh ? "已启用持久化存储" : "Persistent storage enabled") : (zh ? "存储可能被浏览器清理；清除站点数据会删除本地资料" : "The browser may clear this data; clearing site data removes offline copies")}</p>{online && selectedId ? <a href={`/conversations/${selectedId}`} className="mt-2 inline-flex font-medium text-accent hover:underline">{zh ? "前往服务器创建 .cr 备份" : "Create a .cr backup online"}</a> : null}</div></footer>
  </div>;
}

function OfflineShellIndicator({ status, online, onRetry }: { status: OfflineShellStatus; online: boolean; onRetry: () => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  if (status.availability === "ready" && status.updatePhase === "idle") {
    return <p className="flex min-h-9 items-center gap-2 rounded-md bg-[var(--callout-tip-bg)] px-3 text-xs text-[var(--callout-tip-text)]"><CheckCircle2 className="h-4 w-4 shrink-0" />{zh ? `可离线启动 · ${status.resourceCount} 项资源` : `Offline ready · ${status.resourceCount} resources`}</p>;
  }
  if (status.availability === "ready" && status.updatePhase === "preparing") {
    const progress = status.total ? `${status.completed}/${status.total}` : "";
    return <p className="flex min-h-9 items-center gap-2 rounded-md bg-subtle px-3 text-xs text-secondary" role="status"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />{zh ? `可离线启动 · 正在后台更新资源 ${progress}` : `Offline ready · Updating resources ${progress}`}</p>;
  }
  if (status.availability === "ready" && status.updatePhase === "failed") {
    return <div className="flex min-h-9 items-center gap-2 rounded-md bg-subtle px-3 py-2 text-xs text-secondary"><AlertTriangle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{zh ? "现有离线版本可用，资源更新失败" : "Existing offline version is available; update failed"}</span>{online ? <button type="button" onClick={onRetry} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface" aria-label={zh ? "重试更新离线资源" : "Retry offline resource update"} title={zh ? "重试" : "Retry"}><RefreshCw className="h-3.5 w-3.5" /></button> : null}</div>;
  }
  if (status.updatePhase === "checking" || status.updatePhase === "preparing") {
    const progress = status.total ? `${status.completed}/${status.total}` : "";
    return <p className="flex min-h-9 items-center gap-2 rounded-md bg-subtle px-3 text-xs text-secondary" role="status"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />{status.updatePhase === "checking" ? (zh ? "正在检查离线启动" : "Checking offline access") : (zh ? `正在准备首次离线启动 ${progress}` : `Preparing offline access for the first time ${progress}`)}</p>;
  }
  if (status.availability === "unsupported") {
    return <p className="flex min-h-9 items-center gap-2 rounded-md bg-subtle px-3 py-2 text-xs text-secondary"><AlertTriangle className="h-4 w-4 shrink-0" />{status.message ?? (zh ? "当前浏览器不支持离线启动" : "This browser does not support offline access")}</p>;
  }
  return <div className="flex min-h-9 items-center gap-2 rounded-md bg-[var(--callout-warning-bg)] px-3 py-2 text-xs text-[var(--callout-warning-text)]"><AlertTriangle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{status.message ?? (zh ? "离线启动尚未就绪" : "Offline access is not ready")}</span>{online ? <button type="button" onClick={onRetry} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface" aria-label={zh ? "重试准备离线启动" : "Retry offline preparation"} title={zh ? "重试" : "Retry"}><RefreshCw className="h-3.5 w-3.5" /></button> : null}</div>;
}

function ConversationRows({ rows, selectedId, onOpen, onDownload, onRemove }: { rows: LibrarySidebarConversation[]; selectedId: string | null; onOpen: (id: string) => void; onDownload: (scope: "conversation", id: string) => void; onRemove: (ids: string[]) => void }) {
  const { resolvedLocale } = usePreferences();
  return <div className="space-y-1">{rows.map((conversation) => <LibraryConversationRow key={conversation.id} conversation={conversation} selected={selectedId === conversation.id} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />)}{!rows.length ? <p className="px-2 py-2 text-xs text-secondary">{resolvedLocale === "zh-CN" ? "暂无对话。" : "No conversations."}</p> : null}</div>;
}

function LibraryConversationRow({ conversation, selected, onOpen, onDownload, onRemove }: { conversation: LibrarySidebarConversation; selected: boolean; onOpen: (id: string) => void; onDownload: (scope: "conversation", id: string) => void; onRemove: (ids: string[]) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const local = conversation.local;
  const catalog = conversation.catalog;
  const stale = Boolean(local && catalog && local.offline_revision !== catalog.revision);
  return <div className={`group flex items-start gap-1 rounded-md px-2 py-2 ${selected ? "bg-subtle" : "hover:bg-surface"}`}>
    <button type="button" disabled={!local} onClick={() => onOpen(conversation.id)} className="min-w-0 flex-1 text-left disabled:opacity-60">
      <p className="truncate text-sm font-medium">{conversation.displayTitle}</p>
      <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-secondary">{conversation.description || conversation.projectName || (zh ? "无摘要" : "No summary")}</p>
      <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-secondary">{local ? <><span className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-[var(--accent)]" : "bg-emerald-500"}`} /><span className="sr-only">{stale ? (zh ? "有在线更新" : "Update available") : (zh ? "已下载" : "Downloaded")}</span></> : <><span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary" /><span>{zh ? "未下载" : "Not downloaded"} · {formatBytes(catalog?.estimated_bytes ?? 0)}</span></>}</p>
    </button>
    {stale ? <button type="button" onClick={() => onDownload("conversation", conversation.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-accent hover:bg-subtle" aria-label={zh ? "更新对话" : "Update conversation"} title={zh ? "更新对话" : "Update conversation"}><RefreshCw className="h-4 w-4" /></button> : null}
    {local ? <button type="button" onClick={() => onRemove([conversation.id])} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-secondary opacity-70 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={zh ? "删除本地副本" : "Delete offline copy"} title={zh ? "删除本地副本" : "Delete offline copy"}><Trash2 className="h-4 w-4" /></button> : <button type="button" onClick={() => onDownload("conversation", conversation.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-accent hover:bg-subtle" aria-label={zh ? `下载对话，预计 ${formatBytes(catalog?.estimated_bytes ?? 0)}` : `Download conversation, about ${formatBytes(catalog?.estimated_bytes ?? 0)}`} title={`${zh ? "下载" : "Download"} · ${formatBytes(catalog?.estimated_bytes ?? 0)}`}><Download className="h-4 w-4" /></button>}
  </div>;
}

function ProjectRows({ projects, selectedId, expandedProjects, setExpandedProjects, catalog, onOpen, onDownload, onRemove }: { projects: LibraryProjectGroup[]; selectedId: string | null; expandedProjects: Set<string>; setExpandedProjects: React.Dispatch<React.SetStateAction<Set<string>>>; catalog?: OfflineCatalogResponse; onOpen: (id: string) => void; onDownload: (scope: "project" | "conversation", id: string) => void; onRemove: (ids: string[]) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  return <div className="space-y-1">{projects.map((project) => {
    const catalogProject = catalog?.projects.find((item) => item.id === project.id) ?? null;
    const expanded = expandedProjects.has(project.id);
    const localIds = project.conversations.filter((item) => item.local).map((item) => item.id);
    return <div key={project.id} className="rounded-lg">
      <div className="flex min-h-9 items-center gap-1 rounded-lg hover:bg-surface">
        <button type="button" onClick={() => setExpandedProjects((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} className="flex h-9 w-8 shrink-0 items-center justify-center text-secondary" aria-label={`${expanded ? (zh ? "收起" : "Collapse") : (zh ? "展开" : "Expand")} ${project.name}`}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <FolderTree className="h-4 w-4 shrink-0 text-accent" />
        <button type="button" onClick={() => setExpandedProjects((current) => new Set(current).add(project.id))} className="min-w-0 flex-1 py-2 text-left"><span className="block truncate text-sm">{project.name}</span><span className="block text-[11px] text-secondary">{zh ? `${localIds.length}/${project.total} 已下载` : `${localIds.length}/${project.total} downloaded`}</span></button>
        {catalogProject ? <button type="button" onClick={() => onDownload("project", catalogProject.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-secondary hover:bg-subtle hover:text-accent" aria-label={localIds.length ? (zh ? "更新项目" : "Update project") : (zh ? "下载项目" : "Download project")} title={localIds.length ? (zh ? "更新项目" : "Update project") : (zh ? "下载项目" : "Download project")}>{localIds.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}</button> : null}
        {localIds.length ? <button type="button" onClick={() => onRemove(localIds)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={zh ? "删除项目本地副本" : "Delete project offline copies"} title={zh ? "删除项目本地副本" : "Delete project offline copies"}><Trash2 className="h-3.5 w-3.5" /></button> : null}
      </div>
      {expanded ? <div className="ml-6 border-l border-ui pl-1"><ConversationRows rows={project.conversations} selectedId={selectedId} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} /></div> : null}
    </div>;
  })}{!projects.length ? <p className="px-2 py-2 text-xs text-secondary">{zh ? "暂无项目。" : "No projects."}</p> : null}</div>;
}

function SearchResultList({ items, conversations, onOpen }: { items: OfflineSearchDocument[]; conversations: OfflineConversationRecord[]; onOpen: (conversationId: string, messageId?: string | null, blockIndex?: number | null, characterOffset?: number | null) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const titles = new Map(conversations.map((item) => [item.id, item.display_title]));
  return <div className="space-y-1">{items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item.conversation_id, item.message_id, metadataNumber(item.metadata, "block_index"), metadataNumber(item.metadata, "character_offset"))} className="w-full rounded-md px-3 py-2 text-left hover:bg-surface"><p className="truncate text-sm font-medium">{item.title || titles.get(item.conversation_id) || (zh ? "对话" : "Conversation")}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-secondary">{item.plain_text.slice(0, 240)}</p></button>)}{!items.length ? <p className="px-3 py-8 text-center text-sm text-secondary">{zh ? "无本地结果" : "No offline results"}</p> : null}</div>;
}

function mergeLibraryConversations(localConversations: OfflineConversationRecord[], catalog?: OfflineCatalogResponse): LibrarySidebarConversation[] {
  const catalogById = new Map((catalog?.conversations ?? []).map((conversation) => [conversation.id, conversation]));
  const localIds = new Set(localConversations.map((conversation) => conversation.id));
  const localRows = localConversations.map((conversation): LibrarySidebarConversation => ({
    id: conversation.id,
    displayTitle: conversation.display_title,
    description: conversation.description_markdown || conversation.first_user_message,
    projectId: conversation.project_id,
    projectName: conversation.project_name,
    updatedAt: conversation.updated_at ?? conversation.downloaded_at,
    local: conversation,
    catalog: catalogById.get(conversation.id) ?? null,
  }));
  const remoteRows = (catalog?.conversations ?? [])
    .filter((conversation) => !localIds.has(conversation.id))
    .map((conversation): LibrarySidebarConversation => ({
      id: conversation.id,
      displayTitle: conversation.display_title,
      description: null,
      projectId: conversation.project_id,
      projectName: conversation.project_name,
      updatedAt: conversation.updated_at,
      local: null,
      catalog: conversation,
    }));
  return [...localRows, ...remoteRows];
}

function estimateScope(
  catalog: OfflineCatalogResponse,
  scope: "conversation" | "project" | "all",
  id: string | undefined,
  knownRevisions: Record<string, number>,
): number {
  return summarizeScope(catalog, scope, id, knownRevisions).bytes;
}

function summarizeScope(
  catalog: OfflineCatalogResponse,
  scope: "conversation" | "project" | "all",
  id: string | undefined,
  knownRevisions: Record<string, number>,
): { bytes: number; count: number } {
  const projectIds = scope === "project"
    ? new Set(catalog.projects.find((item) => item.id === id)?.conversation_ids ?? [])
    : null;
  return catalog.conversations.reduce((summary, item) => {
    const inScope = scope === "all" || item.id === id || projectIds?.has(item.id);
    const changed = knownRevisions[item.id] !== item.revision;
    if (inScope && changed) {
      summary.bytes += item.estimated_bytes;
      summary.count += 1;
    }
    return summary;
  }, { bytes: 0, count: 0 });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function libraryActivityTime(conversation: OfflineConversationRecord): number {
  const value = conversation.last_read_at ?? conversation.downloaded_at;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
