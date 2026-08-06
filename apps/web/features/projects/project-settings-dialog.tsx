"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { updateProject } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

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
  });

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setColor(project.color ?? "#0f766e");
    setIcon(project.icon ?? "folder");
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !mutation.isPending) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mutation.isPending, onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={`project-settings-${project.id}`}>
      <button type="button" className="absolute inset-0" aria-label={zh ? "关闭项目设置" : "Close project settings"} onClick={onClose} />
      <form className="relative w-full rounded-t-xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-lg sm:rounded-xl" onSubmit={(event) => { event.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        <header className="flex items-center justify-between gap-3">
          <div><h2 id={`project-settings-${project.id}`} className="text-base font-semibold text-primary">{zh ? "项目设置" : "Project settings"}</h2><p className="mt-1 text-sm text-secondary">{zh ? "编辑项目名称、简介和外观。" : "Edit the project name, description, and appearance."}</p></div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-primary">{zh ? "项目名称" : "Project name"}<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-ui bg-page px-3 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <label className="text-sm font-medium text-primary">{zh ? "项目简介" : "Description"}<textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-ui bg-page px-3 py-2 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <label className="text-sm font-medium text-primary">{zh ? "颜色" : "Color"}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-ui bg-page p-1" /></label>
            <label className="text-sm font-medium text-primary">{zh ? "图标名称" : "Icon name"}<input value={icon} onChange={(event) => setIcon(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-ui bg-page px-3 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>
          </div>
        </div>
        {mutation.isError ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{mutation.error.message}</p> : null}
        <footer className="mt-5 flex justify-end gap-2"><button type="button" disabled={mutation.isPending} onClick={onClose} className="min-h-10 rounded-lg border border-ui px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "取消" : "Cancel"}</button><button type="submit" disabled={mutation.isPending || !name.trim()} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{mutation.isPending ? (zh ? "正在保存" : "Saving") : (zh ? "保存" : "Save")}</button></footer>
      </form>
    </div>,
    document.body,
  );
}
