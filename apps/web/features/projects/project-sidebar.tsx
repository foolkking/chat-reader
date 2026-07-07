"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createProject, getConversations, getProjects } from "../../lib/api";

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
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const conversationsQuery = useQuery({
    queryKey: ["sidebar-conversations"],
    queryFn: getConversations,
  });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const projects = projectsQuery.data ?? [];
  const conversations = (conversationsQuery.data ?? []).slice(0, 10);

  return (
    <aside className="flex h-screen w-[284px] shrink-0 flex-col border-r border-[#e5e5e5] bg-[#f3f3f1] text-[#111827]">
      <div className="flex h-14 items-center gap-2 border-b border-[#e5e5e5] px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#10a37f] text-sm font-semibold text-white">
          cr
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">chat-reader</p>
          <p className="text-xs text-[#6b7280]">local archive reader</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <button
          type="button"
          onClick={onImportClick}
          className="mb-3 flex w-full items-center justify-center rounded-lg border border-[#d9d9d7] bg-white px-3 py-2.5 text-sm font-medium text-[#111827] shadow-sm transition hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30"
        >
          + Import
        </button>

        <nav className="space-y-1">
          <NavLink href="/" label="All Conversations" active={pathname === "/"} />
          <NavLink href="/search" label="Search" active={pathname.startsWith("/search")} />
          <NavLink href="/recent" label="Recent" active={pathname.startsWith("/recent")} />
        </nav>

        <div className="mt-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Projects</h2>
            {projectsQuery.isLoading ? <span className="text-xs text-[#6b7280]">Loading</span> : null}
          </div>
          <nav className="mt-2 space-y-1">
            {projects.map((project) => (
              <NavLink
                key={project.id}
                href={`/projects/${project.id}`}
                label={project.is_default ? "Inbox" : project.name}
                active={currentProjectId === project.id}
              />
            ))}
          </nav>
          {projectsQuery.isError ? (
            <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
              {projectsQuery.error.message}
            </p>
          ) : null}
        </div>

        <div className="mt-5">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Pinned / history</h2>
          <nav className="mt-2 space-y-1">
            {conversations.map((conversation) => (
              <NavLink
                key={conversation.id}
                href={`/conversations/${conversation.id}`}
                label={`${conversation.is_global_pinned ? "Pinned / " : ""}${conversation.display_title || conversation.title}`}
                active={pathname === `/conversations/${conversation.id}`}
              />
            ))}
            {conversations.length === 0 ? <p className="px-2 py-2 text-xs text-[#6b7280]">No conversations yet</p> : null}
          </nav>
        </div>
      </div>

      <form
        className="border-t border-[#e5e5e5] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) {
            createMutation.mutate({ name: trimmed, icon: "folder" });
          }
        }}
      >
        <label className="mb-2 block text-xs font-semibold uppercase tracking-normal text-[#6b7280]" htmlFor="project-name">
          New project
        </label>
        <div className="flex gap-2">
          <input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[#d9d9d7] bg-white px-3 py-2 text-sm text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/20"
            placeholder="Research"
          />
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-md bg-[#111827] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {createMutation.isError ? <p className="mt-2 text-xs text-red-700">{createMutation.error.message}</p> : null}
      </form>
    </aside>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block truncate rounded-md px-3 py-2 text-sm transition ${
        active ? "bg-[#111827]/10 text-[#111827]" : "text-[#374151] hover:bg-white hover:text-[#111827]"
      }`}
    >
      {label}
    </Link>
  );
}
