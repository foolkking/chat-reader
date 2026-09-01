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
import { AdminAccessPanel } from "./admin-access-panel";
import { AdminAccessSettingsPanel, AdminAuditPanel, AdminFeaturesPanel, AdminSkillsPanel, AdminSystemPanel, AdminUsersPanel } from "./admin-settings-panels";

export function SettingsFocusedDialog({ category, onClose, restoreFocus }: { category: SettingsCategory; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { confirm } = useInteractionDialog();
  const { openImportDialog } = useImportDialog();
  const t = useTranslations();
  const [dirty, setDirty] = useState(false);
  const zh = t("settings") === "\u8bbe\u7f6e";
  const adminTitles: Partial<Record<SettingsCategory, string>> = { "admin-users": zh ? "\u7528\u6237" : "Users", "admin-access": zh ? "\u6ce8\u518c\u4e0e\u8bbf\u95ee" : "Registration & access", "admin-skills": zh ? "\u7cfb\u7edf Skill" : "System skills", "admin-features": zh ? "\u529f\u80fd\u4e0e\u9ed8\u8ba4\u503c" : "Features & defaults", "admin-system": zh ? "\u7cfb\u7edf" : "System", "admin-audit": zh ? "\u5b89\u5168\u4e0e\u5ba1\u8ba1" : "Security & audit" };
  const title = adminTitles[category] ?? (category === "data" ? t("dataArchive") : category === "security" ? t("accountSecurity") : category === "cleanup" ? t("noiseRuleLibrary") : category === "skills" ? t("skillManagement") : category === "access" ? (zh ? "\u7528\u6237\u4e0e\u8bbf\u95ee" : "Users & access") : t("importFormats"));
  const requestClose = useCallback(async (): Promise<boolean> => {
    if (dirty && !(await confirm({ title: "放弃未保存的更改？", description: "当前输入尚未提交，关闭后这些更改会丢失。", confirmLabel: "放弃更改", danger: true }))) return false;
    onClose();
    return true;
  }, [confirm, dirty, onClose]);
  useDialogFocus({ open: true, rootRef, onClose: () => void requestClose(), restoreFocus });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="settings-focused-title" onPointerDown={(event) => { if (event.target === event.currentTarget) void requestClose(); }}>
      <div ref={rootRef} tabIndex={-1} className={`relative flex max-h-[min(92dvh,56rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:rounded-xl ${category === "access" || category.startsWith("admin-") ? "sm:max-w-4xl" : "sm:max-w-2xl"}`}>
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
          {category === "access" ? <AdminAccessPanel onDirtyChange={setDirty} /> : null}
          {category === "admin-users" ? <AdminUsersPanel /> : null}
          {category === "admin-access" ? <AdminAccessSettingsPanel /> : null}
          {category === "admin-skills" ? <AdminSkillsPanel /> : null}
          {category === "admin-features" ? <AdminFeaturesPanel /> : null}
          {category === "admin-system" ? <AdminSystemPanel /> : null}
          {category === "admin-audit" ? <AdminAuditPanel /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
