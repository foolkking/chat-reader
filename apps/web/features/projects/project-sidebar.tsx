"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { createProject, getProjects } from "../../lib/api";

export function ProjectSidebar({ currentProjectId }: { currentProjectId?: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const projects = projectsQuery.data ?? [];

  return (
    <aside className="space-y-5 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Navigation</p>
        <nav className="mt-3 space-y-1">
          <NavLink href="/" label="All Conversations" active={!currentProjectId} />
          <NavLink href="/recent" label="Recent" active={false} />
        </nav>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Projects</h2>
          {projectsQuery.isLoading ? <span className="text-xs text-slate-500">Loading</span> : null}
        </div>
        <nav className="mt-3 space-y-1">
          {projects.map((project) => (
            <NavLink
              key={project.id}
              href={`/projects/${project.id}`}
              label={`${project.name}${project.is_default ? " / default" : ""}`}
              active={currentProjectId === project.id}
            />
          ))}
        </nav>
        {projectsQuery.isError ? (
          <p className="mt-2 text-xs text-red-700">{projectsQuery.error.message}</p>
        ) : null}
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) {
            createMutation.mutate({ name: trimmed, icon: "folder" });
          }
        }}
      >
        <label className="block text-xs font-medium text-slate-600" htmlFor="project-name">
          New project
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="Research"
        />
        <button
          type="submit"
          disabled={!name.trim() || createMutation.isPending}
          className="w-full rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Create Project
        </button>
        {createMutation.isError ? <p className="text-xs text-red-700">{createMutation.error.message}</p> : null}
      </form>
    </aside>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 text-sm font-medium ${
        active ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      {label}
    </Link>
  );
}
