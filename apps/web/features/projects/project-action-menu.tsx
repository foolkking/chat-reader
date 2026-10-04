"use client";

import { Archive, MoreHorizontal, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { updateProject } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { ProjectSettingsDialog } from "./project-settings-dialog";

export function ProjectActionMenu({ project, onChanged }: { project: ProjectRead; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useInteractionDialog();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 224)) });
    setOpen((value) => !value);
  };
  const close = () => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); };
  const archive = async () => {
    if (pending) return;
    setOpen(false);
    const confirmed = await dialog.confirm({ title: zh ? `归档“${project.name}”？` : `Archive “${project.name}”?`, description: zh ? "对话会暂时显示在未分类区域，恢复项目后会回到项目。" : "Its conversations appear as unclassified until the project is restored.", confirmLabel: zh ? "归档" : "Archive", danger: true });
    if (!confirmed) return;
    setPending(true); setError(null); setOpen(true);
    try { await updateProject(project.id, { is_archived: true }); await onChanged(); setOpen(false); }
    catch { setError(zh ? "归档失败，请重试。" : "Could not archive this project. Try again."); }
    finally { setPending(false); }
  };

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
      <button role="menuitem" type="button" disabled={pending} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-subtle" onClick={() => { setOpen(false); setSettingsOpen(true); }}><Settings className="h-4 w-4" />{zh ? "项目设置" : "Project settings"}</button>
      <button role="menuitem" type="button" disabled={pending} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50" onClick={() => void archive()}><Archive className="h-4 w-4" />{pending ? (zh ? "正在归档…" : "Archiving…") : (zh ? "归档项目" : "Archive project")}</button>
      {error ? <p role="alert" className="px-3 py-2 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>, document.body) : null}
    <ProjectSettingsDialog project={project} open={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={onChanged} />
  </div>;
}
