"use client";

import { ChevronDown, ChevronUp, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PreferencesPanel, type SettingsCategory } from "./preferences-panel";
import { SettingsFocusedDialog } from "./settings-focused-dialog";
import { usePreferences, useTranslations } from "./preferences-provider";

export function SidebarPreferences({ libraryMode = false, onlineHref = "/" }: { libraryMode?: boolean; onlineHref?: string }) {
  const [open, setOpen] = useState(false);
  const [focusedCategory, setFocusedCategory] = useState<SettingsCategory | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = useTranslations();
  const { resolvedLocale } = usePreferences();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div id={panelId} role="region" aria-label={t("settings")} className="absolute bottom-full left-[-0.75rem] right-[-0.75rem] z-50 max-h-[min(24rem,calc(100dvh-8rem))] overflow-y-auto border-y border-ui bg-sidebar p-3">
          <PreferencesPanel compact libraryMode={libraryMode} onlineHref={onlineHref} onOpenCategory={(category) => { setOpen(false); setFocusedCategory(category); }} />
        </div>
      ) : null}
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? (resolvedLocale === "zh-CN" ? "收回设置" : "Collapse settings") : t("settings")} aria-expanded={open} aria-controls={panelId} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-secondary hover:bg-surface hover:text-primary">
        <Settings className="h-4 w-4" />
        <span className="min-w-0 flex-1 text-left">{open ? (resolvedLocale === "zh-CN" ? "收回设置" : "Collapse settings") : t("settings")}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {focusedCategory ? <SettingsFocusedDialog category={focusedCategory} onClose={() => { setFocusedCategory(null); setOpen(true); }} restoreFocus={() => triggerRef.current} /> : null}
    </div>
  );
}
