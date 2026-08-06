"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderArchive, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { SelectionModeButton, SelectionToolbar } from "../../components/selection-toolbar";
import { useLinearSelection } from "../../components/use-linear-selection";
import { usePreferences } from "../../components/preferences-provider";
import { getProjects, updateProject } from "../../lib/api";
import { runBatchSelection } from "../../lib/batch-selection";

export function ArchivedProjectList() {
  const queryClient = useQueryClient();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
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
  const linearSelection = useLinearSelection({
    ids: archivedProjects.map((project) => project.id),
    selectedIds: selectedProjectIds,
    onChange: applySelection,
    disabled: bulkBusy,
    selectionMode,
    onActivate: () => setSelectionMode(true),
    onExit: exitSelectionMode,
  });

  function exitSelectionMode() {
    if (bulkBusy) return;
    clearSelection();
    setSelectionMode(false);
  }

  async function restoreProjects(ids: string[]) {
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const result = await runBatchSelection(ids, (projectId) => updateProject(projectId, { is_archived: false }));
      applySelection(result.failedIds);
      setBatchNotice(zh
        ? `已恢复 ${result.succeededIds.length} 个项目，失败 ${result.failedIds.length} 个${result.failedIds.length ? "；失败项已保留选择" : ""}`
        : `${result.succeededIds.length} projects restored, ${result.failedIds.length} failed${result.failedIds.length ? "; failed items remain selected" : ""}`);
      await refreshProjects();
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (selectedProjectIds.size > 0) setSelectionMode(true);
  }, [selectedProjectIds.size]);

  if (projectsQuery.isLoading) {
    return <p className="text-sm text-secondary">{zh ? "正在加载已归档项目…" : "Loading archived projects…"}</p>;
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
        <div className="min-w-0">
          <h2 id="archived-projects-heading" className="text-lg font-semibold text-primary">{zh ? "已归档项目" : "Archived projects"}</h2>
          <p className="text-sm text-secondary">{zh ? "恢复项目后，其中的对话会重新回到该项目。" : "Restore a project to return its conversations to the project."}</p>
        </div>
        {!selectionMode ? <SelectionModeButton active={false} locale={resolvedLocale} context="project" onClick={() => setSelectionMode(true)} /> : null}
      </div>
      {selectionMode ? <SelectionToolbar
        selectedCount={selectedProjectIds.size}
        totalCount={archivedProjects.length}
        busy={bulkBusy}
        context="project"
        locale={resolvedLocale}
        onSelectAll={linearSelection.selectAll}
        onInvert={linearSelection.invert}
        onClear={clearSelection}
        onDone={exitSelectionMode}
      >
        <button type="button" disabled={bulkBusy || selectedProjectIds.size === 0} onClick={() => void restoreProjects(Array.from(selectedProjectIds))} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-wait disabled:opacity-50"><RotateCcw className="h-4 w-4" />{bulkBusy ? (zh ? "正在恢复" : "Restoring") : (zh ? "恢复所选" : "Restore selected")}</button>
      </SelectionToolbar> : null}
      {batchNotice ? <p className="mb-2 rounded-md border border-ui bg-subtle px-3 py-2 text-xs text-secondary" role="status">{batchNotice}</p> : null}
      <div className="divide-y divide-ui overflow-hidden rounded-lg border border-ui bg-surface">
        {archivedProjects.map((project) => (
          <div key={project.id} {...linearSelection.itemHandlers(project.id)} className={`group flex min-h-14 items-center gap-3 px-4 py-2.5 ${selectedProjectIds.has(project.id) ? "bg-[var(--accent-soft)]" : ""}`}>
            <label className={`h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ui bg-surface transition-opacity ${linearSelection.checkboxClass(project.id)}`}><input type="checkbox" checked={selectedProjectIds.has(project.id)} onClick={(event) => linearSelection.toggle(project.id, { selected: !selectedProjectIds.has(project.id), range: event.shiftKey })} onChange={() => undefined} aria-label={`${zh ? "选择" : "Select"} ${project.name}`} className="h-4 w-4 accent-[var(--accent)]" /></label>
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
