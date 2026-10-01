"use client";

import { useState } from "react";
import { AdminUsersPanelEnhanced } from "./admin-settings-enhanced";
import { AdminRegistrationSettings } from "./admin-registration-settings";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function AdminAccessSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const { confirm } = useInteractionDialog();
  const zh = resolvedLocale === "zh-CN";
  const [tab, setTab] = useState<"users" | "registration">("users");
  const [dirty, setDirty] = useState(false);
  const changeTab = async (next: typeof tab) => {
    if (next === tab) return;
    if (dirty && !(await confirm({ title: zh ? "放弃未保存的注册策略？" : "Discard unsaved registration policy?", description: zh ? "切换后未保存的输入会丢失。" : "Unsaved input will be lost when switching.", confirmLabel: zh ? "放弃更改" : "Discard changes", danger: true }))) return;
    setDirty(false); onDirtyChange?.(false); setTab(next);
  };
  return <div className="space-y-5"><nav className="flex flex-wrap gap-2" aria-label={zh ? "用户与访问" : "Users & access"}>{(["users", "registration"] as const).map((key) => <button key={key} type="button" aria-pressed={key === tab} onClick={() => void changeTab(key)} className={`${key === tab ? "btn-primary" : "btn-secondary"} min-h-11 px-4 text-sm`}>{key === "users" ? (zh ? "用户" : "Users") : (zh ? "注册与邀请" : "Registration & invitations")}</button>)}</nav>{tab === "users" ? <AdminUsersPanelEnhanced /> : <AdminRegistrationSettings onDirtyChange={(value) => { setDirty(value); onDirtyChange?.(value); }} />}</div>;
}
