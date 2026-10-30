"use client";

import { liveQuery } from "dexie";
import { enqueueOfflineDownload, listOfflineDownloads, offlineDownloadFailureMessage, retryOfflineDownload, usableOfflineRevisions, type OfflineDownload } from "../../lib/offline-downloads";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FolderTree, HardDrive, Library, LoaderCircle, PanelLeftClose, RefreshCw, Search, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ConversationReader } from "../conversations/conversation-reader";
import { ApiRequestError, getOfflineCatalog } from "../../lib/api";
import { OfflinePackageImportError, OfflinePendingChangesError, OfflineDownloadInProgressError, offlineDb, removeOfflineConversations, type OfflineConversationRecord, type OfflineSearchDocument } from "../../lib/offline-db";
import { offlineReaderDataSource, resolveOfflineSearchResult } from "../../lib/reader-data-source";
import { matchesLibrarySearchTarget, searchResultHref, type SearchResultReplay } from "../search/search-result-target";
import { initializeOfflineSearch, searchOffline } from "../../lib/offline-search";
import { buildOfflineSearchDocuments } from "../../lib/offline-search-documents";
import { invalidateReaderSearch } from "../../lib/reader-search-cache";
import { AUTH_GENERATION_CHANGED_EVENT, assertOfflineAccess, captureOfflineAccess } from "../../lib/offline-access";
import { getInitialOfflineShellStatus, getOfflineShellStatus, prepareOfflineShell, subscribeOfflineShellStatus, type OfflineShellStatus } from "../../lib/offline-shell";
import type { AnnotationRead, NotebookRead, OfflineCatalogConversation, OfflineCatalogResponse, SearchResultItem } from "../../lib/types";
import { ReaderSidebarFrame } from "../../components/reader-sidebar-frame";
import { SidebarPreferences } from "../../components/sidebar-preferences";
import { usePreferences } from "../../components/preferences-provider";
import { MobilePageHeader } from "../../components/mobile-page-header";

type DownloadState = { key: string; progress: number; label: string } | null;
type DownloadRequest = { scope: "conversation" | "project" | "all"; id?: string };
type OfflineAssetMode = "none" | "small" | "all";
type OfflineLibraryReadState = {
  phase: "loading" | "ready" | "error";
  refreshing: boolean;
  refreshError: boolean;
};
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
type SearchSnapshot = { documents: OfflineSearchDocument[]; annotations: AnnotationRead[]; notebooks: NotebookRead[] };
const APP_TITLE = "chat-reader";
const LAST_LIBRARY_CONVERSATION_KEY = "chat-reader:last-library-conversation";

