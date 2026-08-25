"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useRef } from "react";
import { ImportTaskMonitor } from "./import-task-monitor";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { useTranslations } from "../../components/preferences-provider";

export function TaskCenterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const t = useTranslations();
  useDialogFocus({ open, rootRef, onClose, restoreFocus: () => document.querySelector<HTMLElement>('[data-testid="sidebar-tasks-button"]') });
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[315] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="task-center-title">
      <div ref={rootRef} tabIndex={-1} className="relative flex max-h-[min(88dvh,52rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:max-w-2xl sm:rounded-xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ui px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{t("tasks")}</p><h2 id="task-center-title" className="mt-1 text-lg font-semibold text-primary">{t("backgroundTasks")}</h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={t("close")} title={t("close")}><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 overflow-y-auto px-5 py-5"><ImportTaskMonitor placement="center" forceVisible /></div>
      </div>
    </div>,
    document.body,
  );
}
