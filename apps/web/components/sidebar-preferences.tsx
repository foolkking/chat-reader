"use client";

import { ChevronDown, ChevronUp, Settings, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PreferencesPanel, type SettingsCategory } from "./preferences-panel";
import { SettingsFocusedDialog } from "./settings-focused-dialog";
import { useTranslations } from "./preferences-provider";

export function SidebarPreferences({ libraryMode = false, onlineHref = "/" }: { libraryMode?: boolean; onlineHref?: string }) {
  const [open, setOpen] = useState(false);
  const [focusedCategory, setFocusedCategory] = useState<SettingsCategory | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = useTranslations();

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div id={panelId} role="dialog" aria-label={t("settings")} className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50 max-h-[min(72vh,30rem)] overflow-y-auto rounded-lg border border-ui bg-raised p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span aria-hidden="true" />
            <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-subtle hover:text-primary" aria-label={t("close")} title={t("close")}><X className="h-4 w-4" /></button>
          </div>
          <PreferencesPanel compact libraryMode={libraryMode} onlineHref={onlineHref} onOpenCategory={(category) => { setOpen(false); setFocusedCategory(category); }} />
        </div>
      ) : null}
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} aria-label={t("settings")} aria-expanded={open} aria-controls={panelId} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-secondary hover:bg-surface hover:text-primary">
        <Settings className="h-4 w-4" />
        <span className="min-w-0 flex-1 text-left">{t("settings")}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {focusedCategory ? <SettingsFocusedDialog category={focusedCategory} onClose={() => { setFocusedCategory(null); setOpen(true); }} restoreFocus={() => triggerRef.current} /> : null}
    </div>
  );
}
