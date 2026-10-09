"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SelectionModeButton, SelectionToolbar } from "../../components/selection-toolbar";
import { useLinearSelection } from "../../components/use-linear-selection";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { ApiRequestError, deleteProject, getProjects, updateProject } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";
import { ProjectSymbol } from "./project-symbol";
import { runBatchSelection } from "../../lib/batch-selection";

export function ArchivedProjectList() {
  const queryClient = useQueryClient();
  const { resolvedLocale } = usePreferences();
  const dialog = useInteractionDialog();
  const zh = resolvedLocale === "zh-CN";
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [unconfirmedRestoreIds, setUnconfirmedRestoreIds] = useState<string[]>([]);
  const [checkingRestore, setCheckingRestore] = useState(false);
  const actionBusy = useRef(false);
  const unconfirmedRef = useRef<string[]>([]);
  const mounted = useRef(true);
  const accessBlocked = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const actionFocus = useRef<Element | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects", "archived"],
    queryFn: () => getProjects({ includeArchived: true, sort: "custom", direction: "asc" }),
  });
  const listUnavailable = projectsQuery.isError && projectsQuery.error instanceof ApiRequestError
    && [401, 403, 404].includes(projectsQuery.error.status);
  accessBlocked.current = listUnavailable;
  const archivedProjects = listUnavailable ? [] : (projectsQuery.data ?? []).filter((project) => project.is_archived);
  const currentArchivedIds = useRef(new Set<string>());
  currentArchivedIds.current = new Set(archivedProjects.map((project) => project.id));
  const selectedArchivedIds = new Set([...selectedProjectIds].filter((id) => currentArchivedIds.current.has(id)));
  const restoreMutation = useMutation({
    onMutate: () => setBatchNotice(null),
    onError: (_error, projectId) => {
      if (!mounted.current) return;
      retainUnconfirmed([projectId]);
      setBatchNotice(zh ? "暂时无法确认恢复结果，请先核对再重试。" : "Restore could not be confirmed. Check the result before retrying.");
    },
    mutationFn: (projectId: string) => updateProject(projectId, { is_archived: false }),
    onSuccess: (saved) => {
      if (!mounted.current) return;
      publishRestored([saved]);
      setSelectedProjectIds((current) => new Set([...current].filter((id) => id !== saved.id)));
      setBatchNotice(zh ? "项目已恢复。" : "Project restored.");
      void refreshProjects().catch(() => undefined);
    },
    onSettled: () => { actionBusy.current = false; },
  });
  const busy = bulkBusy || restoreMutation.isPending || checkingRestore;
  const mutationsDisabled = busy || listUnavailable || unconfirmedRestoreIds.length > 0;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!batchNotice || listUnavailable) return;
    const previous = actionFocus.current;
    if (document.activeElement !== document.body && document.activeElement !== previous) {
      actionFocus.current = null;
      return;
    }
    if (previous && !previous.isConnected && document.activeElement === document.body) {
      actionFocus.current = null;
      noticeRef.current?.focus({ preventScroll: true });
    }
  }, [batchNotice, archivedProjects.length, listUnavailable]);

  function scopeIsCurrent(ids: string[]) {
    if (ids.every((id) => currentArchivedIds.current.has(id))) return true;
    setBatchNotice(zh ? "项目列表已更新，请检查当前选择后重试。" : "The project list changed. Review the current selection and try again.");
    return false;
  }

  function beginAction(ids: string[]) {
    if (!mounted.current || accessBlocked.current || actionBusy.current || unconfirmedRef.current.length) return false;
    if (!scopeIsCurrent(ids)) return false;
    actionBusy.current = true;
    actionFocus.current = document.activeElement;
    return true;
  }

  function retainUnconfirmed(ids: string[]) {
    unconfirmedRef.current = ids;
    setUnconfirmedRestoreIds(ids);
  }

  function publishRestored(saved: ProjectRead[]) {
    if (!saved.length) return;
    const byId = new Map(saved.map((item) => [item.id, item]));
    // Cancel older reads before publishing the acknowledged canonical response.
    void queryClient.cancelQueries({ queryKey: ["projects"] });
    queryClient.setQueriesData<ProjectRead[]>({ queryKey: ["projects"] }, (current) =>
      current?.map((item) => byId.get(item.id) ?? item));
  }

  function restoreProject(projectId: string) {
    if (beginAction([projectId])) restoreMutation.mutate(projectId);
  }

  async function checkRestoreResult() {
    if (!mounted.current || actionBusy.current || !unconfirmedRef.current.length) return;
    const ids = [...unconfirmedRef.current];
    actionBusy.current = true;
    actionFocus.current = document.activeElement;
    setCheckingRestore(true);
    try {
      const result = await projectsQuery.refetch();
      if (!mounted.current) return;
      if (result.isError || !result.data) {
        setBatchNotice(zh ? "恢复结果核对失败，请再次核对后再重试恢复。" : "Could not check the restore result. Check again before retrying restore.");
        return;
      }
      const byId = new Map(result.data.map((item) => [item.id, item]));
      const restored = ids.flatMap((id) => { const item = byId.get(id); return item && !item.is_archived ? [item] : []; });
      const stillArchived = ids.filter((id) => byId.get(id)?.is_archived);
      const unavailable = ids.filter((id) => !byId.has(id));
      publishRestored(restored);
      retainUnconfirmed([]);
      setSelectedProjectIds((current) => new Set([...current].filter((id) => byId.get(id)?.is_archived)));
      setBatchNotice(zh
        ? `已核对：${restored.length} 个项目已恢复，${stillArchived.length} 个仍在归档中${unavailable.length ? `，${unavailable.length} 个当前不可访问` : ""}${stillArchived.length ? "；可重试恢复仍在归档中的项目。" : "。"}`
        : `Checked: ${restored.length} ${restored.length === 1 ? "project" : "projects"} restored, ${stillArchived.length} still archived${unavailable.length ? `, ${unavailable.length} unavailable` : ""}.${stillArchived.length ? " You can retry the projects still archived." : ""}`);
    } catch {
      if (mounted.current) setBatchNotice(zh ? "恢复结果核对失败，请再次核对后再重试恢复。" : "Could not check the restore result. Check again before retrying restore.");
    } finally {
      actionBusy.current = false;
      if (mounted.current) setCheckingRestore(false);
    }
  }

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
    selectedIds: selectedArchivedIds,
    onChange: applySelection,
    disabled: busy || listUnavailable,
    selectionMode,
    onActivate: () => setSelectionMode(true),
    onExit: exitSelectionMode,
  });

  function exitSelectionMode() {
    if (busy || actionBusy.current) return;
    clearSelection();
    setSelectionMode(false);
  }

  async function restoreProjects(ids: string[]) {
    if (!ids.length || !beginAction(ids)) return;
    setBulkBusy(true);
    setBatchNotice(null);
    try {
      const saved: ProjectRead[] = [];
      const result = await runBatchSelection(ids, async (projectId) => {
        saved.push(await updateProject(projectId, { is_archived: false }));
      });
      if (!mounted.current) return;
      applySelection(result.failedIds);
      publishRestored(saved);
      retainUnconfirmed(result.failedIds);
      setBatchNotice(zh
        ? `已恢复 ${result.succeededIds.length} 个项目${result.failedIds.length ? `，${result.failedIds.length} 个结果待核对；已保留选择，请先核对再重试。` : "。"}`
        : `${result.succeededIds.length} ${result.succeededIds.length === 1 ? "project" : "projects"} restored${result.failedIds.length ? `; ${result.failedIds.length} could not be confirmed. Selection is kept; check before retrying.` : "."}`);
      if (saved.length) void refreshProjects().catch(() => undefined);
    } finally {
      actionBusy.current = false;
      if (mounted.current) setBulkBusy(false);
    }
  }

  async function deleteProjects(ids: string[], projectName?: string) {
    if (!ids.length || !beginAction(ids)) return;
    try {
      const confirmed = await dialog.confirm({
        title: projectName
          ? (zh ? `永久删除项目“${projectName}”？` : `Permanently delete “${projectName}”?`)
          : (zh ? `永久删除所选 ${ids.length} 个项目？` : `Permanently delete ${ids.length} selected projects?`),
        description: zh
          ? "项目容器将被永久删除且无法恢复；其中的对话和消息不会删除，会回到未分类。"
          : "The project containers cannot be restored. Their conversations and messages are kept and return to Unclassified.",
        confirmLabel: zh ? "永久删除" : "Delete permanently",
        danger: true,
      });
      if (!confirmed || !mounted.current || accessBlocked.current) return;
      if (!scopeIsCurrent(ids)) return;
      setBulkBusy(true);
      setBatchNotice(null);
      const result = await runBatchSelection(ids, deleteProject);
      if (!mounted.current) return;
      applySelection(result.failedIds);
      if (result.succeededIds.length) {
        const deleted = new Set(result.succeededIds);
        void queryClient.cancelQueries({ queryKey: ["projects"] });
        queryClient.setQueriesData<ProjectRead[]>({ queryKey: ["projects"] }, (current) =>
          current?.filter((item) => !deleted.has(item.id)));
      }
      setBatchNotice(zh
        ? `已删除 ${result.succeededIds.length} 个项目，失败 ${result.failedIds.length} 个${result.failedIds.length ? "；失败项已保留选择" : "；对话已保留在未分类"}`
        : `${result.succeededIds.length} ${result.succeededIds.length === 1 ? "project" : "projects"} deleted, ${result.failedIds.length} failed${result.failedIds.length ? "; failed items remain selected" : "; conversations remain in Unclassified"}`);
      if (result.succeededIds.length) void refreshProjects().catch(() => undefined);
    } finally {
      actionBusy.current = false;
      if (mounted.current) setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (selectedProjectIds.size > 0) setSelectionMode(true);
  }, [selectedProjectIds.size]);

  if (projectsQuery.isSuccess && archivedProjects.length === 0 && !batchNotice && !unconfirmedRestoreIds.length) {
    return null;
  }

  return (
    <section aria-labelledby="archived-projects-heading">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="archived-projects-heading" className="text-lg font-semibold text-primary">{zh ? "已归档项目" : "Archived projects"}</h2>
          <p className="text-sm text-secondary">{zh ? "可以恢复项目，或永久删除项目容器；删除项目不会删除其中的对话。" : "Restore a project, or permanently delete its container without deleting conversations."}</p>
        </div>
        {archivedProjects.length ? <SelectionModeButton active={selectionMode} locale={resolvedLocale} context="project" onClick={selectionMode ? exitSelectionMode : () => { if (!busy && !actionBusy.current) setSelectionMode(true); }} /> : null}
      </div>
      <div ref={noticeRef} tabIndex={-1} role="status" className={!listUnavailable && (batchNotice || unconfirmedRestoreIds.length) ? "mb-2 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ui bg-subtle px-3 py-2 text-sm text-secondary" : "sr-only"}>
        {!listUnavailable ? <>{batchNotice ? <p>{batchNotice}</p> : null}
          {unconfirmedRestoreIds.length ? <button type="button" disabled={busy} onClick={() => void checkRestoreResult()}
            className="btn-secondary min-h-11 px-3 disabled:opacity-60">{checkingRestore ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对恢复结果" : "Check restore result")}</button> : null}</> : null}
      </div>
      <div aria-busy={projectsQuery.isFetching || busy}>
      {projectsQuery.isLoading ? <p role="status" className="text-sm text-secondary">{zh ? "正在加载已归档项目…" : "Loading archived projects…"}</p> : null}
      {projectsQuery.isError ? <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-secondary">
        <p>{archivedProjects.length
          ? (zh ? "项目更新失败，仍显示上次内容。" : "Could not update archived projects. Previously loaded projects are shown.")
          : (zh ? "已归档项目加载失败" : "Could not load archived projects")}</p>
        <button type="button" disabled={projectsQuery.isFetching || checkingRestore} className="btn-secondary min-h-11 px-3 disabled:opacity-60" onClick={() => void projectsQuery.refetch()}>{zh ? "重试" : "Retry"}</button>
      </div> : null}
      {selectionMode && archivedProjects.length > 0 ? <SelectionToolbar
        selectedCount={selectedArchivedIds.size}
        totalCount={archivedProjects.length}
        busy={busy}
        context="project"
        locale={resolvedLocale}
        onSelectAll={linearSelection.selectAll}
        onInvert={linearSelection.invert}
        onClear={clearSelection}
        onDone={exitSelectionMode}
      >
        <button type="button" disabled={mutationsDisabled || selectedArchivedIds.size === 0} onClick={() => void restoreProjects(Array.from(selectedArchivedIds))} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ui px-3 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-wait disabled:opacity-50"><RotateCcw className="h-4 w-4" />{bulkBusy ? (zh ? "正在处理" : "Working") : (zh ? "恢复所选" : "Restore selected")}</button>
        <button type="button" disabled={mutationsDisabled || selectedArchivedIds.size === 0} onClick={() => void deleteProjects(Array.from(selectedArchivedIds))} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--danger)] px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:cursor-wait disabled:opacity-50"><Trash2 className="h-4 w-4" />{bulkBusy ? (zh ? "正在处理" : "Working") : (zh ? "永久删除所选" : "Delete selected")}</button>
      </SelectionToolbar> : null}
      {archivedProjects.length > 0 ? <div className="divide-y divide-ui overflow-hidden rounded-lg border border-ui bg-surface">
        {archivedProjects.map((project) => (
          <div key={project.id} {...linearSelection.itemHandlers(project.id)} data-state={selectedProjectIds.has(project.id) ? "selected" : undefined} aria-selected={selectionMode ? selectedProjectIds.has(project.id) : undefined} className="reader-interactive-row group flex min-h-14 items-center gap-3 border-b border-ui px-4 py-2.5 last:border-b-0">
            <label className={`h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ui bg-surface transition-opacity ${linearSelection.checkboxClass(project.id)}`}><input type="checkbox" disabled={busy} checked={selectedProjectIds.has(project.id)} onClick={(event) => linearSelection.toggle(project.id, { selected: !selectedProjectIds.has(project.id), range: event.shiftKey })} onChange={() => undefined} aria-label={`${zh ? "选择" : "Select"} ${project.name}`} className="h-4 w-4 accent-[var(--accent)]" /></label>
            <ProjectSymbol project={project} />
            <div className="min-w-0 flex-1">
              {selectionMode ? <button type="button" disabled={busy} onClick={() => {
                const next = new Set(selectedProjectIds);
                if (next.has(project.id)) next.delete(project.id);
                else next.add(project.id);
                applySelection(next);
              }} className="block w-full text-left"><span className="block truncate text-sm font-medium text-primary">{project.name}</span></button> : <p className="truncate text-sm font-medium text-primary">{project.name}</p>}
              <p className="text-xs text-secondary">{zh ? `${project.conversation_count} 个活跃对话` : `${project.conversation_count} active conversations`}</p>
            </div>
            {!selectionMode ? <div className="flex shrink-0 items-center gap-1"><button
              type="button"
              disabled={mutationsDisabled}
              onClick={() => restoreProject(project.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle disabled:cursor-wait disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {restoreMutation.isPending && restoreMutation.variables === project.id ? (zh ? "正在恢复" : "Restoring") : (zh ? "恢复" : "Restore")}
            </button><button type="button" disabled={mutationsDisabled} onClick={() => void deleteProjects([project.id], project.name)} aria-label={`${zh ? "永久删除项目" : "Permanently delete project"} ${project.name}`} title={zh ? "永久删除项目" : "Permanently delete project"} className="flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:cursor-wait disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div> : null}
          </div>
        ))}
      </div> : null}
      </div>
    </section>
  );
}
