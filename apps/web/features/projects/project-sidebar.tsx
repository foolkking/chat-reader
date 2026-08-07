"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Archive, ChevronDown, ChevronRight, Clock3, Folder, GripVertical, Import, PanelLeftClose, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createProject,
  getConversations,
  getProjectConversations,
  getProjects,
  placeConversation,
  placeProject,
} from "../../lib/api";
import type { ConversationListItem, ProjectConversationRead, ProjectRead } from "../../lib/types";
import { ConversationActionMenu } from "../conversations/conversation-action-menu";
import { ImportTaskMonitor } from "../import/import-task-monitor";
import { ReaderSidebarFrame } from "../../components/reader-sidebar-frame";
import { SidebarPreferences } from "../../components/sidebar-preferences";
import { useTranslations } from "../../components/preferences-provider";
import { usePreferences } from "../../components/preferences-provider";
import { useImportDialog } from "../../components/import-dialog-provider";
import { SidebarSearch } from "../search/sidebar-search";
import { ProjectSortMenu } from "../../components/sort-menu";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { ProjectActionMenu } from "./project-action-menu";

type DragConversation = { activeType: "conversation"; id: string; title: string; projectId: string | null; projectPinned: boolean; offlineRevision: number };
type DragProject = { activeType: "project"; id: string };
type ProjectOrderDrop = { dropType: "project-order-slot"; projectId: string };
type ConversationContainerDrop = { dropType: "project-conversation-container" | "unclassified-container"; projectId: string | null };
type ConversationInsertDrop = { dropType: "conversation-insert-slot"; projectId: string | null; beforeConversationId: string | null; afterConversationId: string | null };
type ConversationRowDrop = { dropType: "conversation-row"; projectId: string | null; conversationId: string; beforeConversationId: string; afterConversationId: string | null };
type DropData = ProjectOrderDrop | ConversationContainerDrop | ConversationInsertDrop | ConversationRowDrop;
type DropIntent =
  | { kind: "project-order"; projectId: string }
  | { kind: "conversation-placement"; projectId: string | null; beforeId: string | null; afterId: string | null };

const sidebarCollisionDetection: CollisionDetection = (args) => {
  const activeType = (args.active.data.current as DragConversation | DragProject | undefined)?.activeType;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const drop = container.data.current as DropData | undefined;
    const dropType = drop?.dropType;
    return activeType === "project"
      ? dropType === "project-order-slot"
      : (dropType === "conversation-insert-slot" || dropType === "conversation-row" || dropType === "project-conversation-container" || dropType === "unclassified-container")
        && !(dropType === "conversation-row" && drop?.conversationId === String(args.active.id).replace(/^conversation:/, ""));
  });
  const scoped = { ...args, droppableContainers };
  const collisions = pointerWithin(scoped);
  const fallback = collisions.length ? collisions : rectIntersection(scoped);
  const centered = fallback.length ? fallback : closestCenter(scoped);
  return [...centered].sort((left, right) => dropPriority(left.data?.droppableContainer.data.current as DropData | undefined) - dropPriority(right.data?.droppableContainer.data.current as DropData | undefined));
};

function dropPriority(drop: DropData | undefined): number {
  if (drop?.dropType === "conversation-insert-slot") return 0;
  if (drop?.dropType === "conversation-row") return 1;
  if (drop?.dropType === "project-conversation-container") return 2;
  if (drop?.dropType === "unclassified-container") return 3;
  return 4;
}

function dropIntentFromData(drop: DropData | undefined): DropIntent | null {
  if (!drop) return null;
  if (drop.dropType === "project-order-slot") return { kind: "project-order", projectId: drop.projectId };
  if (drop.dropType === "conversation-insert-slot") {
    return { kind: "conversation-placement", projectId: drop.projectId, beforeId: drop.beforeConversationId, afterId: drop.afterConversationId };
  }
  if (drop.dropType === "conversation-row") {
    return { kind: "conversation-placement", projectId: drop.projectId, beforeId: drop.beforeConversationId, afterId: drop.afterConversationId };
  }
  return { kind: "conversation-placement", projectId: drop.projectId, beforeId: null, afterId: null };
}

