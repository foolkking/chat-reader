"use client";

import { Eye, FileText, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi, type SystemSkill } from "../lib/admin-client";
import { usePreferences } from "./preferences-provider";

const zhText = (zh: boolean, cn: string, en: string) => zh ? cn : en;
function Panel({ icon: Icon, title, description, children }: { icon: typeof UsersRound; title: string; description: string; children: React.ReactNode }) {
  return <section className="space-y-4" aria-label={title}><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-primary">{title}</h3><p className="mt-0.5 text-xs leading-5 text-secondary">{description}</p></div></div>{children}</section>;
}
function Notice({ error, notice }: { error?: string; notice?: string }) { return <>{error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}</>; }
function formatDate(value: string | null | undefined, locale: string) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "accent" | "muted" | "danger" }) { return <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${tone === "accent" ? "bg-[var(--accent-soft)] text-accent" : tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-subtle text-secondary"}`}>{children}</span>; }

export { AdminUsersPanelEnhanced as AdminUsersPanelLegacy } from "./admin-users-panel";

export { AdminRegistrationSettings as AdminAccessSettingsPanel } from "./admin-registration-settings";

export function AdminSkillsPanel() { const { resolvedLocale } = usePreferences(); const zh = resolvedLocale === "zh-CN"; const [items, setItems] = useState<SystemSkill[]>([]); const [content, setContent] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const load = useCallback(async () => { try { setItems(await adminApi.systemSkills()); } catch (e) { setError(e instanceof Error ? e.message : "Load failed"); } }, []); useEffect(() => { void load(); }, [load]); const view = async (item: SystemSkill) => { try { const url = item.is_customized ? `/api/admin/system-skills/${item.id}` : item.builtin_content_url; if (url) { const response = await fetch(url); const text = await response.text(); setContent((v) => ({ ...v, [item.id]: item.is_customized ? (JSON.parse(text) as { content: string }).content : text })); } } catch (e) { setError(e instanceof Error ? e.message : "Load failed"); } }; return <Panel icon={FileText} title={zhText(zh, "系统 Skill", "System skills")} description={zhText(zh, "管理默认 Skill 与实例级覆盖。", "Manage bundled skills and instance overrides.")}><div className="divide-y divide-[var(--border)]">{items.map((item) => <div key={item.id} className="py-3"><div className="flex items-start gap-3"><FileText className="mt-1 h-4 w-4 text-secondary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-primary">{item.name}</p><Pill tone={item.status === "ACTIVE" ? "accent" : "danger"}>{item.source_kind === "BUNDLED" ? zhText(zh, "内置", "Bundled") : zhText(zh, "管理员创建", "Admin created")}</Pill><Pill>{item.locale}</Pill></div><p className="mt-1 text-xs text-secondary">{item.category} · {item.byte_size} bytes · {formatDate(item.updated_at, resolvedLocale)}</p></div><button type="button" onClick={() => void view(item)} className="btn-secondary flex h-9 w-9 items-center justify-center" aria-label={zhText(zh, "查看 Skill", "View skill")}><Eye className="h-4 w-4" /></button></div>{content[item.id] !== undefined ? <pre className="mt-3 max-h-48 overflow-auto border border-ui bg-subtle p-3 text-xs text-primary">{content[item.id]}</pre> : null}</div>)}</div><Notice error={error} /></Panel>; }

export { AdminFeaturesPanel } from "./admin-feature-settings";

export { AdminSystemPanel } from "./system-backup-panel";

export { AdminAuditPanel } from "./admin-audit-panel";
