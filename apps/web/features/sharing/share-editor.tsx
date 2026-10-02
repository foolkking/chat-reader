"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, FileText, Link2, LockKeyhole, Palette, ShieldCheck } from "lucide-react";
import { getConversationDialogueIndex, updateShare } from "../../lib/api";
import { readAccountCapabilities } from "../../lib/auth-client";
import type { ShareRead, ShareUpdateInput } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

const control = "mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-ui bg-surface px-3 py-2 text-base text-primary sm:text-sm";
const flags = ["include_toc", "include_metadata", "include_description", "include_annotations", "include_notebook", "allow_export"] as const;

function localDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function SettingsSection({ title, summary, icon, open, onToggle, children }: { title: string; summary: string; icon: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return <section className="border-t border-ui">
    <h4><button type="button" aria-expanded={open} aria-controls={id} className="flex min-h-20 w-full items-center gap-3 rounded-md py-4 text-left hover:bg-subtle" onClick={onToggle}>
      <span className="shrink-0 text-secondary" aria-hidden="true">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-primary">{title}</span><span className="mt-1 block text-xs font-normal leading-5 text-secondary">{summary}</span></span><ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-secondary ${open ? "rotate-180" : ""}`} />
    </button></h4>
    <div id={id} hidden={!open} className="pb-5">{children}</div>
  </section>;
}

function Choice({ name, title, description, checked, disabled, onChange }: { name: string; title: string; description: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  const descriptionId = useId();
  return <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? "border-[var(--text-secondary)] bg-subtle" : "border-ui bg-surface"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
    <input type="radio" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" name={name} aria-label={title} aria-describedby={descriptionId} checked={checked} disabled={disabled} onChange={onChange} /><span><span className="block text-sm font-medium text-primary">{title}</span><span id={descriptionId} className="mt-1 block text-xs leading-5 text-secondary">{description}</span></span>
  </label>;
}

export function ShareEditor({ share, onSaved, onClose, onDirtyChange }: {
  share: ShareRead; onSaved: (share: ShareRead) => void; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog(), client = useQueryClient();
  const backRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null), errorFocus = useRef<string | null>(null);
  const [section, setSection] = useState<string | null>("content");
  const [expiryPreset, setExpiryPreset] = useState(share.expires_at ? "custom" : "never");
  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, []);
  const [title, setTitle] = useState(share.title ?? ""), [description, setDescription] = useState(share.description ?? "");
  const [expires, setExpires] = useState(localDate(share.expires_at));
  const [scope, setScope] = useState(share.scope), [selected, setSelected] = useState(share.selected_message_ids ?? []);
  const [options, setOptions] = useState(() => Object.fromEntries(flags.map((flag) => [flag, share[flag]])) as Record<typeof flags[number], boolean>);
  const [passwordMode, setPasswordMode] = useState("keep"), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [theme, setTheme] = useState(share.theme), [locale, setLocale] = useState(share.locale);
  const [offset, setOffset] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (errorFocus.current) { rootRef.current?.querySelector<HTMLElement>(errorFocus.current)?.focus(); errorFocus.current = null; } }, [error, section]);
  const capabilities = useQuery({ queryKey: ["account-capabilities"], queryFn: ({ signal }) => readAccountCapabilities(signal), retry: false });
  const messages = useQuery({ queryKey: ["share-message-options", share.conversation_id, offset], queryFn: () => getConversationDialogueIndex(share.conversation_id, { offset, limit: 20 }), enabled: scope === "selected_messages", retry: false });
  const dirty = title !== (share.title ?? "") || description !== (share.description ?? "") || expires !== localDate(share.expires_at)
    || scope !== share.scope || JSON.stringify(selected) !== JSON.stringify(share.selected_message_ids ?? [])
    || flags.some((flag) => options[flag] !== share[flag]) || passwordMode !== "keep" || !!password || !!confirmation || theme !== share.theme || locale !== share.locale;
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function close() {
    if (busy) return;
    if (dirty && !await confirm({ title: zh ? "放弃未保存的分享设置？" : "Discard unsaved share settings?", confirmLabel: zh ? "放弃更改" : "Discard changes", danger: true })) return;
    onClose();
  }

  async function save() {
    setError(null);
    if (scope === "selected_messages" && !selected.length) { errorFocus.current = '[data-message-picker] input'; setSection("content"); setError(zh ? "请至少选择一条消息。" : "Select at least one message."); return; }
    if (passwordMode === "set" && (password.length < 12 || password !== confirmation)) { errorFocus.current = '[data-share-password]'; setSection("access"); setError(zh ? "密码至少 12 个字符，两次输入须一致。" : "Use at least 12 characters and matching passwords."); return; }
    const input: ShareUpdateInput = { title: title.trim() || null, description: description.trim() || null, theme, locale, ...options };
    // Retain exact expiry precision and old selected-message grants when untouched.
    if (expires !== localDate(share.expires_at)) {
      const date = expires ? new Date(expires) : null;
      if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) { errorFocus.current = '[type="datetime-local"]'; setSection("access"); setExpiryPreset("custom"); setError(zh ? "请选择将来的到期时间。" : "Choose a future expiry time."); return; }
      input.expires_at = date?.toISOString() ?? null;
    }
    if (scope !== share.scope || JSON.stringify(selected) !== JSON.stringify(share.selected_message_ids ?? [])) {
      input.scope = scope === "selected_messages" ? "selected_messages" : "conversation";
      input.selected_message_ids = scope === "selected_messages" ? selected : [];
    }
    if (passwordMode !== "keep") input.share_password = passwordMode === "set" ? password : null;
    if (!await confirm({ title: zh ? "应用分享设置？" : "Apply share settings?", description: zh ? "原链接将立即使用这些访问权限和内容范围。" : "The existing link will immediately use these permissions and content limits.", confirmLabel: zh ? "应用设置" : "Apply settings" })) return;
    setBusy(true);
    try {
      const result = await updateShare(share.id, input);
      await Promise.all([client.invalidateQueries({ queryKey: ["shares"] }), client.invalidateQueries({ queryKey: ["my-shares"] })]);
      onDirtyChange(false); onSaved(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : (zh ? "保存失败，请重试。" : "Save failed. Retry.")); }
    finally { setBusy(false); }
  }

  const flagLabels = zh ? ["包含章节目录", "包含元数据", "包含对话说明", "包含批注", "包含精选笔记", "允许导出"] : ["Include section contents", "Include metadata", "Include description", "Include annotations", "Include notes", "Allow export"];
  const flagDescriptions = zh ? ["帮助访客按章节跳转。", "显示消息的模型、时间等信息。", "一并展示来源对话的说明。", "让访客看到你的划线和批注。", "让访客看到你整理的精选笔记。"] : ["Help readers jump between sections.", "Show message details such as model and time.", "Show the source conversation’s description.", "Let visitors read your highlights and annotations.", "Let visitors read your curated notes."];
  const protectedLink = passwordMode === "set" || (passwordMode === "keep" && share.password_required);
  const scopeSummary = scope === "conversation" ? (zh ? "整个对话" : "Entire conversation") : (zh ? `已选 ${selected.length} 条消息` : `${selected.length} selected messages`);
  const accessSummary = protectedLink ? (zh ? "密码保护" : "Password protected") : (zh ? "持有链接即可访问" : "Anyone with the link");
  const expirySummary = expires ? (zh ? "到期 " : "Expires ") + new Date(expires).toLocaleString(resolvedLocale) : (zh ? "永久有效" : "No expiry");
  const extras = flags.slice(0, 5).filter((flag) => options[flag]);
  function toggleSection(value: string) { setSection((current) => current === value ? null : value); }
  function chooseAccess(protect: boolean) {
    setPasswordMode(protect ? (share.password_required ? "keep" : "set") : (share.password_required ? "remove" : "keep"));
    setPassword(""); setConfirmation("");
  }
  return <section ref={rootRef} aria-label={zh ? "编辑分享" : "Edit share"} className="grid min-w-0 gap-4" aria-busy={busy}>
    <div>
      <button ref={backRef} type="button" className="btn-ghost -ml-2 inline-flex min-h-11 items-center gap-2 px-2 text-sm" onClick={() => void close()} disabled={busy}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{zh ? "返回分享列表" : "Back to shares"}</button>
      <h3 className="mt-2 break-words text-base font-semibold text-primary">{title || share.title || (zh ? "分享设置" : "Share settings")}</h3>
      <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "调整后保存，已发出的链接会同步生效。" : "Save your changes to update the link you’ve already sent."}</p>
    </div>
    <div className="flex items-start gap-3 rounded-lg bg-subtle p-3">
      {protectedLink ? <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" /> : <Link2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />}
      <div className="min-w-0"><p className="text-sm font-medium text-primary">{accessSummary}</p><p className="mt-1 text-xs leading-5 text-secondary">{scopeSummary} · {expirySummary}</p></div>
    </div>
    <fieldset disabled={busy} className="min-w-0 disabled:opacity-60" onChange={() => setError(null)}>
      <SettingsSection title={zh ? "分享内容" : "Shared content"} summary={zh ? `${scopeSummary} · 附加内容 ${extras.length} 项` : `${scopeSummary} · ${extras.length} extras included`} icon={<FileText className="h-5 w-5" />} open={section === "content"} onToggle={() => toggleSection("content")}>
        <fieldset className="grid min-w-0 gap-3"><legend className="sr-only">{zh ? "分享内容范围" : "Content scope"}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice name="edit-share-scope" title={zh ? "整个对话" : "Entire conversation"} description={zh ? "分享这个对话中的全部消息。" : "Share every message in this conversation."} checked={scope === "conversation"} onChange={() => setScope("conversation")} />
            <Choice name="edit-share-scope" title={zh ? "仅所选消息" : "Selected messages only"} description={zh ? "挑选需要分享的消息，其余内容保持私密。" : "Choose messages to share. Keep the rest private."} checked={scope === "selected_messages"} onChange={() => setScope("selected_messages")} />
          </div>
          {scope === "selected_messages" ? <div data-message-picker className="grid gap-2 border-y border-ui py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-secondary">{zh ? `已选 ${selected.length} 条消息（跨页保留）` : `${selected.length} messages selected across pages`}</p><button type="button" className="btn-ghost min-h-11 px-2 text-xs" onClick={() => setSelected([])}>{zh ? "清空消息选择" : "Clear message selection"}</button></div>
            {messages.isPending ? <p role="status" className="text-sm text-secondary">{zh ? "正在加载消息…" : "Loading messages…"}</p> : null}
            {messages.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "无法加载消息。" : "Unable to load messages."} <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void messages.refetch()}>{zh ? "重试" : "Retry"}</button></p> : null}
            <div className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto">{messages.data?.items.map((item) => <label key={item.message_id} className="flex min-h-11 items-start gap-3 px-1 py-3 text-sm text-primary"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={selected.includes(item.message_id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, item.message_id] : ids.filter((id) => id !== item.message_id))} /><span className="min-w-0 break-words"><span className="text-xs text-secondary">{item.ordinal} · {item.role}</span><span className="block line-clamp-2">{item.preview}</span></span></label>)}</div>
            <div className="flex items-center justify-between gap-2"><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={!offset || messages.isFetching} onClick={() => setOffset((v) => Math.max(0, v - 20))}>{zh ? "上一组消息" : "Previous messages"}</button><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={!messages.data?.has_more || messages.isFetching} onClick={() => setOffset((v) => v + 20)}>{zh ? "下一组消息" : "Next messages"}</button></div>
          </div> : null}
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-primary [&::-webkit-details-marker]:hidden"><span>{zh ? "附加内容" : "Additional content"}<span className="ml-2 text-xs text-secondary">{zh ? `已包含 ${extras.length} 项` : `${extras.length} included`}</span></span><ChevronDown aria-hidden="true" className="h-4 w-4 text-secondary group-open:rotate-180" /></summary>
            <p className="mb-2 text-xs leading-5 text-secondary">{zh ? "批注和笔记属于你的私人内容，请按需开启。" : "Annotations and notes are personal. Include them only if you want to share them."}</p>
            <div className="divide-y divide-[var(--border)]">{flags.slice(0, 5).map((flag, i) => <label key={flag} className="flex min-h-11 items-center justify-between gap-4 py-3"><span><span className="block text-sm text-primary">{flagLabels[i]}</span><span className="mt-1 block text-xs leading-5 text-secondary">{flagDescriptions[i]}</span></span><input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" aria-label={flagLabels[i]} checked={options[flag]} onChange={(e) => setOptions((value) => ({ ...value, [flag]: e.target.checked }))} /></label>)}</div>
          </details>
        </fieldset>
      </SettingsSection>
      <SettingsSection title={zh ? "访问权限" : "Access & permissions"} summary={`${accessSummary} · ${expirySummary}`} icon={<ShieldCheck className="h-5 w-5" />} open={section === "access"} onToggle={() => toggleSection("access")}>
        <div className="grid gap-5">
          <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium text-primary">{zh ? "谁可以查看" : "Who can view"}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice name="edit-share-access" title={zh ? "持有链接的人" : "Anyone with the link"} description={zh ? "无需登录或输入密码。" : "No sign-in or password required."} checked={!protectedLink} disabled={!!protectedLink && !capabilities.data?.allow_public_share} onChange={() => chooseAccess(false)} />
              <Choice name="edit-share-access" title={zh ? "需要密码" : "Require a password"} description={zh ? "打开链接后，先输入你设置的密码。" : "Visitors enter your password before reading."} checked={!!protectedLink} disabled={!protectedLink && !capabilities.data?.allow_share_password} onChange={() => chooseAccess(true)} />
            </div>
            {protectedLink && passwordMode === "keep" ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary"><span>{zh ? "正在使用现有密码。" : "Using the existing password."}</span><button type="button" className="btn-ghost min-h-11 px-3" disabled={!capabilities.data?.allow_share_password} onClick={() => setPasswordMode("set")}>{zh ? "更换密码" : "Change password"}</button></div> : null}
            {passwordMode === "set" ? <div className="mt-3 grid gap-3">
              <p className="text-xs text-secondary">{zh ? "至少 12 个字符，请将密码单独发给接收者。" : "Use at least 12 characters. Send the password to recipients separately."}</p>
              <label className="text-sm text-secondary">{zh ? "新分享密码" : "New share password"}<input data-share-password type="password" autoComplete="new-password" className={control} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <label className="text-sm text-secondary">{zh ? "确认分享密码" : "Confirm share password"}<input type="password" autoComplete="new-password" className={control} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
              {share.password_required ? <button type="button" className="btn-ghost min-h-11 justify-self-start px-3 text-xs" onClick={() => { setPasswordMode("keep"); setPassword(""); setConfirmation(""); }}>{zh ? "保留原密码" : "Keep existing password"}</button> : null}
            </div> : null}
          </fieldset>
          <div><label className="text-sm font-medium text-primary">{zh ? "链接有效期" : "Link lifetime"}<select className={control} value={expiryPreset} onChange={(e) => { const value = e.target.value; setExpiryPreset(value); if (value === "never") setExpires(""); else if (value !== "custom") setExpires(localDate(new Date(Date.now() + Number(value) * 86_400_000).toISOString())); }}>
            <option value="never">{zh ? "永久有效" : "No expiry"}</option><option value="7">{zh ? "从现在起 7 天" : "7 days from now"}</option><option value="30">{zh ? "从现在起 30 天" : "30 days from now"}</option><option value="custom">{zh ? "自定义到期时间" : "Custom expiry"}</option>
          </select></label>
          {expiryPreset === "custom" ? <label className="mt-3 block text-sm text-secondary">{zh ? "到期时间（留空为永久）" : "Expiry (empty means never)"}<input type="datetime-local" className={control} value={expires} onChange={(e) => setExpires(e.target.value)} /></label> : null}
          <p className="mt-2 text-xs leading-5 text-secondary">{zh ? "到期后链接停止访问，对话原文仍然保留。" : "The link stops working when it expires. Your conversation stays intact."}</p></div>
          <label className="flex min-h-11 items-center justify-between gap-4 border-t border-ui pt-4"><span><span className="block text-sm font-medium text-primary">{flagLabels[5]}</span><span className="mt-1 block text-xs leading-5 text-secondary">{zh ? "允许访客下载分享范围内的内容副本。" : "Let visitors download a copy of the shared content."}</span></span><input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" aria-label={flagLabels[5]} checked={options.allow_export} onChange={(e) => setOptions((value) => ({ ...value, allow_export: e.target.checked }))} /></label>
        </div>
      </SettingsSection>
      <SettingsSection title={zh ? "链接外观" : "Link appearance"} summary={zh ? `${theme === "dark" ? "深色" : "浅色"} · ${locale === "zh-CN" ? "中文" : "English"} · 标题与说明` : `${theme === "dark" ? "Dark" : "Light"} · ${locale === "zh-CN" ? "中文" : "English"} · Title and description`} icon={<Palette className="h-5 w-5" />} open={section === "appearance"} onToggle={() => toggleSection("appearance")}>
        <div className="grid gap-4">
          <p className="text-xs leading-5 text-secondary">{zh ? "只改变分享页面的展示，不修改来源对话。" : "Customize the shared page without changing your source conversation."}</p>
          <label className="text-sm text-secondary">{zh ? "分享标题" : "Share title"}<input className={control} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="text-sm text-secondary">{zh ? "分享说明" : "Share description"}<textarea className={control} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm text-secondary">{zh ? "分享主题" : "Share theme"}<select className={control} value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}><option value="light">{zh ? "浅色" : "Light"}</option><option value="dark">{zh ? "深色" : "Dark"}</option></select></label><label className="text-sm text-secondary">{zh ? "分享语言" : "Share language"}<select className={control} value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label></div>
        </div>
      </SettingsSection>
    </fieldset>
    {capabilities.isError ? <p role="alert" className="text-sm text-secondary">{zh ? "无法读取分享策略。" : "Sharing policy unavailable."} <button className="btn-secondary min-h-11 px-3" onClick={() => void capabilities.refetch()}>{zh ? "重试" : "Retry"}</button></p> : null}
    {capabilities.data && !capabilities.data.allow_share_links ? <p role="status" className="text-sm text-secondary">{zh ? "管理员已关闭分享编辑，仍可返回列表查看或撤销。" : "Sharing edits are disabled. Return to the list to view or revoke links."}</p> : null}
    <div className="sticky -bottom-5 grid gap-2 border-t border-ui bg-raised py-3">
      {error ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-secondary">{dirty ? (zh ? "有未保存的更改" : "Unsaved changes") : (zh ? "已与当前链接一致" : "Up to date with this link")}</p>
      <button type="button" className="btn-primary min-h-11 px-4 text-sm disabled:opacity-60" disabled={busy || !dirty || !capabilities.data?.allow_share_links} onClick={() => void save()}>{busy ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存分享设置" : "Save share settings")}</button></div>
    </div>
  </section>;
}