export function LibraryShell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [conversations, setConversations] = useState<OfflineConversationRecord[]>([]);
  const requestedId = searchParams?.get("conversationId") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedRequestedId, setAppliedRequestedId] = useState<string | null>();
  const [mobileOpen, setMobileOpen] = useState(!selectedId);
  // Cached HTML was rendered online. Match it during hydration, then read the
  // device state; otherwise an offline cold start regenerates the whole tree.
  const [online, setOnline] = useState(true);
  const [download, setDownload] = useState<DownloadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedDownload, setFailedDownload] = useState<DownloadRequest | null>(null);
  const [downloadFailure, setDownloadFailure] = useState<OfflineDownload | null>(null);
  const [retryingDownload, setRetryingDownload] = useState(false);
  const [storage, setStorage] = useState<{ persisted: boolean; quota: number | null; usage: number | null } | null>(null);
  const [assetMode, setAssetMode] = useState<OfflineAssetMode>("all");
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);
  const [readerFocusMode, setReaderFocusMode] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OfflineSearchDocument[]>([]);
  const [searchResultQuery, setSearchResultQuery] = useState("");
  const [searchIndexRevision, setSearchIndexRevision] = useState(0);
  const [searchIndexReady, setSearchIndexReady] = useState(false);
  const [searchWatchRevision, setSearchWatchRevision] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchReplay, setSearchReplay] = useState<SearchResultReplay | null>(null);
  const [localRead, setLocalRead] = useState<OfflineLibraryReadState>({
    phase: "loading",
    refreshing: true,
    refreshError: false,
  });
  const [downloadStatusError, setDownloadStatusError] = useState(false);
  const [downloadStatusRetry, setDownloadStatusRetry] = useState(0);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);
  const autoRefreshRunningRef = useRef(false);
  const completedDownloadsRef = useRef("");
  const reloadSequenceRef = useRef(0);
  const reloadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const searchReloadSequenceRef = useRef(0);
  const searchReloadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const searchWatchFailedRef = useRef(false);
  const libraryMountedRef = useRef(false);
  const localReadRef = useRef(localRead);
  const selectedConversation = selectedId ? conversations.find((item) => item.id === selectedId) ?? null : null;
  const offlineShellStatus = useSyncExternalStore(
    subscribeOfflineShellStatus,
    getOfflineShellStatus,
    getInitialOfflineShellStatus,
  );

  useEffect(() => {
    libraryMountedRef.current = true;
    return () => {
      libraryMountedRef.current = false;
      reloadSequenceRef.current += 1;
      searchReloadSequenceRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    // Offline navigation reuses the cached /library HTML without query params.
    // Keep the same initial hydration tree, but apply a deep link before the
    // first interactive paint. A passive effect could close a sidebar whose
    // Settings control had already become visible to the user.
    if (requestedId) { setSelectedId(requestedId); setMobileOpen(false); }
    setAppliedRequestedId(requestedId);
  }, [requestedId]);

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

  const reloadSearchIndex = useCallback(async (snapshot?: SearchSnapshot) => {
    const sequence = ++searchReloadSequenceRef.current;
    setSearchIndexReady(false);
    setSearchResults([]);
    setSearchResultQuery("");
    setSearchFailed(false);
    const current = () => libraryMountedRef.current && sequence === searchReloadSequenceRef.current;
    let access: number;
    try {
      access = captureOfflineAccess();
    } catch (cause) {
      if (current()) setSearchFailed(true);
      throw cause;
    }
    const db = offlineDb;
    const run = searchReloadQueueRef.current.then(async () => {
      if (!current()) return;
      assertOfflineAccess(access);
      const contents = snapshot ?? await db.transaction("r", [db.searchDocuments, db.annotations, db.notebooks], async () => ({
        documents: await db.searchDocuments.toArray(),
        annotations: await db.annotations.toArray(),
        notebooks: await db.notebooks.toArray(),
      }));
      assertOfflineAccess(access);
      if (!current()) return;
      const localConversations = await db.conversations.toArray();
      assertOfflineAccess(access);
      if (!current()) return;
      await initializeOfflineSearch(buildOfflineSearchDocuments(
        contents.documents, contents.annotations, contents.notebooks, localConversations,
      ));
      assertOfflineAccess(access);
      if (!current()) return;
      setSearchFailed(false);
      setSearchIndexReady(true);
      setSearchIndexRevision((revision) => revision + 1);
      invalidateReaderSearch(queryClient, { mode: "offline" });
    });
    const guarded = run.catch((cause: unknown) => {
      if (current()) setSearchFailed(true);
      throw cause;
    });
    searchReloadQueueRef.current = guarded.catch(() => undefined);
    return guarded;
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { unsubscribe: () => void } | undefined;
    const invalidate = () => {
      clearTimeout(timer);
      searchReloadSequenceRef.current += 1;
      setSearchIndexReady(false);
      setSearchResults([]);
      setSearchResultQuery("");
    };
    const retire = () => {
      if (!active) return;
      active = false;
      searchWatchFailedRef.current = true;
      invalidate();
      setSearchFailed(true);
      subscription?.unsubscribe();
    };
    const fail = () => {
      if (!active) return;
      searchWatchFailedRef.current = true;
      invalidate();
      setSearchFailed(true);
    };
    // Observe only content stores, not outbox/reading-position events. Snapshots
    // are transactional; rapid edits share one pending rebuild, with no writes.
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, retire);
    try {
      const access = captureOfflineAccess(), db = offlineDb;
      subscription = liveQuery(() => {
        assertOfflineAccess(access);
        return db.transaction("r", [db.searchDocuments, db.annotations, db.notebooks], async () => ({
          documents: await db.searchDocuments.toArray(),
          annotations: await db.annotations.toArray(),
          notebooks: await db.notebooks.toArray(),
        }));
      }).subscribe({
        next: (snapshot) => {
          if (!active) return;
          try { assertOfflineAccess(access); } catch { retire(); return; }
          invalidate();
          const sequence = searchReloadSequenceRef.current;
          timer = setTimeout(() => {
            if (!active || sequence !== searchReloadSequenceRef.current) return;
            try { assertOfflineAccess(access); } catch { retire(); return; }
            void reloadSearchIndex(snapshot).catch(() => undefined);
          }, 80);
        },
        error: fail,
      });
    } catch { fail(); }
    return () => {
      active = false;
      clearTimeout(timer);
      subscription?.unsubscribe();
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, retire);
    };
  }, [reloadSearchIndex, searchWatchRevision]);

  const reloadLocal = useCallback(() => {
    if (!libraryMountedRef.current) return Promise.resolve();
    if (searchWatchFailedRef.current) {
      searchWatchFailedRef.current = false;
      setSearchWatchRevision((revision) => revision + 1);
    }
    const sequence = ++reloadSequenceRef.current;
    const previousLocalRead = localReadRef.current;
    const hadVisibleLocalRead = previousLocalRead.phase === "ready";
    const pendingLocalRead: OfflineLibraryReadState = hadVisibleLocalRead
      ? { ...previousLocalRead, refreshing: true, refreshError: false }
      : { phase: "loading", refreshing: true, refreshError: false };
    localReadRef.current = pendingLocalRead;
    setLocalRead(pendingLocalRead);
    let localListCommitted = false;
    const run = reloadQueueRef.current.then(async () => {
      if (!libraryMountedRef.current || sequence !== reloadSequenceRef.current) return;
      const fallback = await offlineDb.conversations.toArray();
      fallback.sort((left, right) => libraryActivityTime(right) - libraryActivityTime(left));
      // Older offline packages could persist conversation metadata before the
      // message rows (or carry a stale server aggregate). Reconcile the
      // lightweight header from the canonical local message table so a valid
      // package never presents as “0/0 messages”. This is read-only metadata
      // repair and does not rewrite message content.
      const localMessages = await offlineDb.messages.toArray();
      const messageStats = new Map<string, { count: number; turns: Set<number> }>();
      for (const message of localMessages) {
        const id = String(message.conversation_id);
        const stats = messageStats.get(id) ?? { count: 0, turns: new Set<number>() };
        stats.count += 1;
        if (typeof message.turn_index === "number") stats.turns.add(message.turn_index);
        messageStats.set(id, stats);
      }
      const reconciled = fallback.map((conversation) => {
        const stats = messageStats.get(String(conversation.id));
        if (!stats || stats.count === 0) return conversation;
        return {
          ...conversation,
          message_count: stats.count,
          turn_count: stats.turns.size || conversation.turn_count,
        };
      });
      if (!libraryMountedRef.current || sequence !== reloadSequenceRef.current) return;
      setConversations(reconciled);
      localListCommitted = true;
      const readyLocalRead: OfflineLibraryReadState = { phase: "ready", refreshing: false, refreshError: false };
      localReadRef.current = readyLocalRead;
      setLocalRead(readyLocalRead);
      try {
        await reloadSearchIndex();
      } catch {
        if (libraryMountedRef.current && sequence === reloadSequenceRef.current) setSearchFailed(true);
      }
      if (!libraryMountedRef.current || sequence !== reloadSequenceRef.current) return;
      const estimate: StorageEstimate | undefined = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => false);
      if (!libraryMountedRef.current || sequence !== reloadSequenceRef.current) return;
      setStorage({ persisted: persisted ?? false, quota: estimate?.quota ?? null, usage: estimate?.usage ?? null });
    });
    const guardedRun = run.catch((cause: unknown) => {
      if (!libraryMountedRef.current || sequence !== reloadSequenceRef.current) return;
      const failedLocalRead: OfflineLibraryReadState = localListCommitted || hadVisibleLocalRead
        ? { phase: "ready", refreshing: false, refreshError: true }
        : { phase: "error", refreshing: false, refreshError: false };
      localReadRef.current = failedLocalRead;
      setLocalRead(failedLocalRead);
      setSearchFailed(true);
      throw cause;
    });
    reloadQueueRef.current = guardedRun.catch(() => undefined);
    return guardedRun;
  }, [reloadSearchIndex]);

  useEffect(() => { void reloadLocal().catch(() => setSearchFailed(true)); }, [reloadLocal]);
  const retryLocalRead = useCallback(() => {
    if (localReadRef.current.refreshing) return;
    void reloadLocal().catch(() => undefined);
  }, [reloadLocal]);
  useEffect(() => {
    if (selectedId || !conversations.length) return;
    const rememberedId = window.localStorage.getItem(LAST_LIBRARY_CONVERSATION_KEY);
    setSelectedId(requestedId ?? conversations.find((item) => item.id === rememberedId)?.id ?? conversations[0].id);
  }, [conversations, requestedId, selectedId]);
  useEffect(() => {
    setOnline(navigator.onLine);
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

  const openLibrary = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setLibrarySidebarExpanded(true);
      requestAnimationFrame(() => {
        Array.from(document.querySelectorAll<HTMLInputElement>("[data-reader-primary-sidebar] input"))
          .find(input => input.getClientRects().length)?.focus();
      });
    } else setMobileOpen(true);
  }, [setLibrarySidebarExpanded]);

  const runDownload = useCallback(async (scope: "conversation" | "project" | "all", scopeId?: string, _silent = false) => {
    await enqueueOfflineDownload({ scope, scopeId, assetMode });
  }, [assetMode]);

  useEffect(() => {
    let active = true;
    setDownloadStatusError(false);
    const subscription = liveQuery(() => listOfflineDownloads()).subscribe({ next: (records) => {
      if (!active) return;
      setDownloadStatusError(false);
      // A newer attempt for the same scope supersedes its older failure.
      // Persisted failures survive navigation/reload without generating alerts.
      const scopes = new Set<string>();
      setDownloadFailure(records.filter(item => {
        const key = `${item.scope}:${item.scopeId ?? "all"}`;
        if (scopes.has(key)) return false;
        scopes.add(key);
        return item.state === "failed";
      })[0] ?? null);
      const completed = records.filter((item) => item.state === "completed").map((item) => item.id).join("|");
      if (completed !== completedDownloadsRef.current) {
        completedDownloadsRef.current = completed;
        void reloadLocal().catch(() => undefined);
      }
      const current = records.find((item) => ["queued", "generating", "downloading", "writing"].includes(item.state));
      setDownload(current ? { key: `${current.scope}:${current.scopeId ?? "all"}`, progress: current.progress,
        label: (zh ? { queued: "排队中", generating: "正在生成离线包", downloading: "正在下载", writing: "正在写入离线资料库" } : { queued: "Queued", generating: "Generating package", downloading: "Downloading", writing: "Writing offline copy" })[current.state as "queued"] } : null);
    }, error: () => {
      if (!active) return;
      setDownloadStatusError(true);
      setDownload(null);
      setDownloadFailure(null);
    } });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [downloadStatusRetry, reloadLocal, zh]);

  const startDownload = useCallback((request: DownloadRequest) => {
    setError(null);
    setFailedDownload(null);
    void runDownload(request.scope, request.id).catch((reason: unknown) => {
      setError(offlineDownloadErrorMessage(reason, zh));
      setFailedDownload(request);
      setDownload(null);
    });
  }, [runDownload, zh]);

  const retryDownload = useCallback(() => {
    if (retryingDownload) return;
    if (failedDownload) { startDownload(failedDownload); return; }
    if (!downloadFailure) return;
    setRetryingDownload(true);
    setError(null);
    void retryOfflineDownload(downloadFailure.id).catch(reason => setError(offlineDownloadErrorMessage(reason, zh)))
      .finally(() => setRetryingDownload(false));
  }, [downloadFailure, failedDownload, retryingDownload, startDownload, zh]);

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
        if (failed) setError(zh ? "部分离线对话未能更新，旧版本已保留。可联网后手动重试。" : "Some offline conversations could not be updated. Older copies are retained; reconnect and retry.");
      } finally {
        autoRefreshRunningRef.current = false;
      }
    })();
  }, [catalogQuery.data, conversations, download, reloadLocal, runDownload, zh]);

  useEffect(() => {
    if (!searchIndexReady) return;
    const indexSequence = searchReloadSequenceRef.current;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchOffline(query).then((results) => {
        if (active && indexSequence === searchReloadSequenceRef.current) {
          setSearchResults(results);
          setSearchResultQuery(query);
        }
      }).catch(() => { if (active && indexSequence === searchReloadSequenceRef.current) setSearchFailed(true); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, searchIndexReady, searchIndexRevision]);

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

  function openSearchResult(item: SearchResultItem) {
    const href = searchResultHref(item, "library");
    // A changed URL already carries a fresh destination. Only a repeat of the
    // current URL needs a separate intent; never add a nonce to saved links.
    const repeat = matchesLibrarySearchTarget(href, searchParams?.toString() ?? "");
    if (repeat) {
      setSearchReplay((current) => ({ href, sequence: (current?.sequence ?? 0) + 1 }));
    }
    setSelectedId(item.conversation_id);
    window.localStorage.setItem(LAST_LIBRARY_CONVERSATION_KEY, item.conversation_id);
    setMobileOpen(false);
    // Even replacing an equivalent URL can request an uncached RSC payload
    // offline and fall back to a document navigation, losing this Reader.
    if (!repeat) router.replace(href);
  }

  async function removeLocal(ids: string[]) {
    setError(null);
    try {
      await removeOfflineConversations(ids);
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null);
        window.localStorage.removeItem(LAST_LIBRARY_CONVERSATION_KEY);
        router.replace("/library");
      }
      await reloadLocal();
    } catch (cause) {
      setError(cause instanceof OfflineDownloadInProgressError ? (zh ? "下载进行中，请先取消或等待完成再清理。" : "A download is running. Cancel it or wait before clearing data.") : cause instanceof OfflinePendingChangesError
        ? (zh ? `仍有 ${cause.count} 项未同步修改。请先联网同步；本地副本已保留。` : `${cause.count} unsynced changes remain. Reconnect and sync first; your local copy is retained.`)
        : (zh ? "无法删除本地副本，请重试。" : "Unable to delete the offline copy. Try again."));
    }
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

  const failedRequest = failedDownload ?? (downloadFailure ? { scope: downloadFailure.scope, id: downloadFailure.scopeId } : null);
  const requestedFailure = failedRequest && (failedRequest.scope === "all"
    || failedRequest.scope === "conversation" && failedRequest.id === selectedId
    || failedRequest.scope === "project" && failedRequest.id === requestedCatalogConversation?.project_id);
  const requestedFailureMessage = requestedFailure ? ((failedDownload ? error : null) ?? offlineDownloadFailureMessage(downloadFailure?.error ?? null, zh, Boolean(selectedConversation))) : null;
  const retainedFailureCopy = downloadFailure && conversations.some(conversation => downloadFailure.scope === "all"
    || downloadFailure.scope === "conversation" && downloadFailure.scopeId === conversation.id
    || downloadFailure.scope === "project" && downloadFailure.scopeId === conversation.project_id);
  const sidebarError = error ?? requestedFailureMessage ?? (downloadFailure ? offlineDownloadFailureMessage(downloadFailure.error, zh, Boolean(retainedFailureCopy)) : catalogQuery.isError ? offlineCatalogErrorMessage(catalogQuery.error, zh) : null);
  const localReadReady = localRead.phase === "ready";
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
      searchResults={searchIndexReady && searchResultQuery === query ? searchResults : []}
      searchState={searchFailed ? "unavailable" : searchIndexReady && searchResultQuery === query ? "ready" : "loading"}
      onRetrySearch={() => {
        setSearchFailed(false);
        setSearchIndexRevision(0);
        setSearchResults([]);
        void reloadLocal().catch(() => setSearchFailed(true));
      }}
      download={download}
      storage={storage}
      assetMode={assetMode}
      offlineShellStatus={offlineShellStatus}
      error={sidebarError}
      failedDownload={failedRequest}
      localRead={localRead}
      downloadStatusError={downloadStatusError}
      suppressDesktopError={Boolean(!selectedConversation && requestedCatalogConversation && requestedFailureMessage && sidebarError === requestedFailureMessage)}
      onClose={() => setMobileOpen(false)}
      onCollapse={() => setLibrarySidebarExpanded(false)}
      onOpen={openConversation}
      onOpenSearchResult={openSearchResult}
      onDownload={(scope, id) => startDownload({ scope, id })}
      onRetryDownload={retryDownload}
      onRetryLocalRead={retryLocalRead}
      onRetryDownloadStatus={() => setDownloadStatusRetry((attempt) => attempt + 1)}
      onAssetModeChange={updateAssetMode}
      catalogReadError={catalogQuery.isError}
      catalogReadFetching={catalogQuery.isFetching}
      onRetryCatalog={() => void catalogQuery.refetch()}
      onRetryShell={() => { setError(null); void prepareOfflineShell({ force: true }).catch((reason: unknown) => setError(offlineShellErrorMessage(reason, zh))); }}
      onRemove={(ids) => void removeLocal(ids)}
    />
  );
  const readerContent = selectedId && selectedConversation ? (
    <ConversationReader key={`${selectedId}:${selectedConversation.offline_revision}:${searchParams?.get("messageId") ?? ""}:${searchParams?.get("blockIndex") ?? ""}:${searchParams?.get("characterOffset") ?? ""}`} conversationId={selectedId} dataSource={offlineReaderDataSource} libraryMode onOpenLibrary={openLibrary} onFocusModeChange={setReaderFocusMode} onPrepareSearchRetry={reloadLocal} searchReplay={searchReplay} />
  ) : requestedCatalogConversation ? (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center" aria-label={zh ? "离线下载" : "Offline download"}>
      <Library className="h-10 w-10 shrink-0 text-accent" />
      <h1 className="mt-4 max-w-xl break-words text-xl font-semibold">{requestedCatalogConversation.display_title}</h1>
      {!requestedFailureMessage && !download ? <p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "下载后即可在这里离线阅读。" : "Download this conversation to read it here offline."}</p> : null}
      {download ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />{online ? download.label : (zh ? "已暂停，联网后继续" : "Paused; resumes when online")}</p> : null}
      {requestedFailureMessage ? <p role="status" className="mt-4 max-w-sm rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{requestedFailureMessage}</p> : null}
      <button type="button" disabled={!online || Boolean(download) || retryingDownload} onClick={() => requestedFailure ? retryDownload() : startDownload({ scope: "conversation", id: requestedCatalogConversation.id })} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50"><Download className="h-4 w-4" />{requestedFailure ? (zh ? "重试离线下载" : "Retry offline download") : (zh ? "下载离线副本" : "Download offline copy")}</button>
      <button type="button" onClick={openLibrary} className={`mt-3 min-h-10 rounded-md border border-ui px-4 text-sm font-medium text-primary ${desktopSidebarExpanded ? "md:hidden" : ""}`}>{zh ? "打开资料库" : "Open library"}</button>
    </div>
  ) : !localReadReady ? (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center" role={localRead.phase === "error" ? "alert" : "status"}>
      {localRead.phase === "error" ? <AlertTriangle className="h-10 w-10 text-amber-600" /> : <LoaderCircle className="h-10 w-10 animate-spin text-accent motion-reduce:animate-none" />}
      <h1 className="mt-4 text-xl font-semibold">{localRead.phase === "error" ? (zh ? "无法读取离线资料库" : "Unable to read offline library") : (zh ? "正在读取离线资料库" : "Reading offline library")}</h1>
      <p className="mt-2 max-w-sm text-secondary">{localRead.phase === "error" ? (zh ? "本地副本未被删除。请重试读取。" : "Your local copies were not deleted. Retry the read.") : (zh ? "正在读取本机已下载的对话。" : "Reading downloaded conversations from this device.")}</p>
      {localRead.phase === "error" ? <button type="button" onClick={retryLocalRead} disabled={localRead.refreshing} className="mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{zh ? "重试读取" : "Retry read"}</button> : null}
    </div>
  ) : selectedId ? (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center"><AlertTriangle className="h-10 w-10 text-amber-600" /><h1 className="mt-4 text-xl font-semibold">{zh ? "该对话尚未下载" : "Conversation not downloaded"}</h1><p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "当前离线资料库中没有这个对话。联网后打开资料库即可下载。" : "This conversation is not in the offline library. Connect to download it."}</p><button type="button" onClick={openLibrary} className={`mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] ${desktopSidebarExpanded ? "md:hidden" : ""}`}>{zh ? "打开资料库" : "Open library"}</button></div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Library className="h-10 w-10 text-accent" /><h1 className="mt-4 text-xl font-semibold">{zh ? "离线资料库" : "Offline library"}</h1><p className="mt-2 max-w-sm text-sm text-secondary">{zh ? "选择已下载对话，或联网后打开资料库下载。" : "Choose a downloaded conversation, or connect to add one."}</p><button type="button" onClick={openLibrary} className={`mt-5 min-h-11 rounded-md bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] ${desktopSidebarExpanded ? "md:hidden" : ""}`}>{zh ? "打开资料库" : "Open library"}</button></div>
  );

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary" data-library-navigation-ready={String(appliedRequestedId === requestedId)}>
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

function LibrarySidebar({ online, catalog, conversations, sidebarConversations, unclassifiedConversations, selectedId, groupedProjects, query, setQuery, searchResults, searchState, onRetrySearch, download, storage, assetMode, offlineShellStatus, error, failedDownload, localRead, downloadStatusError, catalogReadError, catalogReadFetching, suppressDesktopError, onClose, onCollapse, onOpen, onOpenSearchResult, onDownload, onRetryDownload, onRetryLocalRead, onRetryDownloadStatus, onRetryCatalog, onAssetModeChange, onRetryShell, onRemove }: {
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
  searchState: "loading" | "ready" | "unavailable";
  onRetrySearch: () => void;
  download: DownloadState;
  storage: { persisted: boolean; quota: number | null; usage: number | null } | null;
  assetMode: OfflineAssetMode;
  offlineShellStatus: OfflineShellStatus;
  error: string | null;
  failedDownload: DownloadRequest | null;
  localRead: OfflineLibraryReadState;
  downloadStatusError: boolean;
  catalogReadError: boolean;
  catalogReadFetching: boolean;
  suppressDesktopError: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onOpen: (conversationId: string, messageId?: string | null, blockIndex?: number | null, characterOffset?: number | null) => void;
  onOpenSearchResult: (item: SearchResultItem) => void;
  onDownload: (scope: "conversation" | "project" | "all", id?: string) => void;
  onRetryDownload: () => void;
  onRetryLocalRead: () => void;
  onRetryDownloadStatus: () => void;
  onRetryCatalog: () => void;
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
  const [revisionAttempt, setRevisionAttempt] = useState(0);
  const [revisionCheck, setRevisionCheck] = useState<{
    assetMode: OfflineAssetMode; conversations: OfflineConversationRecord[]; attempt: number;
    revisions: Record<string, number> | null;
  } | null>(null);
  const currentRevisionCheck = revisionCheck?.assetMode === assetMode
    && revisionCheck.conversations === conversations && revisionCheck.attempt === revisionAttempt ? revisionCheck : null;
  const knownRevisions = currentRevisionCheck?.revisions ?? null;
  const revisionCheckFailed = currentRevisionCheck !== null && knownRevisions === null;
  useEffect(() => {
    let active = true;
    setRevisionCheck(null);
    const scope = { assetMode, conversations, attempt: revisionAttempt };
    void usableOfflineRevisions(assetMode)
      .then((revisions) => { if (active) setRevisionCheck({ ...scope, revisions }); })
      .catch(() => { if (active) setRevisionCheck({ ...scope, revisions: null }); });
    return () => { active = false; };
  }, [assetMode, conversations, revisionAttempt]);
  const pendingSummary = catalog ? summarizeScope(catalog, "all", undefined, knownRevisions ?? {}) : { bytes: 0, count: 0 };
  const onlineHref = selectedId ? `/conversations/${selectedId}` : "/";
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ui px-4"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">CR</span><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{zh ? "离线资料库" : "Offline library"}</h1><p className="flex items-center gap-1 text-xs text-secondary">{online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{online ? (zh ? "已联网" : "Online") : (zh ? "离线阅读" : "Offline reading")}</p></div><button type="button" onClick={onCollapse} className="hidden h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-surface md:flex" aria-label={zh ? "收起侧栏" : "Collapse sidebar"} title={zh ? "收起侧栏" : "Collapse sidebar"}><PanelLeftClose className="h-5 w-5" /></button><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary md:hidden" aria-label={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button></header>
    <div className="shrink-0 space-y-3 border-b border-ui p-3">
      <label className="flex min-h-10 items-center gap-2 rounded-md border border-ui bg-surface px-3"><Search className="h-4 w-4 text-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={zh ? "搜索本地正文、代码与批注" : "Search offline text, code, and annotations"} /></label>
      <OfflineShellIndicator status={offlineShellStatus} online={online} onRetry={onRetryShell} />
      {downloadStatusError ? <div role="alert" className="space-y-2 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]"><p>{zh ? "无法读取下载状态。下载可能仍在继续，请重试读取状态。" : "Could not read download status. A download may still be running; retry the status read."}</p><button type="button" onClick={onRetryDownloadStatus} className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--danger)] px-2 font-medium"><RefreshCw className="h-3.5 w-3.5" />{zh ? "重试状态读取" : "Retry status read"}</button></div> : null}
      {localRead.phase === "error" ? <div role="alert" className="space-y-2 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]"><p>{zh ? "无法读取本地离线资料。现有副本未被删除，请重试。" : "Could not read local offline copies. Existing copies were not deleted; retry the read."}</p><button type="button" onClick={onRetryLocalRead} disabled={localRead.refreshing} className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--danger)] px-2 font-medium disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{zh ? "重试读取" : "Retry local read"}</button></div> : null}
      {localRead.phase === "ready" && localRead.refreshError ? <div role="status" className="space-y-1 rounded-md bg-subtle px-3 py-2 text-xs text-secondary"><p>{zh ? "本地资料刷新失败，仍显示上次已读取的副本。" : "Local refresh failed; showing the last successfully read copies."}</p><button type="button" onClick={onRetryLocalRead} disabled={localRead.refreshing} className="inline-flex min-h-9 items-center gap-1 rounded border border-ui px-2 font-medium disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{zh ? "重试读取" : "Retry local read"}</button></div> : null}
      {localRead.phase !== "ready" ? <p role="status" className="flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-xs text-secondary"><LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{zh ? "正在读取本地资料…" : "Reading local offline copies…"}</p> : null}
      {online && catalog ? <label className="grid gap-1 text-xs text-secondary"><span>{zh ? "离线附件" : "Offline attachments"}</span><select value={assetMode} onChange={(event) => onAssetModeChange(event.target.value as OfflineAssetMode)} disabled={Boolean(download)} className="min-h-9 rounded-md border border-ui bg-surface px-2 text-sm text-primary disabled:opacity-50"><option value="none">{zh ? "仅附件信息" : "Metadata only"}</option><option value="small">{zh ? "小附件（≤10 MiB）" : "Small files (≤10 MiB)"}</option><option value="all">{zh ? "全部附件" : "All attachments"}</option></select></label> : null}
      {online && catalog ? revisionCheckFailed ? <div className="space-y-2">
        <p role="status" className="text-xs text-secondary">{zh ? "无法检查离线资源。已下载的资料仍然保留，请重新检查。" : "Could not check offline resources. Downloaded copies are retained. Please retry the check."}</p>
        <button type="button" disabled={Boolean(download)} onClick={() => setRevisionAttempt((attempt) => attempt + 1)} className="btn-secondary flex min-h-11 w-full items-center justify-center gap-2 px-3 text-sm disabled:opacity-50"><RefreshCw aria-hidden="true" className="h-4 w-4" />{zh ? "重新检查离线资源" : "Retry resource check"}</button>
      </div> : <button type="button" disabled={Boolean(download) || knownRevisions === null || pendingSummary.count === 0} onClick={() => onDownload("all")} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50"><Download className="h-4 w-4" />{knownRevisions === null ? (zh ? "正在检查离线资源" : "Checking offline resources") : pendingSummary.count > 0 ? (zh ? `更新 ${pendingSummary.count} 个对话 · ${formatBytes(pendingSummary.bytes)}` : `Update ${pendingSummary.count} conversations · ${formatBytes(pendingSummary.bytes)}`) : (zh ? "离线资料已是最新" : "Offline library is up to date")}</button> : null}
      {download ? <div className="space-y-1" role="status"><div className="h-1.5 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${download.progress}%` }} /></div><p className="flex items-center gap-1 text-xs text-secondary">{online ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <WifiOff className="h-3 w-3" />}{online ? download.label : (zh ? "已暂停，联网后继续" : "Paused; resumes when online")}</p></div> : null}
      {error ? <div role="status" className={`flex items-center gap-2 rounded-md bg-[var(--danger-soft)] px-2 py-1.5 text-xs text-[var(--danger)] ${suppressDesktopError ? "md:hidden" : ""}`}><p className="min-w-0 flex-1">{error}</p>{failedDownload && online ? <button type="button" onClick={onRetryDownload} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-[var(--danger)] px-2 font-medium hover:bg-surface" aria-label={zh ? "重试离线下载" : "Retry offline download"}><RefreshCw className="h-3.5 w-3.5" />{zh ? "重试" : "Retry"}</button> : null}{catalogReadError && online ? <button type="button" disabled={catalogReadFetching} onClick={onRetryCatalog} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-[var(--danger)] px-2 font-medium hover:bg-surface disabled:opacity-50" aria-label={zh ? "重试读取在线目录" : "Retry online catalog"}><RefreshCw className={`h-3.5 w-3.5 ${catalogReadFetching ? "motion-safe:animate-spin" : ""}`} />{zh ? "重试目录" : "Retry catalog"}</button> : null}</div> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {query ? localRead.phase !== "ready" ? <p role="status" className="px-3 py-5 text-sm text-secondary">{zh ? "读取本地资料后才能搜索…" : "Read local copies before searching…"}</p> : searchState === "unavailable" ? <div role="alert" className="space-y-2 px-3 py-5 text-sm text-secondary"><p>{zh ? "离线搜索暂不可用。若离线资源缺失，请联网更新后重试。已下载的对话仍然保留。" : "Offline search is unavailable. If resources are missing, reconnect to update them and retry. Downloaded conversations are retained."}</p><button type="button" onClick={onRetrySearch} className="btn-secondary min-h-11 px-3">{zh ? "重试离线搜索" : "Retry offline search"}</button></div> : searchState === "loading" ? <p role="status" className="px-3 py-5 text-sm text-secondary">{zh ? "正在准备离线搜索…" : "Preparing offline search…"}</p> : <SearchResultList items={searchResults} query={query} conversations={conversations} onOpen={onOpen} onOpenSearchResult={onOpenSearchResult} /> : localRead.phase !== "ready" ? null : <>
        <section aria-labelledby="library-projects-heading">
          <div className="flex min-h-8 items-center justify-between px-2"><h2 id="library-projects-heading" className="text-xs font-semibold text-secondary">{zh ? "项目" : "Projects"}</h2><span className="text-[11px] text-secondary">{groupedProjects.length}</span></div>
          <ProjectRows projects={groupedProjects} selectedId={selectedId} expandedProjects={expandedProjects} setExpandedProjects={setExpandedProjects} catalog={catalog} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />
        </section>
        <section className="mt-4" aria-labelledby="library-conversations-heading">
          <div className="flex min-h-8 items-center justify-between px-2"><h2 id="library-conversations-heading" className="text-xs font-semibold text-secondary">{zh ? "未归类" : "Unclassified"}</h2><span className="text-[11px] text-secondary">{unclassifiedConversations.length}</span></div>
          <ConversationRows rows={unclassifiedConversations} selectedId={selectedId} onOpen={onOpen} onDownload={onDownload} onRemove={onRemove} />
        </section>
      </>}
      {localRead.phase === "ready" && !sidebarConversations.length && !query ? <p className="px-3 py-8 text-center text-sm text-secondary">{zh ? "尚未下载资料" : "No offline conversations yet"}</p> : null}
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
    return <p className="flex min-h-9 items-center gap-2 rounded-md bg-subtle px-3 py-2 text-xs text-secondary"><AlertTriangle className="h-4 w-4 shrink-0" />{offlineShellStatusMessage(status, zh)}</p>;
  }
  return <div className="flex min-h-9 items-center gap-2 rounded-md bg-[var(--callout-warning-bg)] px-3 py-2 text-xs text-[var(--callout-warning-text)]"><AlertTriangle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{offlineShellStatusMessage(status, zh)}</span>{online ? <button type="button" onClick={onRetry} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface" aria-label={zh ? "重试准备离线启动" : "Retry offline preparation"} title={zh ? "重试" : "Retry"}><RefreshCw className="h-3.5 w-3.5" /></button> : null}</div>;
}

function offlineCatalogErrorMessage(failure: unknown, zh: boolean): string {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 401) return zh ? "登录已过期，在线目录暂不可用。请重新登录。" : "Your session expired. Sign in again to refresh the online catalog.";
    if (failure.status === 403) return zh ? "当前账户无法读取在线目录，已下载资料仍可使用。" : "This account cannot read the online catalog. Downloaded copies remain available.";
    if (failure.status === 429) return zh ? "在线目录请求过于频繁，请稍后重试。" : "Too many online catalog requests. Try again shortly.";
  }
  return zh
    ? "暂时无法更新在线目录，已下载资料仍保留。请点击“重试目录”。"
    : "The online catalog is temporarily unavailable. Downloaded copies are retained. Use Retry catalog.";
}

function offlineShellErrorMessage(failure: unknown, zh: boolean): string {
  if (failure instanceof ApiRequestError && failure.status === 401) {
    return zh ? "登录已过期，离线启动准备需要重新登录。" : "Your session expired. Sign in again to prepare offline access.";
  }
  return zh
    ? "离线启动准备失败，已有本地资料仍保留。请联网后重试。"
    : "Offline preparation failed. Existing local copies are retained. Reconnect and retry.";
}

function offlineShellStatusMessage(status: OfflineShellStatus, zh: boolean): string {
  if (status.availability === "unsupported") return zh ? "当前浏览器或连接不支持离线启动。" : "This browser or connection does not support offline access.";
  return zh
    ? "离线启动暂不可用，已有本地资料仍保留。请联网后重试。"
    : "Offline access is temporarily unavailable. Existing local copies are retained. Reconnect and retry.";
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

function SearchResultList({ items, query, conversations, onOpen, onOpenSearchResult }: {
  items: OfflineSearchDocument[];
  query: string;
  conversations: OfflineConversationRecord[];
  onOpen: (conversationId: string, messageId?: string | null, blockIndex?: number | null, characterOffset?: number | null) => void;
  onOpenSearchResult: (item: SearchResultItem) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const titles = new Map(conversations.map((item) => [item.id, item.display_title]));
  const routeKey = useSearchParams()?.toString() ?? "";
  const scope = useMemo<{ active: boolean; sequence: number; pendingId: string | null }>(
    () => ({ active: false, sequence: 0, pendingId: null }), [items, query, routeKey],
  );
  const [navigation, setNavigation] = useState<{ scope: typeof scope; pendingId: string | null; failedId: string | null } | null>(null);
  useLayoutEffect(() => {
    scope.active = true;
    return () => { scope.active = false; scope.sequence += 1; scope.pendingId = null; };
  }, [scope]);
  const activate = async (item: OfflineSearchDocument) => {
    if (!scope.active || scope.pendingId === item.id) return;
    const sequence = ++scope.sequence;
    const isCurrent = () => scope.active && scope.sequence === sequence;
    // Description/notebook entries keep their existing conversation-level behavior.
    if (!["message", "heading", "code", "attachment", "annotation"].includes(item.document_type)) {
      scope.pendingId = null;
      setNavigation(null);
      onOpen(item.conversation_id, item.message_id, metadataNumber(item.metadata, "block_index"), metadataNumber(item.metadata, "character_offset"));
      return;
    }
    scope.pendingId = item.id;
    setNavigation({ scope, pendingId: item.id, failedId: null });
    try {
      const result = await resolveOfflineSearchResult(item, query);
      if (!isCurrent()) return;
      scope.pendingId = null;
      setNavigation(null);
      onOpenSearchResult(result);
    } catch {
      if (isCurrent()) {
        scope.pendingId = null;
        setNavigation({ scope, pendingId: null, failedId: item.id });
      }
    }
  };
  return <div className="space-y-1">{items.map((item) => <div key={item.id}><button type="button" aria-busy={navigation?.scope === scope && navigation.pendingId === item.id || undefined} onClick={() => void activate(item)} className="w-full rounded-md px-3 py-2 text-left hover:bg-surface"><p className="truncate text-sm font-medium">{item.title || titles.get(item.conversation_id) || (zh ? "对话" : "Conversation")}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-secondary">{item.plain_text.slice(0, 240)}</p></button>{navigation?.scope === scope && navigation.failedId === item.id ? <p role="alert" className="px-3 pb-2 text-xs text-secondary">{zh ? "无法定位此结果，本地副本已保留。请重试。" : "Could not locate this result. Your local copy is retained. Try again."}</p> : null}</div>)}{!items.length ? <p className="px-3 py-8 text-center text-sm text-secondary">{zh ? "无本地结果" : "No offline results"}</p> : null}</div>;
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
  const timestamp = new Date(conversation.last_read_at ?? conversation.downloaded_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function offlineDownloadErrorMessage(reason: unknown, zh: boolean): string {
  if (reason instanceof OfflinePackageImportError) return offlineDownloadFailureMessage(reason.code, zh, false);
  if (reason instanceof ApiRequestError) {
    if (reason.status === 401) return zh ? "登录已过期，离线下载需要重新登录。" : "Your session expired. Sign in again to continue the offline download.";
    if (reason.status === 403) return zh ? "当前账户无法下载此离线资料。" : "This account cannot download this offline copy.";
    if (reason.status === 404) return zh ? "在线资料已不存在，请刷新目录后重试。" : "The online source is no longer available. Refresh the catalog and retry.";
    if (reason.status === 429) return zh ? "下载请求过于频繁，请稍后重试。" : "Too many download requests. Try again shortly.";
  }
  return offlineDownloadFailureMessage(null, zh, false);
}
