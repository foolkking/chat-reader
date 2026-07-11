"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createProject, getConversations, getProjects } from "../../lib/api";
import type { ConversationListItem } from "../../lib/types";
import { ConversationActionMenu } from "../conversations/conversation-action-menu";

export function ProjectSidebar({
  currentProjectId,
  onImportClick,
}: {
  currentProjectId?: string;
  onImportClick?: () => void;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const conversationsQuery = useQuery({
    queryKey: ["sidebar-conversations"],
    queryFn: () => getConversations(),
  });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      setName("");
      setShowProjectForm(false);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const projects = projectsQuery.data ?? [];
  const conversations = (conversationsQuery.data ?? []).slice(0, 14);

  async function refreshSidebar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  }

  const content = (
    <SidebarContent
      pathname={pathname}
      currentProjectId={currentProjectId}
      projects={projects}
      projectsLoading={projectsQuery.isLoading}
      projectsError={projectsQuery.isError ? projectsQuery.error.message : null}
      conversations={conversations}
      onImportClick={() => {
        setShowMobileDrawer(false);
        onImportClick?.();
      }}
      showProjectForm={showProjectForm}
      setShowProjectForm={setShowProjectForm}
      name={name}
      setName={setName}
      createPending={createMutation.isPending}
      createError={createMutation.isError ? createMutation.error.message : null}
      onCreateProject={() => {
        const trimmed = name.trim();
        if (trimmed) {
          createMutation.mutate({ name: trimmed, icon: "folder" });
        }
      }}
      onConversationChanged={refreshSidebar}
      closeMobile={() => setShowMobileDrawer(false)}
    />
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open sidebar"
        data-testid="mobile-sidebar-button"
        onClick={() => setShowMobileDrawer(true)}
        className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-[#d9d9d7] bg-white text-sm font-semibold text-[#111827] shadow-sm md:hidden"
      >
        cr
      </button>

      {showMobileDrawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowMobileDrawer(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[320px] flex-col overflow-hidden border-r border-[#e5e5e5] bg-[#f9f9f9] text-[#111827] shadow-2xl">
            {content}
          </aside>
        </div>
      ) : null}

      <aside className="hidden h-screen w-[268px] shrink-0 flex-col overflow-hidden border-r border-[#e5e5e5] bg-[#f9f9f9] text-[#111827] md:flex">
        {content}
      </aside>
    </>
  );
}

function SidebarContent({
  pathname,
  currentProjectId,
  projects,
  projectsLoading,
  projectsError,
  conversations,
  onImportClick,
  showProjectForm,
  setShowProjectForm,
  name,
  setName,
  createPending,
  createError,
  onCreateProject,
  onConversationChanged,
  closeMobile,
}: {
  pathname: string;
  currentProjectId?: string;
  projects: Array<{ id: string; name: string; is_default: boolean }>;
  projectsLoading: boolean;
  projectsError: string | null;
  conversations: ConversationListItem[];
  onImportClick: () => void;
  showProjectForm: boolean;
  setShowProjectForm: (value: boolean) => void;
  name: string;
  setName: (value: string) => void;
  createPending: boolean;
  createError: string | null;
  onCreateProject: () => void;
  onConversationChanged: () => Promise<void>;
  closeMobile: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#10a37f] text-sm font-semibold text-white">
          cr
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">chat-reader</p>
          <p className="text-xs text-[#6b7280]">local archive reader</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <button
          type="button"
          data-testid="sidebar-import-button"
          onClick={onImportClick}
          className="mb-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-[#d9d9d7] bg-white px-3 text-sm font-medium text-[#111827] shadow-sm transition hover:bg-[#f4f4f4] focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30"
        >
          + Import
        </button>

        <nav className="space-y-1">
          <NavLink href="/" label="All Conversations" active={pathname === "/"} onClick={closeMobile} />
          <NavLink href="/archived" label="Archived Conversations" active={pathname === "/archived"} onClick={closeMobile} />
          <NavLink href="/search" label="Search" active={pathname.startsWith("/search")} onClick={closeMobile} />
          <NavLink href="/recent" label="Recent" active={pathname.startsWith("/recent")} onClick={closeMobile} />
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Projects</h2>
            <button
              type="button"
              onClick={() => setShowProjectForm(!showProjectForm)}
              className="rounded-md px-2 py-1 text-xs font-medium text-[#374151] hover:bg-white"
            >
              {showProjectForm ? "Close" : "+ New"}
            </button>
          </div>
          {showProjectForm ? (
            <form
              className="mt-2 rounded-xl border border-[#e5e5e5] bg-white p-2"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateProject();
              }}
            >
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-[#d9d9d7] px-3 text-sm outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/20"
                placeholder="Project name"
              />
              <button
                type="submit"
                disabled={!name.trim() || createPending}
                className="mt-2 min-h-10 w-full rounded-lg bg-[#111827] px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add project
              </button>
              {createError ? <p className="mt-2 text-xs text-red-700">{createError}</p> : null}
            </form>
          ) : null}
          <nav className="mt-2 space-y-1">
            {projects.map((project) => (
              <NavLink
                key={project.id}
                href={`/projects/${project.id}`}
                label={project.is_default ? "Inbox" : project.name}
                active={currentProjectId === project.id}
                onClick={closeMobile}
              />
            ))}
          </nav>
          {projectsLoading ? <p className="px-2 py-2 text-xs text-[#6b7280]">Loading projects</p> : null}
          {projectsError ? <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{projectsError}</p> : null}
        </div>

        <div className="mt-5">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Conversation history</h2>
          <nav className="mt-2 space-y-1">
            {conversations.map((conversation) => (
              <ConversationHistoryRow
                key={conversation.id}
                conversation={conversation}
                active={pathname === `/conversations/${conversation.id}`}
                onClick={closeMobile}
                onChanged={onConversationChanged}
              />
            ))}
            {conversations.length === 0 ? <p className="px-2 py-2 text-xs text-[#6b7280]">No conversations yet</p> : null}
          </nav>
        </div>
      </div>

      <div className="shrink-0 border-t border-[#e5e5e5] px-4 py-3 text-xs leading-5 text-[#6b7280]">
        Local mode / PostgreSQL
      </div>
    </>
  );
}

function ConversationHistoryRow({
  conversation,
  active,
  onClick,
  onChanged,
}: {
  conversation: ConversationListItem;
  active: boolean;
  onClick?: () => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <div
      className={`group flex min-h-9 items-center gap-1 rounded-lg pl-3 pr-1 transition ${
        active ? "bg-[#e9e9e7] text-[#111827]" : "text-[#374151] hover:bg-white hover:text-[#111827]"
      }`}
    >
      <Link
        href={`/conversations/${conversation.id}`}
        onClick={onClick}
        className="min-w-0 flex-1 truncate py-2 text-sm"
      >
        {conversation.is_global_pinned ? "Pinned / " : ""}
        {conversation.display_title || conversation.title}
      </Link>
      <div className={`shrink-0 ${active ? "opacity-100" : "opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"}`}>
        <ConversationActionMenu compact conversation={conversation} onChanged={onChanged} />
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block min-h-9 truncate rounded-lg px-3 py-2 text-sm transition ${
        active ? "bg-[#e9e9e7] text-[#111827]" : "text-[#374151] hover:bg-white hover:text-[#111827]"
      }`}
    >
      {label}
    </Link>
  );
}
