"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useRef, useState } from "react";
import { AccountSecurityPanel } from "./account-security-panel";
import { DataBackupPanel } from "./data-backup-panel";
import { ImportFormatSettings } from "./import-format-settings";
import { ContentCleanupRuleSettings } from "./content-cleanup-rule-settings";
import { useDialogFocus } from "./use-dialog-focus";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { useImportDialog } from "./import-dialog-provider";
import type { SettingsCategory } from "./preferences-panel";
import { useTranslations } from "./preferences-provider";
import { SkillSettings } from "./skill-settings";

export function SettingsFocusedDialog({ category, onClose, restoreFocus }: { category: SettingsCategory; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { confirm } = useInteractionDialog();
  const { openImportDialog } = useImportDialog();
  const t = useTranslations();
  const [dirty, setDirty] = useState(false);
  const title = category === "data" ? t("dataArchive") : category === "security" ? t("accountSecurity") : category === "cleanup" ? t("noiseRuleLibrary") : category === "skills" ? t("skillManagement") : t("importFormats");
  const requestClose = useCallback(async (): Promise<boolean> => {
    if (dirty && !(await confirm({ title: "放弃未保存的更改？", description: "当前输入尚未提交，关闭后这些更改会丢失。", confirmLabel: "放弃更改", danger: true }))) return false;
    onClose();
    return true;
  }, [confirm, dirty, onClose]);
  useDialogFocus({ open: true, rootRef, onClose: () => void requestClose(), restoreFocus });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="settings-focused-title" onPointerDown={(event) => { if (event.target === event.currentTarget) void requestClose(); }}>
      <div ref={rootRef} tabIndex={-1} className="relative flex max-h-[min(92dvh,56rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:max-w-2xl sm:rounded-xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ui px-5 py-4">
          <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{t("settings")}</p><h2 id="settings-focused-title" className="mt-1 text-lg font-semibold text-primary">{title}</h2></div>
          <button type="button" onClick={() => void requestClose()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={t("close")} title={t("close")}><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5">
          {category === "data" ? <DataBackupPanel focused onDirtyChange={setDirty} /> : null}
          {category === "formats" ? <ImportFormatSettings focused onDirtyChange={setDirty} onOpenImport={(options) => { void requestClose().then((closed) => { if (closed) openImportDialog(options); }); }} /> : null}
          {category === "cleanup" ? <ContentCleanupRuleSettings embedded /> : null}
          {category === "security" ? <AccountSecurityPanel focused onDirtyChange={setDirty} /> : null}
          {category === "skills" ? <SkillSettings focused onDirtyChange={setDirty} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
