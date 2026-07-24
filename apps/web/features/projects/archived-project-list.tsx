"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderArchive, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { SelectionToolbar } from "../../components/selection-toolbar";
import { usePreferences } from "../../components/preferences-provider";
import { getProjects, updateProject } from "../../lib/api";

export function ArchivedProjectList() {
  const queryClient = useQueryClient();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const projectsQuery = useQuery({
    queryKey: ["projects", "archived"],
    queryFn: () => getProjects({ includeArchived: true }),
  });
  const restoreMutation = useMutation({
    mutationFn: (projectId: string) => updateProject(projectId, { is_archived: false }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
    },
  });
  const archivedProjects = (projectsQuery.data ?? []).filter((project) => project.is_archived);

  async function refreshProjects() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    ]);
  }

  function clearSelection() {
    setSelectedProjectIds(new Set());
  }

  function applySelection(ids: Iterable<string>) {
    const requested = new Set(ids);
    setSelectedProjectIds(new Set(archivedProjects.filter((project) => requested.has(project.id)).map((project) => project.id)));
  }

  async function restoreProjects(ids: string[]) {
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((projectId) => updateProject(projectId, { is_archived: false })));
      clearSelection();
      await refreshProjects();
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || bulkBusy) return;
      setSelectedProjectIds(new Set());
      setSelectionMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkBusy, selectionMode]);

  if (projectsQuery.isLoading) {
    return <p className="text-sm text-[#6b7280]">Loading archived projects...</p>;
  }
  if (projectsQuery.isError) {
    return <p className="text-sm text-red-700">{projectsQuery.error.message}</p>;
  }
  if (archivedProjects.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="archived-projects-heading">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 id="archived-projects-heading" className="text-lg font-semibold text-primary">{zh ? "已归档项目" : "Archived projects"}</h2>
          <p className="text-sm text-secondary">{zh ? "恢复项目后，其中的对话会重新回到该项目。" : "Restore a project to return its conversations to the project."}</p>
        </div>
        {!selectionMode ? <button type="button" onClick={() => setSelectionMode(true)} className="min-h-9 shrink-0 rounded-md px-3 text-sm font-medium text-secondary hover:bg-surface">{zh ? "选择项目" : "Select projects"}</button> : null}
      </div>
      {selectionMode ? <SelectionToolbar
        selectedCount={selectedProjectIds.size}
        totalCount={archivedProjects.length}
        busy={bulkBusy}
        className="mb-3"
        context="project"
        locale={resolvedLocale}
        onSelectAll={() => applySelection(archivedProjects.map((project) => project.id))}
        onInvert={() => applySelection(archivedProjects.filter((project) => !selectedProjectIds.has(project.id)).map((project) => project.id))}
        onClear={clearSelection}
        onDone={() => {
          if (bulkBusy) return;
          clearSelection();
          setSelectionMode(false);
        }}
      /> : null}
      {selectionMode && selectedProjectIds.size > 0 ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ui bg-surface p-2.5">
        <span className="text-sm text-secondary">{zh ? `将恢复 ${selectedProjectIds.size} 个项目` : `${selectedProjectIds.size} projects will be restored`}</span>
        <button type="button" disabled={bulkBusy} onClick={() => void restoreProjects(Array.from(selectedProjectIds))} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-wait disabled:opacity-50"><RotateCcw className="h-4 w-4" />{bulkBusy ? (zh ? "正在恢复" : "Restoring") : (zh ? "恢复所选" : "Restore selected")}</button>
      </div> : null}
      <div className="divide-y divide-ui overflow-hidden rounded-lg border border-ui bg-surface">
        {archivedProjects.map((project) => (
          <div key={project.id} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${selectedProjectIds.has(project.id) ? "bg-[var(--accent-soft)]" : ""}`}>
            {selectionMode ? <input type="checkbox" checked={selectedProjectIds.has(project.id)} onChange={(event) => {
              const next = new Set(selectedProjectIds);
              if (event.target.checked) next.add(project.id);
              else next.delete(project.id);
              applySelection(next);
            }} aria-label={`${zh ? "选择" : "Select"} ${project.name}`} className="h-4 w-4 shrink-0 accent-[var(--accent)]" /> : null}
            <FolderArchive className="h-4 w-4 shrink-0 text-secondary" />
            <div className="min-w-0 flex-1">
              {selectionMode ? <button type="button" onClick={() => {
                const next = new Set(selectedProjectIds);
                if (next.has(project.id)) next.delete(project.id);
                else next.add(project.id);
                applySelection(next);
              }} className="block w-full text-left"><span className="block truncate text-sm font-medium text-primary">{project.name}</span></button> : <p className="truncate text-sm font-medium text-primary">{project.name}</p>}
              <p className="text-xs text-secondary">{zh ? `${project.conversation_count} 个活跃对话` : `${project.conversation_count} active conversations`}</p>
            </div>
            {!selectionMode ? <button
              type="button"
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(project.id)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle disabled:cursor-wait disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {zh ? "恢复" : "Restore"}
            </button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
