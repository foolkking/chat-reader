"use client";

import { useState } from "react";
import { usePreferences } from "./preferences-provider";
import type { PreferenceField } from "../lib/types";

export function PreferenceSyncStatus() {
  const preferences = usePreferences(), state = preferences.preferenceSync;
  const zh = preferences.resolvedLocale === "zh-CN", [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!state && !preferences.preferenceStorageError) return null;
  const count = Object.keys(state?.changes ?? {}).length;
  const conflicts = Object.keys(state?.conflicts ?? {}) as PreferenceField[];
  if (!count && !conflicts.length && !state?.error && !preferences.preferenceStorageError) return null;
  const work = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch { setError(zh ? "设置已变化，请重新核对后选择。" : "Settings changed. Review the values again."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-2 border-b border-ui pb-3 text-xs" aria-label={zh ? "偏好同步" : "Preference sync"}>
    <p role="status" className="text-secondary">{preferences.preferenceStorageError ? (zh ? "本机偏好尚未保存，请重试。" : "Local preferences could not be saved. Retry.") : count ? (zh ? `${count} 项偏好待同步${conflicts.length ? `，其中 ${conflicts.length} 项需选择` : ""}` : `${count} preference edits pending${conflicts.length ? `; ${conflicts.length} need a choice` : ""}`) : state?.confirmed && !state.error ? (zh ? "偏好已同步到此账户" : "Preferences synced to this account") : (zh ? "尚未确认账户偏好的同步状态" : "Account preference sync has not been confirmed")}</p>
    {state?.error ? <p role="alert">{zh ? "同步未完成，本机选择已保留。" : "Sync did not finish. Your local choices are retained."}</p> : null}
    {conflicts.map((key) => {
      const change = state?.changes[key]; if (!change || !state) return null;
      return <div key={key} className="space-y-2 border-l-2 border-[var(--warning)] pl-3" role="group" aria-label={fieldLabel(key, zh)}>
        <p className="font-medium">{fieldLabel(key, zh)}</p>
        <p>{zh ? "本机" : "Local"}: {valueLabel(change.value, zh)} · {zh ? "服务器" : "Server"}: {valueLabel(state.server[key], zh)}</p>
        <div className="flex flex-wrap gap-2">{(["local", "server"] as const).map((choice) => <button key={choice} className="btn-secondary min-h-9 px-3" disabled={busy || Boolean(state.flight)} onClick={() => void work(() => preferences.resolvePreference(key, choice, state.server.field_revisions?.[key] ?? 1, change.sequence))}>{choice === "local" ? (zh ? "保留本机" : "Keep local") : (zh ? "使用服务器" : "Use server")}</button>)}</div>
      </div>;
    })}
    {error ? <p role="alert">{error}</p> : null}
    {count || state?.error || preferences.preferenceStorageError ? <button className="btn-secondary min-h-9 px-3" disabled={busy} onClick={() => void work(preferences.retryPreferenceSync)}>{zh ? "重试偏好同步" : "Retry preference sync"}</button> : null}
  </section>;
}

function fieldLabel(field: PreferenceField, zh: boolean): string {
  const labels: Record<PreferenceField, [string, string]> = {
    theme_mode: ["主题", "Theme"], locale_mode: ["语言", "Language"], reader_width_mode: ["阅读宽度", "Reading width"], reader_density_mode: ["阅读密度", "Reading density"], reader_font_size_px: ["字号", "Font size"], section_toc_mode: ["目录", "Contents"],
    conversation_sort_mode: ["对话排序", "Conversation order"], conversation_sort_direction: ["对话排序方向", "Conversation direction"], project_sort_mode: ["项目排序", "Project order"], project_sort_direction: ["项目排序方向", "Project direction"], reader_default_focus: ["默认专注模式", "Default focus mode"], annotation_default_position: ["批注默认位置", "Default annotation position"],
  };
  return labels[field][zh ? 0 : 1];
}
function valueLabel(value: unknown, zh: boolean): string {
  if (typeof value === "boolean") return value ? (zh ? "开启" : "On") : (zh ? "关闭" : "Off");
  if (!zh) return String(value ?? "—");
  const labels: Record<string, string> = { light: "浅色", dark: "深色", system: "跟随系统", auto: "自动", "zh-CN": "中文", "en-US": "英文", compact: "紧凑", standard: "标准", wide: "宽", comfortable: "舒适", large: "宽松", visible: "显示", rail: "收起", floating: "浮窗", docked: "固定左侧", recent_read: "最近阅读", updated: "最近更新", created: "创建时间", imported: "导入时间", title: "标题", message_count: "消息数量", conversation_count: "对话数量", custom: "自定义", asc: "升序", desc: "降序" };
  return labels[String(value)] ?? String(value ?? "—");
}
