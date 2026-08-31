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
    <div data-testid="task-center-backdrop" className="fixed inset-0 z-[315] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="task-center-title" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div data-testid="task-center-panel" ref={rootRef} tabIndex={-1} onPointerDown={(event) => event.stopPropagation()} className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border-0 bg-raised shadow-none outline-none sm:h-auto sm:max-h-[min(88dvh,52rem)] sm:max-w-2xl sm:rounded-xl sm:border sm:border-ui sm:shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ui px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{t("tasks")}</p><h2 id="task-center-title" className="mt-1 text-lg font-semibold text-primary">{t("backgroundTasks")}</h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={t("close")} title={t("close")}><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:py-5"><ImportTaskMonitor placement="center" forceVisible /></div>
      </div>
    </div>,
    document.body,
  );
}
