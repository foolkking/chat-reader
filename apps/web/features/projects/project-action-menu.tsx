"use client";

import { Archive, MoreHorizontal, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const dialog = useInteractionDialog();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); } };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); } };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div ref={rootRef} className="relative mr-1">
    <button ref={buttonRef} type="button" data-no-dnd onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }} aria-haspopup="menu" aria-expanded={open} aria-label={`${zh ? "管理项目" : "Manage project"} ${project.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg opacity-0 hover:bg-subtle group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>
    {open ? <div role="menu" className="absolute right-0 top-10 z-[80] w-48 rounded-lg border border-ui bg-raised p-1 shadow-xl">
      <button role="menuitem" type="button" className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-subtle" onClick={() => { setOpen(false); setSettingsOpen(true); }}><Settings className="h-4 w-4" />{zh ? "项目设置" : "Project settings"}</button>
      <button role="menuitem" type="button" className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={() => void (async () => { setOpen(false); const confirmed = await dialog.confirm({ title: zh ? `归档“${project.name}”？` : `Archive “${project.name}”?`, description: zh ? "对话会暂时显示在未分类区域，恢复项目后会回到项目。" : "Its conversations appear as unclassified until the project is restored.", confirmLabel: zh ? "归档" : "Archive", danger: true }); if (confirmed) { await updateProject(project.id, { is_archived: true }); await onChanged(); } })()}><Archive className="h-4 w-4" />{zh ? "归档项目" : "Archive project"}</button>
    </div> : null}
    <ProjectSettingsDialog project={project} open={settingsOpen} onClose={() => setSettingsOpen(false)} onChanged={onChanged} />
  </div>;
}
