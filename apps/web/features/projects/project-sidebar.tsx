"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Archive, ChevronDown, ChevronRight, Folder, FolderOpen, GripVertical, Import, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createProject,
  getConversations,
  getProjectConversations,
  getProjects,
  moveConversationToProject,
  updateProject,
  updateProjectOrder,
} from "../../lib/api";
import type { ConversationListItem, ProjectConversationRead, ProjectRead } from "../../lib/types";
import { ConversationActionMenu } from "../conversations/conversation-action-menu";
import { ImportTaskMonitor } from "../import/import-task-monitor";
import { PreferencesPanel } from "../../components/preferences-panel";
import { useTranslations } from "../../components/preferences-provider";
import { usePreferences } from "../../components/preferences-provider";
import { useImportDialog } from "../../components/import-dialog-provider";
import { SidebarSearch } from "../search/sidebar-search";
import { ProjectSortMenu } from "../../components/sort-menu";
import { formatActivityTime, fullActivityTime } from "../../lib/activity-time";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

type DragConversation = { id: string; title: string; projectId: string | null };
type DragProject = { kind: "project"; id: string };

export function ProjectSidebar({
  currentProjectId,
  onImportClick,
  readerMode = false,
  mobileOpenSignal = 0,
  showMobileTrigger = true,
}: {
  currentProjectId?: string;
  onImportClick?: () => void;
  readerMode?: boolean;
  mobileOpenSignal?: number;
  showMobileTrigger?: boolean;
}) {
  const t = useTranslations();
  const { openImportDialog } = useImportDialog();
  const { conversationSortMode, conversationSortDirection, projectSortMode, projectSortDirection } = usePreferences();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(!readerMode || Boolean(currentProjectId));
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(currentProjectId ? [currentProjectId] : []));
  const [activeDrag, setActiveDrag] = useState<DragConversation | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const projectsQuery = useQuery({
    queryKey: ["projects", projectSortMode, projectSortDirection],
    queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }),
  });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", "active", conversationSortMode, conversationSortDirection],
    queryFn: () => getConversations({
      scope: "history",
      sort: conversationSortMode,
      direction: conversationSortDirection,
      limit: 200,
    }),
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
    mutationFn: ({ conversationId, projectId }: { conversationId: string; projectId: string | null }) =>
      moveConversationToProject(conversationId, projectId),
    onSuccess: () => void refreshSidebar(),
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

  function setReaderSidebarExpanded(expanded: boolean) {
    setDesktopExpanded(expanded);
    if (readerMode) window.localStorage.setItem("chat-reader:reader-sidebar-expanded", String(expanded));
  }

  const projects = useMemo(() => (projectsQuery.data ?? []).filter((project) => !project.is_default), [projectsQuery.data]);
  const conversations = (conversationsQuery.data ?? []).slice(0, 14);

  async function refreshSidebar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations", "active"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
    ]);
  }

  function handleDragStart(event: DragStartEvent) {
    const raw = event.active.data.current as (DragConversation & { kind?: string }) | undefined;
    if (raw?.kind === "project") return;
    const data = raw as DragConversation | undefined;
    if (data) setActiveDrag(data);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const projectDrag = event.active.data.current as DragProject | undefined;
    if (projectDrag?.kind === "project") {
      const targetId = String(event.over?.id ?? "").replace(/^project-order:/, "");
      const oldIndex = projects.findIndex((project) => project.id === projectDrag.id);
      const newIndex = projects.findIndex((project) => project.id === targetId);
      if (projectSortMode === "custom" && oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        await updateProjectOrder(arrayMove(projects, oldIndex, newIndex).map((project) => project.id));
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      setActiveDrag(null);
      return;
    }
    const data = event.active.data.current as DragConversation | undefined;
    const target = String(event.over?.id ?? "");
    setActiveDrag(null);
    if (!data || !target) return;
    const projectId = target === "history-drop" ? null : target.startsWith("project-drop:") ? target.slice(13) : undefined;
    if (projectId === undefined || projectId === data.projectId) return;
    moveMutation.mutate({ conversationId: data.id, projectId });
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
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={(event) => void handleDragEnd(event)} onDragCancel={() => setActiveDrag(null)}>
      {showMobileTrigger ? <button type="button" aria-label={t("openSidebar")} data-testid="mobile-sidebar-button" onClick={() => setShowMobileDrawer(true)} className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-ui bg-surface text-sm font-semibold text-primary shadow-sm md:hidden">CR</button> : null}
      <ImportTaskMonitor placement="mobile" />
      {showMobileDrawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label={t("closeSidebar")} className="absolute inset-0 bg-black/30" onClick={() => setShowMobileDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[20rem] flex-col overflow-hidden border-r border-ui bg-sidebar text-primary shadow-2xl">{content}</aside>
        </div>
      ) : null}
      {readerMode && !desktopExpanded ? (
        <aside className="hidden h-screen w-14 shrink-0 flex-col items-center border-r border-ui bg-sidebar py-3 text-primary md:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-white">CR</div>
          <button type="button" onClick={() => setReaderSidebarExpanded(true)} className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface hover:text-primary" aria-label={t("openSidebar")} title={t("openSidebar")}><PanelLeftOpen className="h-5 w-5" /></button>
          {currentProjectId ? <Folder className="mt-4 h-4 w-4 text-accent" aria-hidden="true" /> : null}
        </aside>
      ) : (
        <aside className="hidden h-screen w-[clamp(14rem,18vw,20rem)] shrink-0 flex-col overflow-hidden border-r border-ui bg-sidebar text-primary md:flex">{content}</aside>
      )}
      <DragOverlay>{activeDrag ? <div className="max-w-[15rem] truncate rounded-lg border border-[var(--accent)] bg-raised px-3 py-2 text-sm text-primary shadow-xl">{activeDrag.title}</div> : null}</DragOverlay>
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
  const [showPreferences, setShowPreferences] = useState(false);
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ui px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-semibold text-white">CR</div>
        <p className="truncate text-sm font-semibold">Chat Reader</p>
        {props.onCollapse ? <button type="button" onClick={props.onCollapse} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface hover:text-primary" aria-label={t("closeSidebar")} title={t("closeSidebar")}><PanelLeftClose className="h-5 w-5" /></button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <button type="button" data-testid="sidebar-import-button" onClick={props.onImportClick} className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-ui bg-surface px-3 text-sm font-medium shadow-sm hover:bg-subtle"><Import className="h-4 w-4" /> {t("importData")}</button>
        <SidebarSearch onNavigate={props.closeMobile} />
        <ImportTaskMonitor placement="sidebar" />
        <nav className="space-y-1">
          <NavLink href="/" label={t("conversations")} active={props.pathname === "/"} icon={<FolderOpen className="h-4 w-4" />} onClick={props.closeMobile} />
          <NavLink href="/archived" label={t("archived")} active={props.pathname === "/archived"} icon={<Archive className="h-4 w-4" />} onClick={props.closeMobile} />
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold text-secondary">{t("projects")}</h2>
            <div className="flex items-center gap-1"><ProjectSortMenu /><button type="button" aria-label="Create project" title="Create project" onClick={() => props.setShowProjectForm(!props.showProjectForm)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface"><Plus className="h-4 w-4" /></button></div>
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
        <button type="button" onClick={() => setShowPreferences((value) => !value)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-secondary hover:bg-surface"><Settings className="h-4 w-4" />{t("appearanceLanguage")}</button>
        {showPreferences ? <div className="mt-2 rounded-xl border border-ui bg-raised p-3"><PreferencesPanel /></div> : null}
      </div>
    </>
  );
}

function ProjectCreateForm(props: SidebarContentProps) {
  return (
    <form className="mt-2 rounded-xl border border-ui bg-surface p-2" onSubmit={(event) => { event.preventDefault(); props.onCreateProject(); }}>
      <input value={props.name} onChange={(event) => props.setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]" placeholder="项目名称" />
      <button type="submit" disabled={!props.name.trim() || props.createPending} className="mt-2 min-h-10 w-full rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50">创建项目</button>
      {props.createError ? <p className="mt-2 text-xs text-[var(--danger)]">{props.createError}</p> : null}
    </form>
  );
}

function ProjectBranch({ project, expanded, active, pathname, toggle, closeMobile, onChanged, onProjectChanged }: { project: ProjectRead; expanded: boolean; active: boolean; pathname: string; toggle: () => void; closeMobile: () => void; onChanged: () => Promise<void>; onProjectChanged: () => Promise<void> }) {
  const { conversationSortMode, conversationSortDirection, projectSortMode, resolvedLocale } = usePreferences();
  const sortable = useSortable({ id: `project-order:${project.id}`, disabled: projectSortMode !== "custom", data: { kind: "project", id: project.id } satisfies DragProject });
  const { setNodeRef, isOver } = useDroppable({ id: `project-drop:${project.id}` });
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", project.id, conversationSortMode, conversationSortDirection],
    queryFn: () => getProjectConversations(project.id, { sort: conversationSortMode, direction: conversationSortDirection }),
    enabled: expanded,
  });
  const conversations = (conversationsQuery.data ?? []).slice(0, 8);
  const projectActivityTime = projectSortMode === "updated" ? project.updated_at : projectSortMode === "created" ? project.created_at : project.last_read_at;
  return (
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}><div ref={setNodeRef} className={`rounded-lg ${isOver ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : ""}`}>
      <div className={`group flex min-h-9 items-center rounded-lg ${active ? "bg-subtle" : "hover:bg-surface"}`}>
        {projectSortMode === "custom" ? <button type="button" className="flex h-9 w-7 touch-none items-center justify-center text-secondary" aria-label="Drag to reorder project" {...sortable.attributes} {...sortable.listeners}><GripVertical className="h-4 w-4" /></button> : null}<button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} onClick={toggle} className="flex h-9 w-8 shrink-0 items-center justify-center text-secondary">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <Link href={`/projects/${project.id}`} onClick={closeMobile} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-sm" title={`${fullActivityTime(projectActivityTime, resolvedLocale)} · ${project.conversation_count}`}><Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{project.name}</span><span className="shrink-0 text-[11px] text-secondary">{formatActivityTime(projectActivityTime, resolvedLocale)}</span></Link>
        <ProjectMenu project={project} onChanged={onProjectChanged} />
      </div>
      {expanded ? (
        <div className="ml-6 border-l border-ui pl-1">
          {conversations.map((conversation) => <DraggableConversationRow key={conversation.id} conversation={conversation} projectId={project.id} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} />)}
          {conversationsQuery.isLoading ? <p className="px-3 py-2 text-xs text-secondary">正在加载对话…</p> : null}
          {(conversationsQuery.data?.length ?? 0) > 8 ? <Link href={`/projects/${project.id}`} className="block px-3 py-2 text-xs font-medium text-accent">查看全部</Link> : null}
          {!conversationsQuery.isLoading && conversations.length === 0 ? <p className="px-3 py-2 text-xs text-secondary">拖动对话到这里</p> : null}
        </div>
      ) : null}
    </div></div>
  );
}

