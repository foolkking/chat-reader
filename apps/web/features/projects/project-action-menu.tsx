"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, MoreHorizontal, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError, getProjects, updateProject } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { ProjectSettingsDialog } from "./project-settings-dialog";

type ProjectArchiveState = {
  project: Pick<ProjectRead, "id" | "name">;
  phase: "confirming" | "archiving" | "unconfirmed" | "checking" | "archived" | "active" | "unavailable" | "changed";
  checkFailed?: boolean;
  accessDenied?: boolean;
};

function archiveNeedsAttention(state: ProjectArchiveState | null) {
  return state !== null && ["confirming", "archiving", "unconfirmed", "checking"].includes(state.phase);
}

function archiveAccessDenied(error: unknown) {
  return error instanceof ApiRequestError && [401, 403, 404].includes(error.status);
}

// One owner in ProjectSidebar serves both desktop and mobile menu copies.
export function useProjectArchive({ projects, unavailable, onChanged }: {
  projects: ProjectRead[];
  unavailable: boolean;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const dialog = useInteractionDialog();
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [state, setState] = useState<ProjectArchiveState | null>(null);
  const stateRef = useRef<ProjectArchiveState | null>(null);
  const latest = useRef({ projects, unavailable, onChanged });
  latest.current = { projects, unavailable, onChanged };
  const mounted = useRef(true);
  const generation = useRef(0);
  const focusOrigin = useRef<Element | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  function updateState(next: ProjectArchiveState | null) {
    stateRef.current = next;
    setState(next);
  }

  function activeProject(id: string) {
    return !latest.current.unavailable
      ? latest.current.projects.find((item) => item.id === id && !item.is_default && !item.is_archived)
      : undefined;
  }

  function publishProject(id: string, saved?: ProjectRead) {
    // Ignore older reads, and do not leave archived rows in active move choices.
    void queryClient.cancelQueries({ queryKey: ["projects"] }).catch(() => undefined);
    for (const [key, rows] of queryClient.getQueriesData<ProjectRead[]>({ queryKey: ["projects"] })) {
      if (!rows) continue;
      queryClient.setQueryData(key, !saved || (saved.is_archived && key[1] !== "archived")
        ? rows.filter((item) => item.id !== id)
        : rows.map((item) => item.id === id ? saved : item));
    }
  }

  function refresh() {
    // Neither a slow read nor a rejecting callback changes the acknowledged write.
    void Promise.resolve().then(() => latest.current.onChanged()).catch(() => undefined);
  }

  async function request(candidate: ProjectRead) {
    const previous = stateRef.current;
    if (!mounted.current || archiveNeedsAttention(previous)
      || (previous?.phase === "archived" && previous.project.id === candidate.id)) return;
    const target = activeProject(candidate.id);
    if (!target) return;
    const epoch = generation.current;
    focusOrigin.current = document.activeElement;
    updateState({ project: target, phase: "confirming" });
    let confirmed = false;
    try {
      confirmed = await dialog.confirm({
        title: zh ? `归档“${target.name}”？` : `Archive “${target.name}”?`,
        description: zh ? "对话会暂时显示在未分类区域，恢复项目后会回到项目。" : "Its conversations appear as unclassified until the project is restored.",
        confirmLabel: zh ? "归档" : "Archive", danger: true,
      });
    } catch {
      if (mounted.current && generation.current === epoch) updateState({ project: target, phase: "changed" });
      return;
    }
    if (!mounted.current || generation.current !== epoch) return;
    if (!confirmed) { updateState(previous); return; }
    if (!activeProject(target.id)) { updateState({ project: target, phase: "changed" }); return; }
    updateState({ project: target, phase: "archiving" });
    let saved: ProjectRead;
    try {
      saved = await updateProject(target.id, { is_archived: true });
    } catch (error) {
      if (mounted.current && generation.current === epoch) updateState({ project: target, phase: "unconfirmed", accessDenied: archiveAccessDenied(error) });
      return;
    }
    if (!mounted.current || generation.current !== epoch) return;
    if (latest.current.unavailable || saved.id !== target.id || !saved.is_archived) {
      updateState({ project: target, phase: "unconfirmed", accessDenied: latest.current.unavailable });
      return;
    }
    updateState({ project: saved, phase: "archived" });
    publishProject(target.id, saved);
    refresh();
  }

  async function check() {
    const original = stateRef.current;
    if (!mounted.current || latest.current.unavailable || original?.phase !== "unconfirmed") return;
    const epoch = generation.current;
    focusOrigin.current = document.activeElement;
    updateState({ ...original, phase: "checking" });
    try {
      const rows = await getProjects({ includeArchived: true, sort: "custom", direction: "asc" });
      if (!mounted.current || generation.current !== epoch) return;
      if (latest.current.unavailable) {
        updateState({ ...original, phase: "unconfirmed", accessDenied: true });
        return;
      }
      const current = rows.find((item) => item.id === original.project.id && !item.is_default);
      updateState({ project: current ?? original.project, phase: !current ? "unavailable" : current.is_archived ? "archived" : "active" });
      publishProject(original.project.id, current);
      refresh();
    } catch (error) {
      if (mounted.current && generation.current === epoch) updateState({ ...original, phase: "unconfirmed", checkFailed: true, accessDenied: archiveAccessDenied(error) });
    }
  }

  function dismiss() {
    if (!mounted.current || archiveNeedsAttention(stateRef.current)) return;
    updateState(null);
    focusOrigin.current = null;
  }

  return { state, request, check, dismiss, focusOrigin, unavailable,
    busy: state !== null && ["confirming", "archiving", "checking"].includes(state.phase),
    blocked: unavailable || archiveNeedsAttention(state) };
}

export type ProjectArchiveController = ReturnType<typeof useProjectArchive>;

export function ProjectArchiveFeedback({ archive }: { archive: ProjectArchiveController }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const noticeRef = useRef<HTMLDivElement>(null);
  const { state } = archive;
  useEffect(() => {
    if (!state || archive.busy || archive.unavailable || !noticeRef.current?.getClientRects().length) return;
    const previous = archive.focusOrigin.current;
    if (!previous) return;
    if (document.activeElement !== document.body && document.activeElement !== previous) {
      archive.focusOrigin.current = null;
    } else if (!previous.isConnected && document.activeElement === document.body) {
      archive.focusOrigin.current = null;
      noticeRef.current.focus({ preventScroll: true });
    }
  });
  if (!state || state.phase === "confirming" || archive.unavailable) return null;
  const message = state.phase === "archiving" ? (zh ? "正在归档项目…" : "Archiving project…")
    : state.phase === "checking" ? (zh ? "正在核对归档结果…" : "Checking archive result…")
    : state.phase === "archived" ? (zh ? "项目已归档，可在归档页面恢复。" : "Project archived. Restore it from the archive.")
    : state.phase === "active" ? (zh ? "项目尚未归档，可在项目菜单中重新归档。" : "This project is not archived. You can try again from its project menu.")
    : state.phase === "unavailable" ? (zh ? "此项目当前不可访问。" : "This project is no longer available.")
    : state.phase === "changed" ? (zh ? "项目列表已更新，请检查后再操作。" : "The project list changed. Review it before trying again.")
    : state.accessDenied ? (zh ? "暂时无法访问项目，请恢复访问后核对归档结果。" : "Project access is unavailable. Check the archive result after access is restored.")
    : state.checkFailed ? (zh ? "归档结果核对失败，请再次核对后再重试归档。" : "Could not check the archive result. Check again before retrying archive.")
    : (zh ? "暂时无法确认归档结果，请先核对再重试。" : "Archive could not be confirmed. Check the result before retrying.");
  return <div ref={noticeRef} tabIndex={-1} role="status" data-testid="project-archive-feedback" className="mt-4 rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-secondary outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
    {!state.accessDenied && state.phase !== "unavailable" && state.phase !== "changed" ? <p className="break-words font-medium text-primary">{state.project.name}</p> : null}
    <p>{message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {state.phase === "unconfirmed" || state.phase === "checking" ? <button type="button" disabled={archive.busy} onClick={() => void archive.check()} className="btn-secondary min-h-11 px-3 disabled:opacity-60">{state.phase === "checking" ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对归档结果" : "Check archive result")}</button> : null}
      {state.phase === "archived" ? <Link href="/archived" className="btn-secondary inline-flex min-h-11 items-center px-3">{zh ? "查看归档" : "View archive"}</Link> : null}
      {!archiveNeedsAttention(state) ? <button type="button" onClick={archive.dismiss} className="btn-secondary min-h-11 px-3">{zh ? "关闭提示" : "Dismiss"}</button> : null}
    </div>
  </div>;
}

export function ProjectActionMenu({ project, onChanged, archive }: { project: ProjectRead; onChanged: () => Promise<void>; archive: ProjectArchiveController }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 224)) });
    setOpen((value) => !value);
  };
  const close = () => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); } };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div ref={rootRef} className="relative mr-1" onKeyDown={(event) => {
    // Keyboard activation inside the portal must not start sorting its project.
    if (open || event.key === "Enter" || event.key === " ") event.stopPropagation();
    if (open && event.key === "Escape") { event.preventDefault(); close(); }
  }} onPointerDown={(event) => event.stopPropagation()}>
    <button ref={buttonRef} type="button" data-no-dnd onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggle(); }} onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); toggle(); } }} aria-haspopup="menu" aria-expanded={open} aria-label={`${zh ? "管理项目" : "Manage project"} ${project.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-subtle md:[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>
    {open ? createPortal(<div ref={menuRef} role="menu" aria-label={zh ? "项目操作" : "Project actions"} className="fixed z-[280] w-56 rounded-lg border border-ui bg-raised p-1 text-primary shadow-xl" style={position} onKeyDown={(event) => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
        event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === "Tab") { close(); }
    }}>
      <button role="menuitem" type="button" disabled={archive.busy} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-subtle" onClick={() => { setOpen(false); setSettingsOpen(true); }}><Settings className="h-4 w-4" />{zh ? "项目设置" : "Project settings"}</button>
      <button role="menuitem" type="button" disabled={archive.blocked} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50" onClick={() => { close(); void archive.request(project); }}><Archive className="h-4 w-4" />{archive.state?.phase === "archiving" && archive.state.project.id === project.id ? (zh ? "正在归档…" : "Archiving…") : (zh ? "归档项目" : "Archive project")}</button>
    </div>, document.body) : null}
    <ProjectSettingsDialog project={project} open={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={onChanged} />
  </div>;
}
