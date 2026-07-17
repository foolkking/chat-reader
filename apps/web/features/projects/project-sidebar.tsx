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
import { Archive, ChevronDown, ChevronRight, Folder, FolderOpen, GripVertical, Import, MoreHorizontal, Pencil, Plus, Search } from "lucide-react";
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
} from "../../lib/api";
import type { ConversationListItem, ProjectConversationRead, ProjectRead } from "../../lib/types";
import { ConversationActionMenu } from "../conversations/conversation-action-menu";
import { ImportTaskMonitor } from "../import/import-task-monitor";

type DragConversation = { id: string; title: string; projectId: string | null };

export function ProjectSidebar({ currentProjectId, onImportClick }: { currentProjectId?: string; onImportClick?: () => void }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(currentProjectId ? [currentProjectId] : []));
  const [activeDrag, setActiveDrag] = useState<DragConversation | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", "active"],
    queryFn: () => getConversations({ scope: "history" }),
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
    const data = event.active.data.current as DragConversation | undefined;
    if (data) setActiveDrag(data);
  }

  function handleDragEnd(event: DragEndEvent) {
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
      onImportClick={() => { setShowMobileDrawer(false); onImportClick?.(); }}
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
    />
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDrag(null)}>
      <button type="button" aria-label="打开侧栏" data-testid="mobile-sidebar-button" onClick={() => setShowMobileDrawer(true)} className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-[#d9d9d7] bg-white text-sm font-semibold text-[#111827] shadow-sm md:hidden">CR</button>
      <ImportTaskMonitor placement="mobile" />
      {showMobileDrawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close sidebar" className="absolute inset-0 bg-black/30" onClick={() => setShowMobileDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[320px] flex-col overflow-hidden border-r border-[#e5e5e5] bg-[#f9f9f9] text-[#111827] shadow-2xl">{content}</aside>
        </div>
      ) : null}
      <aside className="hidden h-screen w-[268px] shrink-0 flex-col overflow-hidden border-r border-[#e5e5e5] bg-[#f9f9f9] text-[#111827] md:flex">{content}</aside>
      <DragOverlay>{activeDrag ? <div className="max-w-[240px] truncate rounded-lg border border-[#10a37f] bg-white px-3 py-2 text-sm shadow-xl">{activeDrag.title}</div> : null}</DragOverlay>
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
};

function SidebarContent(props: SidebarContentProps) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#10a37f] text-xs font-semibold text-white">CR</div>
        <p className="truncate text-sm font-semibold">Chat Reader</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <button type="button" data-testid="sidebar-import-button" onClick={props.onImportClick} className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#d9d9d7] bg-white px-3 text-sm font-medium shadow-sm hover:bg-[#f4f4f4]"><Import className="h-4 w-4" /> 导入数据</button>
        <ImportTaskMonitor placement="sidebar" />
        <nav className="space-y-1">
          <NavLink href="/" label="对话" active={props.pathname === "/"} icon={<FolderOpen className="h-4 w-4" />} onClick={props.closeMobile} />
          <NavLink href="/search" label="搜索" active={props.pathname.startsWith("/search")} icon={<Search className="h-4 w-4" />} onClick={props.closeMobile} />
          <NavLink href="/archived" label="已归档" active={props.pathname === "/archived"} icon={<Archive className="h-4 w-4" />} onClick={props.closeMobile} />
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold text-[#6b7280]">项目</h2>
            <button type="button" aria-label="Create project" title="Create project" onClick={() => props.setShowProjectForm(!props.showProjectForm)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white"><Plus className="h-4 w-4" /></button>
          </div>
          {props.showProjectForm ? <ProjectCreateForm {...props} /> : null}
          <div className="mt-2 space-y-1">
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
          </div>
          {props.projectsLoading ? <p role="status" className="px-2 py-2 text-xs text-[#6b7280]">正在加载项目…</p> : null}
          {props.projectsError ? <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{props.projectsError}</p> : null}
        </div>

        <HistoryDropZone pathname={props.pathname} conversations={props.conversations} loading={props.conversationsLoading} error={props.conversationsError} closeMobile={props.closeMobile} onChanged={props.onConversationChanged} />
      </div>
    </>
  );
}