function HistoryDropZone({ pathname, conversations, loading, error, closeMobile, onChanged }: { pathname: string; conversations: ConversationListItem[]; loading: boolean; error: string | null; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: "history-drop" });
  return (
    <div ref={setNodeRef} className={`mt-5 rounded-lg p-1 ${isOver ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : ""}`}>
      <h2 className="px-2 text-xs font-semibold text-secondary">对话记录</h2>
      <nav className="mt-2 space-y-1">
        {loading ? <p role="status" className="px-2 py-2 text-xs text-secondary">正在加载对话…</p> : null}
        {error ? <p role="alert" className="px-2 py-2 text-xs text-[var(--danger)]">加载失败</p> : null}
        {!loading && !error ? conversations.map((conversation) => <DraggableConversationRow key={conversation.id} conversation={conversation} projectId={null} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} />) : null}
        {!loading && !error && conversations.length === 0 ? <p className="px-2 py-2 text-xs leading-5 text-secondary">暂无未分类对话。导入后的对话会显示在这里。</p> : null}
      </nav>
    </div>
  );
}

function DraggableConversationRow({ conversation, projectId, active, closeMobile, onChanged }: { conversation: ConversationListItem | ProjectConversationRead; projectId: string | null; active: boolean; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const title = conversation.display_title || conversation.title;
  const { resolvedLocale } = usePreferences();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `conversation:${conversation.id}`, data: { id: conversation.id, title, projectId } satisfies DragConversation });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={`group flex min-h-9 items-center gap-1 rounded-lg pl-1 pr-1 ${isDragging ? "opacity-30" : ""} ${active ? "bg-subtle" : "hover:bg-surface"}`}>
      <button type="button" className="hidden h-7 w-6 touch-none items-center justify-center text-secondary group-hover:flex md:flex md:opacity-0 md:group-hover:opacity-100" aria-label={`Drag ${title}`} title="Drag to move" {...attributes} {...listeners}><GripVertical className="h-3.5 w-3.5" /></button>
      <Link href={`/conversations/${conversation.id}${projectId ? `?projectId=${projectId}` : ""}`} onClick={closeMobile} className="min-w-0 flex-1 truncate py-2 text-sm">{title}</Link>
      <span className="shrink-0 text-[11px] text-secondary group-hover:hidden group-focus-within:hidden" title={fullActivityTime(conversation.last_read_at, resolvedLocale)}>{formatActivityTime(conversation.last_read_at, resolvedLocale)}</span>
      <div className={active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}><ConversationActionMenu compact conversation={conversation} projectId={projectId ?? undefined} onChanged={onChanged} /></div>
    </div>
  );
}