export function MobileSidebarTrigger({
  onOpen,
  className = "",
}: {
  onOpen: () => void;
  className?: string;
}) {
  const t = useTranslations();
  return (
    <button
      type="button"
      aria-label={t("openSidebar")}
      title={t("openSidebar")}
      data-testid="mobile-sidebar-button"
      onClick={onOpen}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ui bg-surface text-xs font-semibold text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)] md:hidden ${className}`}
    >
      CR
    </button>
  );
}

export function ProjectSidebar({
  currentProjectId,
  onImportClick,
  readerMode = false,
  mobileOpenSignal = 0,
  showMobileTrigger = false,
}: {
  currentProjectId?: string;
  onImportClick?: () => void;
  readerMode?: boolean;
  mobileOpenSignal?: number;
  showMobileTrigger?: boolean;
}) {
  const t = useTranslations();
  const { openImportDialog } = useImportDialog();
  const { conversationSortMode, conversationSortDirection, projectSortMode, projectSortDirection, resolvedLocale } = usePreferences();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(!readerMode || Boolean(currentProjectId));
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(currentProjectId ? [currentProjectId] : []));
  const [activeDrag, setActiveDrag] = useState<DragConversation | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const dropIntentRef = useRef<DropIntent | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const autoExpandRef = useRef<{ projectId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pendingGlobalSearchFocusRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectsQuery = useQuery({
    queryKey: ["projects", projectSortMode, projectSortDirection],
    queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }),
    // Keep droppable project rows mounted while a background refresh runs.
    // Unmounting a target mid-drag makes dnd-kit fall back to the unclassified
    // container and loses the placement intent.
    placeholderData: (previous) => previous,
  });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", "history", conversationSortMode, conversationSortDirection],
    queryFn: () => getConversations({
      scope: "history",
      sort: conversationSortMode,
      direction: conversationSortDirection,
      limit: 5000,
    }),
    placeholderData: (previous) => previous,
  });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      setName("");
      setShowProjectForm(false);
      setExpandedProjects((current) => new Set(current).add(project.id));
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const moveMutation = useMutation({
    mutationFn: ({ conversationId, projectId, beforeId, afterId, offlineRevision }: { conversationId: string; projectId: string | null; sourceProjectId: string | null; beforeId?: string; afterId?: string; offlineRevision: number }) =>
      placeConversation(conversationId, {
        target_project_id: projectId,
        target_section: "normal",
        before_conversation_id: beforeId ?? null,
        after_conversation_id: afterId ?? null,
        expected_offline_revision: offlineRevision,
      }),
    onMutate: async (variables) => {
      setDragError(null);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projects"] }),
        queryClient.cancelQueries({ queryKey: ["project-conversations"] }),
        queryClient.cancelQueries({ queryKey: ["conversations", "history"] }),
      ]);
      const projectSnapshots = queryClient.getQueriesData<ProjectRead[]>({ queryKey: ["projects"] });
      const branchSnapshots = queryClient.getQueriesData<ProjectConversationRead[]>({ queryKey: ["project-conversations"] });
      const historySnapshots = queryClient.getQueriesData<ConversationListItem[]>({ queryKey: ["conversations", "history"] });
      const targetProject = projects.find((project) => project.id === variables.projectId);
      const optimisticConversation = findConversationInSnapshots(variables.conversationId, branchSnapshots, historySnapshots);
      if (optimisticConversation) {
        const moved = {
          ...optimisticConversation,
          project_id: variables.projectId,
          project_name: targetProject?.name ?? null,
          offline_revision: optimisticConversation.offline_revision + 1,
          ...(isProjectConversation(optimisticConversation)
            ? { project_relation: { ...optimisticConversation.project_relation, is_pinned: false, pinned_at: null } }
            : {}),
        } as ProjectConversationRead;
        for (const [key, rows] of branchSnapshots) {
          if (!rows) continue;
          const projectId = String(key[1] ?? "");
          const without = rows.filter((item) => item.id !== variables.conversationId);
          queryClient.setQueryData(key, projectId === variables.projectId ? insertConversation(without, moved, variables.beforeId, variables.afterId) : without);
        }
        for (const [key, rows] of historySnapshots) {
          if (!rows) continue;
          const without = rows.filter((item) => item.id !== variables.conversationId);
          queryClient.setQueryData(key, variables.projectId === null ? insertConversation(without, moved, variables.beforeId, variables.afterId) : without);
        }
      }
      for (const [key, rows] of projectSnapshots) {
        if (!rows || variables.sourceProjectId === variables.projectId) continue;
        queryClient.setQueryData(key, rows.map((project) => ({
          ...project,
          conversation_count: project.id === variables.sourceProjectId
            ? Math.max(0, project.conversation_count - 1)
            : project.id === variables.projectId
              ? project.conversation_count + 1
              : project.conversation_count,
        })));
      }
      return { projectSnapshots, branchSnapshots, historySnapshots };
    },
    onSuccess: (_result, variables) => {
      const movedProjectId = variables.projectId;
      if (typeof movedProjectId === "string") setExpandedProjects((current) => new Set(current).add(movedProjectId));
    },
    onError: (error, _variables, context) => {
      for (const [key, value] of context?.projectSnapshots ?? []) queryClient.setQueryData(key, value);
      for (const [key, value] of context?.branchSnapshots ?? []) queryClient.setQueryData(key, value);
      for (const [key, value] of context?.historySnapshots ?? []) queryClient.setQueryData(key, value);
      setDragError(error.message);
    },
    onSettled: () => {
      void refreshSidebar();
    },
  });

  useEffect(() => {
    if (currentProjectId) setExpandedProjects((current) => new Set(current).add(currentProjectId));
  }, [currentProjectId]);

  useEffect(() => {
    if (mobileOpenSignal > 0) setShowMobileDrawer(true);
  }, [mobileOpenSignal]);

  useEffect(() => {
    if (!readerMode || currentProjectId) return;
    setDesktopExpanded(window.localStorage.getItem("chat-reader:reader-sidebar-expanded") === "true");
  }, [currentProjectId, readerMode]);

  useEffect(() => {
    if (!readerMode) return;
    const openGlobalSearch = () => {
      const existingInput = document.querySelector<HTMLInputElement>('[data-testid="sidebar-global-search"]');
      if (existingInput) {
        existingInput.focus();
        return;
      }
      pendingGlobalSearchFocusRef.current = true;
      if (window.matchMedia("(max-width: 767px)").matches) {
        setShowMobileDrawer(true);
      } else {
        setDesktopExpanded(true);
        window.localStorage.setItem("chat-reader:reader-sidebar-expanded", "true");
      }
    };
    window.addEventListener("chat-reader:focus-global-search", openGlobalSearch);
    return () => window.removeEventListener("chat-reader:focus-global-search", openGlobalSearch);
  }, [readerMode]);

  useEffect(() => {
    if (!pendingGlobalSearchFocusRef.current || (!desktopExpanded && !showMobileDrawer)) return;
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="sidebar-global-search"]');
      if (!input) return;
      pendingGlobalSearchFocusRef.current = false;
      input.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [desktopExpanded, showMobileDrawer]);

  function setReaderSidebarExpanded(expanded: boolean) {
    setDesktopExpanded(expanded);
    if (readerMode) window.localStorage.setItem("chat-reader:reader-sidebar-expanded", String(expanded));
  }

  const projects = useMemo(() => (projectsQuery.data ?? []).filter((project) => !project.is_default), [projectsQuery.data]);
  const conversations = conversationsQuery.data ?? [];

  async function refreshSidebar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations", "history"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
    ]);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragError(null);
    const raw = event.active.data.current as DragConversation | DragProject | undefined;
    if (raw?.activeType === "conversation") setActiveDrag(raw);
    updateDropIntent(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const projectDrag = event.active.data.current as DragProject | undefined;
    const intent = dropIntentRef.current;
    updateDropIntent(null);
    if (projectDrag?.activeType === "project") {
      const targetId = intent?.kind === "project-order" ? intent.projectId : null;
      if (projectSortMode === "custom" && targetId && targetId !== projectDrag.id) await reorderProject(projectDrag.id, targetId, event);
      setActiveDrag(null);
      clearAutoExpand();
      return;
    }
    const data = event.active.data.current as DragConversation | undefined;
    setActiveDrag(null);
    clearAutoExpand();
    if (!data || data.activeType !== "conversation" || intent?.kind !== "conversation-placement") return;
    const projectId = intent.projectId;
    if (projectId === data.projectId && !intent.beforeId && !intent.afterId) return;
    if (intent.beforeId || intent.afterId) {
      if (projectId === data.projectId && conversationSortMode !== "custom") {
        setDragError(t("custom") + (resolvedLocale === "zh-CN" ? "排序下才能调整项目内顺序。" : " sorting is required to reorder within a project."));
        return;
      }
      const placeBefore = Boolean(intent.beforeId);
      moveMutation.mutate({
        conversationId: data.id,
        projectId,
        sourceProjectId: data.projectId,
        beforeId: placeBefore ? intent.beforeId ?? undefined : undefined,
        afterId: placeBefore ? undefined : intent.afterId ?? undefined,
        offlineRevision: data.offlineRevision,
      });
      return;
    }
    moveMutation.mutate({ conversationId: data.id, projectId, sourceProjectId: data.projectId, offlineRevision: data.offlineRevision });
  }

  function handleDragOver(event: DragOverEvent) {
    const active = event.active.data.current as DragConversation | DragProject | undefined;
    const nextIntent = dropIntentFromData(event.over?.data.current as DropData | undefined);
    updateDropIntent(nextIntent);
    const projectId = nextIntent?.kind === "conversation-placement" ? nextIntent.projectId : null;
    if (active?.activeType !== "conversation" || !projectId || expandedProjects.has(projectId)) {
      clearAutoExpand();
      return;
    }
    if (autoExpandRef.current?.projectId === projectId) return;
    clearAutoExpand();
    autoExpandRef.current = {
      projectId,
      timer: setTimeout(() => {
        setExpandedProjects((current) => new Set(current).add(projectId));
        autoExpandRef.current = null;
      }, 650),
    };
  }

  function updateDropIntent(intent: DropIntent | null) {
    dropIntentRef.current = intent;
    setDropIntent(intent);
  }

  function clearAutoExpand() {
    if (autoExpandRef.current) clearTimeout(autoExpandRef.current.timer);
    autoExpandRef.current = null;
  }

  async function reorderProject(activeId: string, targetId: string, event: DragEndEvent) {
    const activeRect = event.active.rect.current.translated;
    const beforeTarget = !activeRect || activeRect.top + activeRect.height / 2 < event.over!.rect.top + event.over!.rect.height / 2;
    const remaining = projects.filter((project) => project.id !== activeId);
    const targetIndex = remaining.findIndex((project) => project.id === targetId);
    if (targetIndex < 0) return;
    const insertAt = targetIndex + (beforeTarget ? 0 : 1);
    const moved = projects.find((project) => project.id === activeId);
    if (!moved) return;
    const ordered = [...remaining];
    ordered.splice(insertAt, 0, moved);
    const index = ordered.findIndex((project) => project.id === activeId);
    const snapshots = queryClient.getQueriesData<ProjectRead[]>({ queryKey: ["projects"] });
    for (const [key, value] of snapshots) if (value) queryClient.setQueryData(key, ordered);
    try {
      await placeProject(activeId, {
        after_project_id: ordered[index - 1]?.id ?? null,
        before_project_id: ordered[index + 1]?.id ?? null,
      });
    } catch (error) {
      for (const [key, value] of snapshots) queryClient.setQueryData(key, value);
      setDragError(error instanceof Error ? error.message : String(error));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  }

  const content = (
    <SidebarContent
      pathname={pathname}
      currentProjectId={currentProjectId}
      projects={projects}
      projectsLoading={projectsQuery.isLoading}
      projectsError={projectsQuery.isError ? projectsQuery.error.message : null}
      conversations={conversations}
      conversationsLoading={conversationsQuery.isLoading}
      conversationsError={conversationsQuery.isError ? conversationsQuery.error.message : null}
      expandedProjects={expandedProjects}
      toggleProject={(projectId) => setExpandedProjects((current) => toggleSet(current, projectId))}
      onImportClick={() => {
        setShowMobileDrawer(false);
        (onImportClick ?? openImportDialog)();
      }}
      showProjectForm={showProjectForm}
      setShowProjectForm={setShowProjectForm}
      name={name}
      setName={setName}
      createPending={createMutation.isPending}
      createError={createMutation.isError ? createMutation.error.message : null}
      onCreateProject={() => { const trimmed = name.trim(); if (trimmed) createMutation.mutate({ name: trimmed, icon: "folder" }); }}
      onConversationChanged={refreshSidebar}
      onProjectChanged={refreshSidebar}
      closeMobile={() => setShowMobileDrawer(false)}
      onCollapse={readerMode ? () => setReaderSidebarExpanded(false) : undefined}
    />
  );

  return (
    <DndContext sensors={sensors} autoScroll collisionDetection={sidebarCollisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={(event) => void handleDragEnd(event)} onDragCancel={() => { setActiveDrag(null); updateDropIntent(null); clearAutoExpand(); }}>
      {showMobileTrigger ? <button type="button" aria-label={t("openSidebar")} data-testid="mobile-sidebar-button" onClick={() => setShowMobileDrawer(true)} className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-ui bg-surface text-sm font-semibold text-primary shadow-sm md:hidden">CR</button> : null}
      <ImportTaskMonitor placement="mobile" />
      <ReaderSidebarFrame
        desktopExpanded={!readerMode || desktopExpanded}
        onDesktopExpand={() => setReaderSidebarExpanded(true)}
        mobileOpen={showMobileDrawer}
        onMobileClose={() => setShowMobileDrawer(false)}
        railExtra={currentProjectId ? <Folder className="mt-4 h-4 w-4 text-accent" aria-hidden="true" /> : null}
      >
        {content}
      </ReaderSidebarFrame>
      <DragOverlay>{activeDrag ? <div data-testid="sidebar-drag-overlay" data-drop-intent={dropIntent?.kind ?? "none"} className="max-w-[15rem] truncate rounded-lg border border-[var(--accent)] bg-raised px-3 py-2 text-sm text-primary shadow-xl">{activeDrag.title}</div> : null}</DragOverlay>
      {dragError ? <div role="alert" className="fixed bottom-4 left-1/2 z-[240] max-w-sm -translate-x-1/2 rounded-lg border border-[var(--danger)] bg-raised px-4 py-3 text-sm text-[var(--danger)] shadow-xl">{dragError}</div> : null}
    </DndContext>
  );
}

type SidebarContentProps = {
  pathname: string;
  currentProjectId?: string;
  projects: ProjectRead[];
  projectsLoading: boolean;
  projectsError: string | null;
  conversations: ConversationListItem[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  expandedProjects: Set<string>;
  toggleProject: (projectId: string) => void;
  onImportClick: () => void;
  showProjectForm: boolean;
  setShowProjectForm: (value: boolean) => void;
  name: string;
  setName: (value: string) => void;
  createPending: boolean;
  createError: string | null;
  onCreateProject: () => void;
  onConversationChanged: () => Promise<void>;
  onProjectChanged: () => Promise<void>;
  closeMobile: () => void;
  onCollapse?: () => void;
};

function SidebarContent(props: SidebarContentProps) {
  const t = useTranslations();
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ui px-4">
        <Link href="/" onClick={props.closeMobile} className="flex min-w-0 items-center gap-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label="Chat Reader 首页">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-white">CR</span>
          <span className="truncate text-sm font-semibold">Chat Reader</span>
        </Link>
        {props.onCollapse ? <button type="button" onClick={props.onCollapse} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface hover:text-primary" aria-label={t("closeSidebar")} title={t("closeSidebar")}><PanelLeftClose className="h-5 w-5" /></button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <button type="button" data-testid="sidebar-import-button" onClick={props.onImportClick} className="mb-3 hidden min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-ui bg-surface px-3 text-sm font-medium shadow-sm hover:bg-subtle md:flex"><Import className="h-4 w-4" /> {t("importData")}</button>
        <SidebarSearch onNavigate={props.closeMobile} />
        <ImportTaskMonitor placement="sidebar" />
        <nav className="grid grid-cols-2 gap-1 md:grid-cols-1" aria-label={t("quickNavigation")}>
          <NavLink href="/recent" label={t("recent")} active={props.pathname === "/recent"} icon={<Clock3 className="h-4 w-4" />} onClick={props.closeMobile} className="md:hidden" />
          <NavLink href="/archived" label={t("archived")} active={props.pathname === "/archived"} icon={<Archive className="h-4 w-4" />} onClick={props.closeMobile} />
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold text-secondary">{t("projects")}</h2>
            <div className="hidden items-center gap-1 md:flex"><ProjectSortMenu /><button type="button" aria-label="Create project" title="Create project" onClick={() => props.setShowProjectForm(!props.showProjectForm)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface"><Plus className="h-4 w-4" /></button></div>
          </div>
          {props.showProjectForm ? <ProjectCreateForm {...props} /> : null}
          <SortableContext items={props.projects.map((project) => `project-order:${project.id}`)} strategy={verticalListSortingStrategy}><div className="mt-2 space-y-1">
            {props.projects.map((project) => (
              <ProjectBranch
                key={project.id}
                project={project}
                expanded={props.expandedProjects.has(project.id)}
                active={props.currentProjectId === project.id}
                pathname={props.pathname}
                toggle={() => props.toggleProject(project.id)}
                closeMobile={props.closeMobile}
                onChanged={props.onConversationChanged}
                onProjectChanged={props.onProjectChanged}
              />
            ))}
          </div></SortableContext>
          {props.projectsLoading ? <p role="status" className="px-2 py-2 text-xs text-secondary">{t("loadingProjects")}</p> : null}
          {props.projectsError ? <p className="mt-2 rounded-md bg-[var(--danger-soft)] px-2 py-1 text-xs text-[var(--danger)]">{props.projectsError}</p> : null}
        </div>

        <HistoryDropZone pathname={props.pathname} conversations={props.conversations} loading={props.conversationsLoading} error={props.conversationsError} closeMobile={props.closeMobile} onChanged={props.onConversationChanged} />
      </div>
      <div className="shrink-0 border-t border-ui p-3">
        <SidebarPreferences />
      </div>
    </>
  );
}

function ProjectCreateForm(props: SidebarContentProps) {
  return (
    <form className="mt-2 hidden rounded-xl border border-ui bg-surface p-2 md:block" onSubmit={(event) => { event.preventDefault(); props.onCreateProject(); }}>
      <input value={props.name} onChange={(event) => props.setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]" placeholder="项目名称" />
      <button type="submit" disabled={!props.name.trim() || props.createPending} className="mt-2 min-h-10 w-full rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50">创建项目</button>
      {props.createError ? <p className="mt-2 text-xs text-[var(--danger)]">{props.createError}</p> : null}
    </form>
  );
}

function ProjectBranch({ project, expanded, active, pathname, toggle, closeMobile, onChanged, onProjectChanged }: { project: ProjectRead; expanded: boolean; active: boolean; pathname: string; toggle: () => void; closeMobile: () => void; onChanged: () => Promise<void>; onProjectChanged: () => Promise<void> }) {
  const { conversationSortMode, conversationSortDirection, projectSortMode, resolvedLocale } = usePreferences();
  const sortable = useSortable({ id: `project-order:${project.id}`, disabled: projectSortMode !== "custom", data: { activeType: "project", dropType: "project-order-slot", id: project.id, projectId: project.id } satisfies DragProject & ProjectOrderDrop });
  const { setNodeRef, isOver } = useDroppable({ id: `project-conversation-container:${project.id}`, data: { dropType: "project-conversation-container", projectId: project.id } satisfies ConversationContainerDrop });
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", project.id, conversationSortMode, conversationSortDirection],
    queryFn: () => getProjectConversations(project.id, { sort: conversationSortMode, direction: conversationSortDirection, limit: 5000 }),
    enabled: expanded,
    placeholderData: (previous) => previous,
  });
  const conversations = conversationsQuery.data ?? [];
  const projectActivityTime = projectSortMode === "updated" ? project.updated_at : projectSortMode === "created" ? project.created_at : project.last_read_at;
  return (
    <div ref={sortable.setNodeRef} data-testid={`project-order-slot-${project.id}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}><div ref={setNodeRef} data-testid={`project-conversation-container-${project.id}`} className={`rounded-lg ${isOver ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : ""}`}>
      <div className={`group flex min-h-9 items-center rounded-lg ${active ? "bg-subtle" : "hover:bg-surface"}`}>
        {projectSortMode === "custom" ? <button type="button" className="hidden h-9 w-7 touch-none items-center justify-center text-secondary md:flex" aria-label="Drag to reorder project" {...sortable.attributes} {...sortable.listeners}><GripVertical className="h-4 w-4" /></button> : null}<button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} onClick={toggle} className="flex h-9 w-8 shrink-0 items-center justify-center text-secondary">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <Link href={`/projects/${project.id}`} onClick={closeMobile} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-sm" title={`${fullActivityTime(projectActivityTime, resolvedLocale)} · ${project.conversation_count}`}><Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{project.name}</span><span className="shrink-0 text-[11px] text-secondary">{formatActivityTime(projectActivityTime, resolvedLocale)}</span></Link>
        <ProjectActionMenu project={project} onChanged={onProjectChanged} />
      </div>
      {expanded ? (
        <div className="ml-6 border-l border-ui pl-1">
          {conversations.map((conversation, index) => <div key={conversation.id}><ConversationInsertSlot projectId={project.id} beforeConversationId={conversation.id} afterConversationId={conversations[index - 1]?.id ?? null} /><DraggableConversationRow conversation={conversation} projectId={project.id} beforeConversationId={conversation.id} afterConversationId={conversations[index - 1]?.id ?? null} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} /></div>)}
          {conversations.length ? <ConversationInsertSlot projectId={project.id} beforeConversationId={null} afterConversationId={conversations[conversations.length - 1].id} /> : null}
          {conversationsQuery.isLoading ? <p className="px-3 py-2 text-xs text-secondary">正在加载对话…</p> : null}
          {!conversationsQuery.isLoading && conversations.length === 0 ? <p className="px-3 py-2 text-xs text-secondary">拖动对话到这里</p> : null}
        </div>
      ) : null}
    </div></div>
  );
}

