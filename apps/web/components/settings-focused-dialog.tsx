"use client";

import { OfflineSyncCenter } from "./offline-sync-center";
import { AdminRuntimePanel } from "./admin-runtime-panel";
import { HelpPanel } from "./help-panel";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountSecurityPanel } from "./account-security-panel";
import { DataBackupPanel } from "./data-backup-panel";
import { MySharesPanel } from "./my-shares-panel";
import { useRouter } from "next/navigation";
import { ImportFormatSettings } from "./import-format-settings";
import { ContentCleanupRuleSettings } from "./content-cleanup-rule-settings";
import { useDialogFocus } from "./use-dialog-focus";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { useImportDialog } from "./import-dialog-provider";
import type { SettingsCategory } from "./preferences-panel";
import { useTranslations } from "./preferences-provider";
import { SkillSettings } from "./skill-settings";
import { AdminAccessSettings } from "./admin-access-settings";
import { AdminImportFormatSettings } from "./admin-import-format-settings";
import { AdminNoiseRuleSettings } from "./admin-noise-rule-settings";
import { AdminRegistrationSettings } from "./admin-registration-settings";
import { AdminAuditPanel, AdminSystemPanel } from "./admin-settings-panels";
import { AdminFeaturesPanel } from "./admin-feature-settings";
import { AdminSkillsPanelEnhanced, AdminUsersPanelEnhanced } from "./admin-settings-enhanced";

export function SettingsFocusedDialog({ category, onClose, restoreFocus, initialConflictKey, initialArchiveTaskId, initialAdminUserId, onNavigate }: { category: SettingsCategory; onClose: () => void; restoreFocus: () => HTMLElement | null; initialConflictKey?: string; initialArchiveTaskId?: string; initialAdminUserId?: string; onNavigate?: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const { confirm } = useInteractionDialog();
  const { openImportDialog } = useImportDialog();
  const t = useTranslations();
  const [dirty, setDirty] = useState(false);
  const zh = t("settings") === "\u8bbe\u7f6e";
  const adminTitles: Partial<Record<SettingsCategory, string>> = { "admin-users": zh ? "\u7528\u6237" : "Users", "admin-access": zh ? "\u6ce8\u518c\u4e0e\u8bbf\u95ee" : "Registration & access", "admin-skills": zh ? "\u7cfb\u7edf Skill" : "System skills", "admin-features": zh ? "\u529f\u80fd\u4e0e\u9ed8\u8ba4\u503c" : "Features & defaults", "admin-system": zh ? "\u7cfb\u7edf" : "System", "admin-audit": zh ? "\u5b89\u5168\u4e0e\u5ba1\u8ba1" : "Security & audit" };
  const title = category === "help" ? (zh ? "帮助与诊断" : "Help & diagnostics") : category === "admin-runtime" ? (zh ? "运行状态" : "Runtime status") : category === "shares" ? (zh ? "我的分享" : "My shares") : category === "offline" ? (zh ? "离线与同步" : "Offline & sync") : category === "admin-noise" ? (zh ? "系统噪声规则" : "System noise rules") : category === "admin-formats" ? (zh ? "系统导入格式" : "System import formats") : adminTitles[category] ?? (category === "data" ? t("dataArchive") : category === "security" ? t("accountSecurity") : category === "cleanup" ? t("noiseRuleLibrary") : category === "skills" ? t("skillManagement") : category === "access" ? (zh ? "\u7528\u6237\u4e0e\u8bbf\u95ee" : "Users & access") : t("importFormats"));
  const requestClose = useCallback(async (): Promise<boolean> => {
    if (dirty && !(await confirm({ title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?", description: zh ? "当前输入尚未提交，关闭后这些更改会丢失。" : "Your changes have not been saved and will be lost when closing.", confirmLabel: zh ? "放弃更改" : "Discard changes", danger: true }))) return false;
    onClose();
    return true;
  }, [confirm, dirty, onClose, zh]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useDialogFocus({ open: true, rootRef, onClose: () => void requestClose(), restoreFocus });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="settings-dialog fixed inset-0 z-[320] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="settings-focused-title" onPointerDown={(event) => { if (event.target === event.currentTarget) void requestClose(); }}>
      <div ref={rootRef} tabIndex={-1} className={`relative flex max-h-[min(92dvh,56rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:rounded-xl ${category === "offline" || category === "access" || category.startsWith("admin-") ? "sm:max-w-4xl" : "sm:max-w-2xl"}`}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ui px-5 py-4">
          <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">{t("settings")}</p><h2 id="settings-focused-title" className="mt-1 text-lg font-semibold text-primary">{title}</h2></div>
          <button type="button" onClick={() => void requestClose()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary" aria-label={t("close")} title={t("close")}><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        <div data-settings-scroll-root="true" className="min-h-0 overflow-y-auto px-5 py-5">
          {category === "help" ? <HelpPanel onImport={() => { void requestClose().then(closed => { if (closed) openImportDialog(); }); }} /> : null}
          {category === "admin-runtime" ? <AdminRuntimePanel /> : null}
          {category === "offline" ? <OfflineSyncCenter onDirtyChange={setDirty} initialConflictKey={initialConflictKey} /> : null}
          {category === "data" ? <DataBackupPanel focused onDirtyChange={setDirty} initialTaskId={initialArchiveTaskId} onRestoreConversation={() => { void requestClose().then((closed) => { if (closed) openImportDialog({ initialMode: "archive" }); }); }} /> : null}
          {category === "shares" ? <MySharesPanel onDirtyChange={setDirty} onOpenConversation={(id) => { void requestClose().then((closed) => { if (closed) { onNavigate?.(); router.push(`/conversations/${encodeURIComponent(id)}`); } }); }} /> : null}
          {category === "formats" ? <ImportFormatSettings focused onDirtyChange={setDirty} onOpenImport={(options) => { void requestClose().then((closed) => { if (closed) openImportDialog(options); }); }} /> : null}
          {category === "cleanup" ? <ContentCleanupRuleSettings embedded onDirtyChange={setDirty} /> : null}
          {category === "security" ? <AccountSecurityPanel focused onDirtyChange={setDirty} /> : null}
          {category === "skills" ? <SkillSettings focused onDirtyChange={setDirty} /> : null}
          {category === "access" ? <AdminAccessSettings onDirtyChange={setDirty} /> : null}
          {category === "admin-users" ? <AdminUsersPanelEnhanced initialUserId={initialAdminUserId} /> : null}
          {category === "admin-formats" ? <AdminImportFormatSettings onDirtyChange={setDirty} /> : null}
          {category === "admin-noise" ? <AdminNoiseRuleSettings onDirtyChange={setDirty} /> : null}
          {category === "admin-access" ? <AdminRegistrationSettings onDirtyChange={setDirty} /> : null}
          {category === "admin-skills" ? <AdminSkillsPanelEnhanced onDirtyChange={setDirty} /> : null}
          {category === "admin-features" ? <AdminFeaturesPanel onDirtyChange={setDirty} /> : null}
          {category === "admin-system" ? <AdminSystemPanel onDirtyChange={setDirty} initialTaskId={initialArchiveTaskId} /> : null}
          {category === "admin-audit" ? <AdminAuditPanel /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