function ProjectMenu({ project, onChanged }: { project: ProjectRead; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { resolvedLocale } = usePreferences();
  const dialog = useInteractionDialog();
  const zh = resolvedLocale === "zh-CN";
  return (
    <div className="relative mr-1">
      <button type="button" aria-label={`${zh ? "管理" : "Manage"} ${project.name}`} onClick={() => setOpen((value) => !value)} className="flex h-7 w-7 items-center justify-center rounded-md opacity-0 hover:bg-subtle group-hover:opacity-100 focus:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>
      {open ? <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border border-ui bg-raised p-1 shadow-xl">
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-subtle" onClick={async () => { const name = await dialog.prompt({ title: zh ? "重命名项目" : "Rename project", label: zh ? "项目名称" : "Project name", initialValue: project.name, confirmLabel: zh ? "保存" : "Save" }); if (name) { await updateProject(project.id, { name }); await onChanged(); } setOpen(false); }}><Pencil className="h-4 w-4" /> {zh ? "重命名" : "Rename"}</button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={async () => { const confirmed = await dialog.confirm({ title: zh ? `归档 ${project.name}？` : `Archive ${project.name}?`, description: zh ? "项目中的对话会暂时回到对话记录。" : "Conversations in this project will temporarily return to history.", confirmLabel: zh ? "归档" : "Archive", danger: true }); if (confirmed) { await updateProject(project.id, { is_archived: true }); await onChanged(); } setOpen(false); }}><Archive className="h-4 w-4" /> {zh ? "归档" : "Archive"}</button>
      </div> : null}
    </div>
  );
}

function NavLink({ href, label, active, icon, onClick }: { href: string; label: string; active: boolean; icon: React.ReactNode; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} className={`flex min-h-9 items-center gap-2 truncate rounded-lg px-3 py-2 text-sm ${active ? "bg-subtle" : "hover:bg-surface"}`}>{icon}{label}</Link>;
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}