function HistoryDropZone({ pathname, conversations, loading, error, closeMobile, onChanged }: { pathname: string; conversations: ConversationListItem[]; loading: boolean; error: string | null; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unclassified-container", data: { dropType: "unclassified-container", projectId: null } satisfies ConversationContainerDrop });
  const t = useTranslations();
  return (
    <div className="mt-5 rounded-lg p-1">
      <div ref={setNodeRef} data-testid="unclassified-container" className={`flex min-h-9 items-center justify-between rounded-lg px-2 ${isOver ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : ""}`}><h2 className="text-xs font-semibold text-secondary">{t("unclassified")}</h2><span className="text-[11px] text-secondary">{conversations.length}</span></div>
      <nav className="mt-2 space-y-1">
        {loading ? <p role="status" className="px-2 py-2 text-xs text-secondary">正在加载对话…</p> : null}
        {error ? <p role="alert" className="px-2 py-2 text-xs text-[var(--danger)]">加载失败</p> : null}
        {!loading && !error ? conversations.map((conversation, index) => <div key={conversation.id}><ConversationInsertSlot projectId={null} beforeConversationId={conversation.id} afterConversationId={conversations[index - 1]?.id ?? null} /><DraggableConversationRow conversation={conversation} projectId={conversation.project_id} beforeConversationId={conversation.id} afterConversationId={conversations[index - 1]?.id ?? null} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} /></div>) : null}
        {!loading && !error && conversations.length ? <ConversationInsertSlot projectId={null} beforeConversationId={null} afterConversationId={conversations[conversations.length - 1].id} /> : null}
        {!loading && !error && conversations.length === 0 ? <p className="px-2 py-2 text-xs leading-5 text-secondary">{t("noUnclassified")}</p> : null}
      </nav>
    </div>
  );
}

