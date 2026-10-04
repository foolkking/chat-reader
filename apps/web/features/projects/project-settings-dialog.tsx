"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { updateProject } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { useUnsavedClose } from "../../components/use-unsaved-close";
import { ProjectSymbol, projectSymbols } from "./project-symbol";

export function ProjectSettingsDialog({ project, open, onClose, onChanged }: {
  project: ProjectRead;
  open: boolean;
  onClose: () => void;
  onChanged?: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [color, setColor] = useState(project.color ?? "#0f766e");
  const [icon, setIcon] = useState(project.icon ?? "folder");
  const rootRef = useRef<HTMLFormElement>(null);
  const base = useRef(project);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: () => updateProject(project.id, {
      name: name.trim(),
      description: description.trim() || null,
      color,
      icon: icon.trim() || "folder",
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await onChanged?.();
      onClose();
    },
    onSettled: () => { submitting.current = false; },
  });
  const requestClose = useUnsavedClose({
    dirty: name !== base.current.name || description !== (base.current.description ?? "") || color !== (base.current.color ?? "#0f766e") || icon !== (base.current.icon ?? "folder"),
    busy: mutation.isPending, onClose,
  });
  useDialogFocus({ open, rootRef, onClose: requestClose });

  useEffect(() => {
    if (!open) return;
    base.current = project;
    setName(project.name);
    setDescription(project.description ?? "");
    setColor(project.color ?? "#0f766e");
    setIcon(project.icon ?? "folder");
    mutation.reset();
  // Refreshing the project list must not replace an open draft.
  }, [open, project.id]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={`project-settings-${project.id}`}>
      <div aria-hidden="true" className="absolute inset-0" onPointerDown={() => void requestClose()} />
      <form ref={rootRef} tabIndex={-1} className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl outline-none sm:max-w-lg sm:rounded-xl" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !submitting.current) { submitting.current = true; mutation.mutate(); } }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ui px-5 py-3">
          <h2 id={`project-settings-${project.id}`} className="text-base font-semibold text-primary">{zh ? "项目设置" : "Project settings"}</h2>
          <button type="button" disabled={mutation.isPending} onClick={() => void requestClose()} className="flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto"><fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4 p-5">
          <label className="text-sm font-medium text-primary">{zh ? "项目名称" : "Project name"}<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-ui bg-page px-3 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <label className="text-sm font-medium text-primary">{zh ? "项目简介" : "Description"}<textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-ui bg-page px-3 py-2 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <label className="text-sm font-medium text-primary">{zh ? "颜色" : "Color"}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-ui bg-page p-1" /></label>
            <label className="text-sm font-medium text-primary">{zh ? "图标" : "Icon"}<span className="mt-1 flex items-center gap-2"><ProjectSymbol project={{ icon, color }} className="h-5 w-5 shrink-0" /><select value={icon} onChange={(event) => setIcon(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-ui bg-page px-3 text-primary focus:ring-2 focus:ring-[var(--focus)]">{!projectSymbols.some((item) => item.value === icon) ? <option value={icon}>{icon}</option> : null}{projectSymbols.map((item) => <option key={item.value} value={item.value}>{zh ? item.zh : item.en}</option>)}</select></span></label>
          </div>
        </fieldset></div>
        {mutation.isError ? <p role="alert" className="px-5 pb-3 text-sm text-[var(--danger)]">{mutation.error.message}</p> : null}
        <footer className="flex shrink-0 justify-end gap-2 border-t border-ui px-5 py-3"><button type="button" disabled={mutation.isPending} onClick={() => void requestClose()} className="min-h-10 rounded-lg border border-ui px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "取消" : "Cancel"}</button><button type="submit" disabled={mutation.isPending || !name.trim()} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{mutation.isPending ? (zh ? "正在保存" : "Saving") : (zh ? "保存" : "Save")}</button></footer>
      </form>
    </div>,
    document.body,
  );
}