function ProjectCreateForm(props: SidebarContentProps) {
  return (
    <form className="mt-2 rounded-xl border border-[#e5e5e5] bg-white p-2" onSubmit={(event) => { event.preventDefault(); props.onCreateProject(); }}>
      <input value={props.name} onChange={(event) => props.setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-[#d9d9d7] px-3 text-sm outline-none focus:border-[#10a37f]" placeholder="项目名称" />
      <button type="submit" disabled={!props.name.trim() || props.createPending} className="mt-2 min-h-10 w-full rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:opacity-50">创建项目</button>
      {props.createError ? <p className="mt-2 text-xs text-red-700">{props.createError}</p> : null}
    </form>
  );
}

function ProjectBranch({ project, expanded, active, pathname, toggle, closeMobile, onChanged, onProjectChanged }: { project: ProjectRead; expanded: boolean; active: boolean; pathname: string; toggle: () => void; closeMobile: () => void; onChanged: () => Promise<void>; onProjectChanged: () => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: `project-drop:${project.id}` });
  const conversationsQuery = useQuery({ queryKey: ["project-conversations", project.id], queryFn: () => getProjectConversations(project.id), enabled: expanded });
  const conversations = (conversationsQuery.data ?? []).slice(0, 8);
  return (
    <div ref={setNodeRef} className={`rounded-lg ${isOver ? "bg-emerald-50 ring-1 ring-[#10a37f]" : ""}`}>
      <div className={`group flex min-h-9 items-center rounded-lg ${active ? "bg-[#e9e9e7]" : "hover:bg-white"}`}>
        <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} onClick={toggle} className="flex h-9 w-8 shrink-0 items-center justify-center text-[#6b7280]">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <Link href={`/projects/${project.id}`} onClick={closeMobile} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-sm"><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{project.name}</span><span className="ml-auto text-[11px] text-[#9ca3af]">{project.conversation_count}</span></Link>
        <ProjectMenu project={project} onChanged={onProjectChanged} />
      </div>
      {expanded ? (
        <div className="ml-6 border-l border-[#e5e7eb] pl-1">
          {conversations.map((conversation) => <DraggableConversationRow key={conversation.id} conversation={conversation} projectId={project.id} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} />)}
          {conversationsQuery.isLoading ? <p className="px-3 py-2 text-xs text-[#9ca3af]">正在加载对话…</p> : null}
          {(conversationsQuery.data?.length ?? 0) > 8 ? <Link href={`/projects/${project.id}`} className="block px-3 py-2 text-xs font-medium text-[#0f766e]">查看全部</Link> : null}
          {!conversationsQuery.isLoading && conversations.length === 0 ? <p className="px-3 py-2 text-xs text-[#9ca3af]">拖动对话到这里</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function HistoryDropZone({ pathname, conversations, loading, error, closeMobile, onChanged }: { pathname: string; conversations: ConversationListItem[]; loading: boolean; error: string | null; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: "history-drop" });
  return (
    <div ref={setNodeRef} className={`mt-5 rounded-lg p-1 ${isOver ? "bg-emerald-50 ring-1 ring-[#10a37f]" : ""}`}>
      <h2 className="px-2 text-xs font-semibold text-[#6b7280]">对话记录</h2>
      <nav className="mt-2 space-y-1">
        {loading ? <p role="status" className="px-2 py-2 text-xs text-[#6b7280]">正在加载对话…</p> : null}
        {error ? <p role="alert" className="px-2 py-2 text-xs text-red-700">加载失败</p> : null}
        {!loading && !error ? conversations.map((conversation) => <DraggableConversationRow key={conversation.id} conversation={conversation} projectId={null} active={pathname === `/conversations/${conversation.id}`} closeMobile={closeMobile} onChanged={onChanged} />) : null}
        {!loading && !error && conversations.length === 0 ? <p className="px-2 py-2 text-xs leading-5 text-[#6b7280]">暂无未分类对话。导入后的对话会显示在这里。</p> : null}
      </nav>
    </div>
  );
}

function DraggableConversationRow({ conversation, projectId, active, closeMobile, onChanged }: { conversation: ConversationListItem | ProjectConversationRead; projectId: string | null; active: boolean; closeMobile: () => void; onChanged: () => Promise<void> }) {
  const title = conversation.display_title || conversation.title;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `conversation:${conversation.id}`, data: { id: conversation.id, title, projectId } satisfies DragConversation });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={`group flex min-h-9 items-center gap-1 rounded-lg pl-1 pr-1 ${isDragging ? "opacity-30" : ""} ${active ? "bg-[#e9e9e7]" : "hover:bg-white"}`}>
      <button type="button" className="hidden h-7 w-6 touch-none items-center justify-center text-[#9ca3af] group-hover:flex md:flex md:opacity-0 md:group-hover:opacity-100" aria-label={`Drag ${title}`} title="Drag to move" {...attributes} {...listeners}><GripVertical className="h-3.5 w-3.5" /></button>
      <Link href={`/conversations/${conversation.id}`} onClick={closeMobile} className="min-w-0 flex-1 truncate py-2 text-sm">{title}</Link>
      <div className={active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}><ConversationActionMenu compact conversation={conversation} projectId={projectId ?? undefined} onChanged={onChanged} /></div>
    </div>
  );
}

function ProjectMenu({ project, onChanged }: { project: ProjectRead; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mr-1">
      <button type="button" aria-label={`Manage ${project.name}`} onClick={() => setOpen((value) => !value)} className="flex h-7 w-7 items-center justify-center rounded-md opacity-0 hover:bg-[#f3f4f6] group-hover:opacity-100 focus:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>
      {open ? <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-xl">
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[#f3f4f6]" onClick={async () => { const name = window.prompt("Rename project", project.name); if (name?.trim()) { await updateProject(project.id, { name: name.trim() }); await onChanged(); } setOpen(false); }}><Pencil className="h-4 w-4" /> Rename</button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={async () => { if (window.confirm(`Archive ${project.name}?`)) { await updateProject(project.id, { is_archived: true }); await onChanged(); } setOpen(false); }}><Archive className="h-4 w-4" /> Archive</button>
      </div> : null}
    </div>
  );
}

function NavLink({ href, label, active, icon, onClick }: { href: string; label: string; active: boolean; icon: React.ReactNode; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} className={`flex min-h-9 items-center gap-2 truncate rounded-lg px-3 py-2 text-sm ${active ? "bg-[#e9e9e7]" : "hover:bg-white"}`}>{icon}{label}</Link>;
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}