function DraggableConversationRow({ conversation, projectId, beforeConversationId, afterConversationId, active, closeMobile, onChanged }: { conversation: ConversationListItem | ProjectConversationRead; projectId: string | null; beforeConversationId: string; afterConversationId: string | null; active: boolean; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const title = conversation.display_title || conversation.title;
  const { resolvedLocale } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const projectPinned = isProjectConversation(conversation) ? conversation.project_relation.is_pinned : false;
  const draggable = useDraggable({ id: `conversation:${conversation.id}`, data: { activeType: "conversation", id: conversation.id, title, projectId, projectPinned, offlineRevision: conversation.offline_revision } satisfies DragConversation });
  const droppable = useDroppable({ id: `conversation-row:${conversation.id}`, data: { dropType: "conversation-row", projectId, conversationId: conversation.id, beforeConversationId, afterConversationId } satisfies ConversationRowDrop });
  const setRowRef = (node: HTMLDivElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  return (
    <div ref={setRowRef} data-testid={`conversation-row-${conversation.id}`} data-project-id={projectId ?? "unclassified"} style={{ transform: CSS.Translate.toString(draggable.transform) }} {...draggable.attributes} {...draggable.listeners} className={`group flex min-h-12 touch-pan-y items-start gap-1 rounded-lg pl-1 pr-1 outline-none ${draggable.isDragging ? "opacity-30" : ""} ${droppable.isOver ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : active || menuOpen ? "bg-subtle" : "hover:bg-surface"}`}>
      <span
        data-testid={`conversation-drag-handle-${conversation.id}`}
        className="flex h-9 w-7 shrink-0 touch-none items-center justify-center text-secondary opacity-45 group-hover:opacity-100"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          draggable.listeners?.onPointerDown(event);
        }}
      ><GripVertical className="h-3.5 w-3.5" /></span>
      <Link data-no-dnd href={`/conversations/${conversation.id}${projectId ? `?projectId=${projectId}` : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={closeMobile} className="min-w-0 flex-1 py-2"><span className="block truncate text-sm">{title}</span><span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-secondary">{conversation.description_markdown || conversation.first_user_message || "无摘要"}</span>{conversation.project_name ? <span className="mt-0.5 block truncate text-[10px] text-accent">{conversation.project_name}</span> : null}</Link>
      <span className="shrink-0 text-[11px] text-secondary group-hover:hidden group-focus-within:hidden" title={fullActivityTime(conversation.last_read_at, resolvedLocale)}>{formatActivityTime(conversation.last_read_at, resolvedLocale)}</span>
      <div data-no-dnd onPointerDown={(event) => event.stopPropagation()} className={active || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}><ConversationActionMenu compact conversation={conversation} projectId={projectId ?? undefined} projectPinned={projectPinned} onChanged={onChanged} onOpenChange={setMenuOpen} /></div>
    </div>
  );
}

function ConversationInsertSlot({ projectId, beforeConversationId, afterConversationId }: { projectId: string | null; beforeConversationId: string | null; afterConversationId: string | null }) {
  const id = `conversation-insert:${projectId ?? "unclassified"}:${beforeConversationId ?? "end"}`;
  const { setNodeRef, isOver } = useDroppable({ id, data: { dropType: "conversation-insert-slot", projectId, beforeConversationId, afterConversationId } satisfies ConversationInsertDrop });
  return <div ref={setNodeRef} data-testid={id} aria-hidden="true" className={`h-1 rounded-full transition-colors ${isOver ? "bg-[var(--accent)]" : "bg-transparent"}`} />;
}

function NavLink({ href, label, active, icon, onClick, className = "" }: { href: string; label: string; active: boolean; icon: React.ReactNode; onClick?: () => void; className?: string }) {
  return <Link href={href} onClick={onClick} className={`flex min-h-9 items-center gap-2 truncate rounded-lg px-3 py-2 text-sm ${active ? "bg-subtle" : "hover:bg-surface"} ${className}`}>{icon}{label}</Link>;
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function isProjectConversation(
  conversation: ConversationListItem | ProjectConversationRead,
): conversation is ProjectConversationRead {
  return "project_relation" in conversation;
}

function findConversationInSnapshots(
  conversationId: string,
  branchSnapshots: Array<[readonly unknown[], ProjectConversationRead[] | undefined]>,
  historySnapshots: Array<[readonly unknown[], ConversationListItem[] | undefined]>,
): ConversationListItem | ProjectConversationRead | null {
  for (const [, rows] of branchSnapshots) {
    const match = rows?.find((item) => item.id === conversationId);
    if (match) return match;
  }
  for (const [, rows] of historySnapshots) {
    const match = rows?.find((item) => item.id === conversationId);
    if (match) return match;
  }
  return null;
}

function insertConversation<T extends ConversationListItem>(
  rows: T[],
  conversation: T,
  beforeId?: string,
  afterId?: string,
): T[] {
  const next = [...rows];
  const beforeIndex = beforeId ? next.findIndex((item) => item.id === beforeId) : -1;
  const afterIndex = afterId ? next.findIndex((item) => item.id === afterId) : -1;
  const index = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : next.length;
  next.splice(index, 0, conversation);
  return next;
}
