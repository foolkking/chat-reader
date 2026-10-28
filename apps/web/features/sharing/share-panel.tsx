"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { ApiRequestError, createShare, getConversationShares, revokeShare, updateShare } from "../../lib/api";
import type { ShareRead } from "../../lib/types";
import { usePreferences, useTranslations } from "../../components/preferences-provider";
import { useClipboardCopy } from "../../components/use-clipboard-copy";

export function SharePanel({
  conversationId,
  selectedMessageIds,
  compact = false,
}: {
  conversationId: string;
  selectedMessageIds: string[];
  compact?: boolean;
}) {
  const preferences = usePreferences();
  const t = useTranslations();
  const zh = preferences.resolvedLocale === "zh-CN";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [expiryMode, setExpiryMode] = useState<"7d" | "30d" | "never" | "custom">("7d");
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);
  const expiryErrorId = useId();
  const [useSelection, setUseSelection] = useState(false);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [includeNotebook, setIncludeNotebook] = useState(false);
  const [allowExport, setAllowExport] = useState(false);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [sharePasswordConfirm, setSharePasswordConfirm] = useState("");
  const [shareTheme, setShareTheme] = useState<"light" | "dark">(preferences.resolvedTheme);
  const [shareLocale, setShareLocale] = useState<"zh-CN" | "en-US">(preferences.resolvedLocale);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const sharesQuery = useQuery({
    queryKey: ["shares", conversationId],
    queryFn: () => getConversationShares(conversationId),
  });

  async function refreshShares(): Promise<boolean> {
    try {
      const result = await sharesQuery.refetch();
      return !result.isError;
    } catch {
      return false;
    }
  }

  async function submit() {
    setError(null);
    setExpiryError(null);
    if (expiryMode === "custom") {
      const validation = validateFutureExpiry(expiresAt);
      if (!validation.ok) {
        setExpiryError(zh ? validation.zh : validation.en);
        expiryInputRef.current?.focus();
        return;
      }
    }
    if (passwordProtected && sharePassword.length < 12) {
      setError(zh ? "分享密码至少需要 12 个字符。" : "Share passwords must be at least 12 characters.");
      return;
    }
    if (passwordProtected && sharePassword !== sharePasswordConfirm) {
      setError(zh ? "两次输入的分享密码不一致。" : "Share password confirmation does not match.");
      return;
    }
    setIsCreating(true);
    try {
      const response = await createShare(conversationId, {
        title: title.trim() || null,
        description: description.trim() || null,
        scope: useSelection ? "selected_messages" : "conversation",
        selected_message_ids: useSelection ? selectedMessageIds : [],
        include_toc: includeToc,
        include_metadata: includeMetadata,
        include_description: includeDescription,
        include_annotations: includeAnnotations,
        include_notebook: includeNotebook,
        allow_export: allowExport,
        expires_at: expiryValue(expiryMode, expiresAt),
        theme: shareTheme,
        locale: shareLocale,
        share_password: passwordProtected ? sharePassword : null,
      });
      setCreatedUrl(response.share_url);
      if (!await refreshShares()) setError(shareRefreshError(zh, "create"));
    } catch (failure) {
      setError(shareWriteError(failure, zh, "create"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="min-w-0 overflow-x-hidden">
      <div className="grid gap-4">
        <div className={compact ? "hidden" : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3"}>
          <label className="text-sm text-secondary">{t("shareTheme")}<select value={shareTheme} onChange={(event) => setShareTheme(event.target.value as "light" | "dark")} className="mt-1 w-full rounded-lg border border-ui bg-surface px-3 py-2"><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label>
          <label className="text-sm text-secondary">{t("shareLanguage")}<select value={shareLocale} onChange={(event) => setShareLocale(event.target.value as "zh-CN" | "en-US")} className="mt-1 w-full rounded-lg border border-ui bg-surface px-3 py-2"><option value="zh-CN">{t("chinese")}</option><option value="en-US">{t("english")}</option></select></label>
        </div>
        <input
          data-dialog-initial-focus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={zh ? "分享标题（可选）" : "Share title (optional)"}
          className="rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]"
        />
        {!compact ? <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={zh ? "说明（可选）" : "Description (optional)"}
          className="min-h-20 rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--focus)]"
        /> : null}
        {!compact ? <div>
          <p className="mb-2 text-sm text-secondary">{t("expiry")}</p>
          <div className="grid grid-cols-4 rounded-lg bg-subtle p-1">
            {([{"label":t("sevenDays"),"value":"7d"},{"label":t("thirtyDays"),"value":"30d"},{"label":t("never"),"value":"never"},{"label":t("custom"),"value":"custom"}] as const).map((item) => <button key={item.value} type="button" aria-pressed={expiryMode === item.value} onClick={() => { setExpiryMode(item.value); setExpiryError(null); }} className={`min-h-11 rounded-md text-xs ${expiryMode === item.value ? "bg-surface font-medium shadow-sm" : "text-secondary"}`}>{item.label}</button>)}
          </div>
        </div> : null}
        {!compact && expiryMode === "custom" ? <label className="text-sm text-[#374151]">
          {zh ? "到期时间" : "Expiry date"}
          <input
            ref={expiryInputRef}
            type="datetime-local"
            value={expiresAt}
            min={minimumDatetimeLocalValue()}
            aria-invalid={Boolean(expiryError)}
            aria-describedby={expiryError ? expiryErrorId : undefined}
            onChange={(event) => { setExpiresAt(event.target.value); setExpiryError(null); }}
            className="mt-1 block w-full rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
          />
          {expiryError ? <span id={expiryErrorId} role="alert" className="mt-1 block text-xs text-red-700">{expiryError}</span> : null}
        </label> : null}
        {!compact ? <label className="flex items-center gap-2 text-sm text-[#374151]">
          <input
            type="checkbox"
            checked={useSelection}
            disabled={selectedMessageIds.length === 0}
            onChange={(event) => setUseSelection(event.target.checked)}
          />
          {zh ? `仅分享所选消息（${selectedMessageIds.length}）` : `Share selected messages only (${selectedMessageIds.length})`}
        </label> : null}
        {!compact ? <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={includeToc} onChange={(event) => setIncludeToc(event.target.checked)} />{zh ? "包含章节目录" : "Include section contents"}</label> : null}
        {!compact ? <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={includeMetadata} onChange={(event) => setIncludeMetadata(event.target.checked)} />{zh ? "包含元数据" : "Include metadata"}</label> : null}
        {!compact ? <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={allowExport} onChange={(event) => setAllowExport(event.target.checked)} />{zh ? "允许导出" : "Allow export"}</label> : null}
        <fieldset className="grid gap-2 border-y border-ui py-3">
          <legend className="px-1 text-xs font-semibold text-secondary">{zh ? "访问权限" : "Access"}</legend>
          <label className="flex items-center gap-2 text-sm text-primary"><input type="radio" name={`share-access-${conversationId}-${compact ? "compact" : "full"}`} checked={!passwordProtected} onChange={() => setPasswordProtected(false)} />{zh ? "任何拥有链接的人" : "Anyone with the link"}</label>
          <label className="flex items-center gap-2 text-sm text-primary"><input type="radio" name={`share-access-${conversationId}-${compact ? "compact" : "full"}`} checked={passwordProtected} onChange={() => setPasswordProtected(true)} />{zh ? "需要密码" : "Password required"}</label>
          {passwordProtected ? <div className="grid gap-2 pl-6">
            <label className="text-xs text-secondary">{zh ? "分享密码" : "Share password"}<input type="password" autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-primary" /></label>
            <label className="text-xs text-secondary">{zh ? "确认密码" : "Confirm password"}<input type="password" autoComplete="new-password" value={sharePasswordConfirm} onChange={(event) => setSharePasswordConfirm(event.target.value)} className="mt-1 block w-full rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-primary" /></label>
          </div> : null}
        </fieldset>
        {!compact ? <fieldset className="grid gap-2 border-y border-ui py-3">
          <legend className="px-1 text-xs font-semibold text-secondary">{zh ? "私人内容（默认不分享）" : "Private content (not shared by default)"}</legend>
          <PrivacyToggle label={zh ? "包含对话说明" : "Include description"} checked={includeDescription} onChange={setIncludeDescription} />
          <PrivacyToggle label={zh ? "包含批注" : "Include annotations"} checked={includeAnnotations} onChange={setIncludeAnnotations} />
          <PrivacyToggle label={zh ? "包含精选笔记" : "Include notes"} checked={includeNotebook} onChange={setIncludeNotebook} />
        </fieldset> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          data-testid="create-share-button"
          onClick={submit}
          disabled={isCreating || (useSelection && selectedMessageIds.length === 0)}
        className="rounded-lg bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isCreating ? t("creating") : t("createShare")}
        </button>
        {createdUrl ? (
          <div className="rounded-lg border border-ui bg-subtle p-3">
            <a
              data-testid="created-share-url"
              href={createdUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm font-medium text-[#0f766e] hover:underline"
            >
              {createdUrl}
            </a>
            <div className="mt-2 flex gap-2">
              <a
                href={createdUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                {t("open")}
              </a>
              <ShareUrlCopy key={createdUrl} value={createdUrl} zh={zh} />
            </div>
          </div>
        ) : null}
      </div>

      {!compact ? <div className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold text-secondary">{t("createdLinks")}</h3>
        {sharesQuery.isLoading ? <p className="text-sm text-secondary">{zh ? "正在加载分享链接…" : "Loading share links…"}</p> : null}
        {sharesQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--danger)]">
            <p>
              {sharesQuery.data
                ? (zh ? "暂时无法更新分享链接列表，仍显示上次结果。" : "Unable to refresh share links; showing the previous results.")
                : (zh ? "无法读取分享链接列表。" : "Unable to read share links.")}
            </p>
            <button
              type="button"
              disabled={sharesQuery.isFetching}
              onClick={() => void sharesQuery.refetch()}
              className="min-h-10 underline disabled:opacity-60"
            >
              {sharesQuery.isFetching ? (zh ? "正在重试…" : "Retrying…") : (zh ? "重试" : "Retry")}
            </button>
          </div>
        ) : null}
        {(sharesQuery.data ?? []).map((share) => (
          <ShareManagementRow
            key={share.id}
            conversationId={conversationId}
            share={share}
            onCreatedUrl={setCreatedUrl}
            onChanged={refreshShares}
          />
        ))}
      </div> : null}
    </section>
  );
}

function ShareManagementRow({
  conversationId,
  share,
  onCreatedUrl,
  onChanged,
}: {
  conversationId: string;
  share: ShareRead;
  onCreatedUrl: (url: string) => void;
  onChanged: () => Promise<boolean>;
}) {
  const t = useTranslations();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(share.expires_at));
  const [neverExpires, setNeverExpires] = useState(!share.expires_at);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);
  const expiryErrorId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(share.theme);
  const [locale, setLocale] = useState(share.locale);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  async function saveExpiry() {
    const validation = neverExpires ? { ok: true as const } : validateFutureExpiry(expiresAt);
    if (!validation.ok) {
      setExpiryError(zh ? validation.zh : validation.en);
      expiryInputRef.current?.focus();
      return;
    }
    setExpiryError(null);
    setBusy("save");
    setError(null);
    try {
      await updateShare(share.id, {
        expires_at: neverExpires ? null : new Date(expiresAt).toISOString(),
        theme,
        locale,
      });
      if (!await onChanged()) setError(shareRefreshError(zh, "update"));
    } catch (failure) {
      setError(shareWriteError(failure, zh, "update"));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(value: string | null) {
    if (value !== null && value.length < 12) {
      setError(zh ? "分享密码至少需要 12 个字符。" : "Share passwords must be at least 12 characters.");
      return;
    }
    if (value !== null && value !== newPasswordConfirm) {
      setError(zh ? "两次输入的分享密码不一致。" : "Share password confirmation does not match.");
      return;
    }
    setBusy("password");
    setError(null);
    try {
      await updateShare(share.id, { share_password: value });
      setNewPassword("");
      setNewPasswordConfirm("");
      if (!await onChanged()) setError(shareRefreshError(zh, "update"));
    } catch (failure) {
      setError(shareWriteError(failure, zh, "update"));
    } finally {
      setBusy(null);
    }
  }

  async function regenerateShareLink() {
    setBusy("regenerate");
    setError(null);
    try {
      const response = await createShare(conversationId, {
        title: share.title ?? null,
        description: share.description ?? null,
        scope: share.scope === "selected_messages" ? "selected_messages" : "conversation",
        selected_message_ids: share.selected_message_ids ?? [],
        include_toc: share.include_toc,
        include_metadata: share.include_metadata,
        include_description: share.include_description,
        include_annotations: share.include_annotations,
        include_notebook: share.include_notebook,
        allow_export: share.allow_export,
        expires_at: share.expires_at ?? null,
      });
      onCreatedUrl(response.share_url);
      if (!await onChanged()) setError(shareRefreshError(zh, "regenerate"));
    } catch (failure) {
      setError(shareWriteError(failure, zh, "regenerate"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-[#e5e5e5] p-3 text-sm">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-[#111827]">{share.title || share.token_prefix}</p>
          <p className="text-xs text-[#6b7280]">
            {share.scope === "selected_messages" ? (zh ? "所选消息" : "Selected messages") : (zh ? "整个对话" : "Conversation")} · {zh ? `${share.access_count} 次打开` : `${share.access_count} opens`}
            {share.revoked_at ? (zh ? " · 已撤销" : " · revoked") : ""}
          </p>
          {share.share_url ? (
            <a href={share.share_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[#0f766e] hover:underline">
              {share.share_url}
            </a>
          ) : (
            <p className="mt-1 text-xs text-amber-700">{zh ? "旧分享没有可管理网址，请重新生成链接。" : "URL unavailable for older shares; regenerate a managed link."}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {share.share_url ? (
            <>
              <a
                href={share.share_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                {t("open")}
              </a>
              <ShareUrlCopy key={share.share_url} value={share.share_url} zh={zh} />
            </>
          ) : null}
          {!share.share_url && !share.revoked_at && !share.password_required ? (
            <button
              type="button"
              onClick={() => void regenerateShareLink()}
              disabled={busy !== null}
              className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "regenerate" ? t("creating") : (zh ? "重新生成链接" : "Regenerate link")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              setBusy("revoke");
                setError(null);
              try {
                await revokeShare(share.id);
                if (!await onChanged()) setError(shareRefreshError(zh, "revoke"));
              } catch (failure) {
                setError(shareWriteError(failure, zh, "revoke"));
              } finally {
                setBusy(null);
              }
            }}
            disabled={Boolean(share.revoked_at) || busy !== null}
            className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:text-[#9ca3af]"
          >
            {share.revoked_at ? t("revoked") : t("revoke")}
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 rounded-lg bg-subtle p-2">
        <p className="text-xs font-medium text-secondary">{share.password_required ? (zh ? "需要分享密码" : "Password required") : (zh ? "任何拥有链接的人" : "Anyone with the link")}</p>
        {!share.revoked_at && share.password_required ? <button type="button" onClick={() => void savePassword(null)} disabled={busy !== null} className="min-h-8 rounded-lg border border-ui px-2.5 text-xs font-medium text-primary disabled:opacity-60">{busy === "password" ? t("saving") : (zh ? "移除密码" : "Remove password")}</button> : null}
        {!share.revoked_at ? <>
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={share.password_required ? (zh ? "新分享密码" : "New share password") : (zh ? "设置分享密码" : "Set share password")} className="rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm text-primary" />
          <input type="password" autoComplete="new-password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} placeholder={zh ? "确认分享密码" : "Confirm share password"} className="rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm text-primary" />
          <button type="button" onClick={() => void savePassword(newPassword)} disabled={busy !== null || !newPassword} className="min-h-8 rounded-lg bg-[var(--text)] px-2.5 text-xs font-medium text-[var(--surface)] disabled:opacity-60">{busy === "password" ? t("saving") : (zh ? "保存密码" : "Save password")}</button>
        </> : null}
      </div>
      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"><label className="min-w-0 text-xs font-medium text-secondary">{t("shareTheme")}<select value={theme} onChange={(event) => setTheme(event.target.value as "light" | "dark")} className="mt-1 block w-full min-w-0 rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm"><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label><label className="min-w-0 text-xs font-medium text-secondary">{t("shareLanguage")}<select value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en-US")} className="mt-1 block w-full min-w-0 rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm"><option value="zh-CN">{t("chinese")}</option><option value="en-US">{t("english")}</option></select></label></div>
        <label className="flex min-h-11 items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={neverExpires} disabled={Boolean(share.revoked_at) || busy !== null} onChange={(event) => { setNeverExpires(event.target.checked); setExpiryError(null); }} />{zh ? "永不过期" : "Never expires"}</label>
        <label className="text-xs font-medium text-[#6b7280]">
          {zh ? "延长有效期" : "Extend expiry"}
          <input
            type="datetime-local"
            ref={expiryInputRef}
            value={expiresAt}
            min={minimumDatetimeLocalValue()}
            aria-invalid={Boolean(expiryError)}
            aria-describedby={expiryError ? expiryErrorId : undefined}
            onChange={(event) => { setExpiresAt(event.target.value); setExpiryError(null); }}
            disabled={Boolean(share.revoked_at) || neverExpires || busy !== null}
            className="mt-1 block w-full rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-sm text-[#111827] outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/10 disabled:bg-[#f7f7f8]"
          />
          {expiryError ? <span id={expiryErrorId} role="alert" className="mt-1 block text-xs text-[var(--danger)]">{expiryError}</span> : null}
        </label>
        <button
          type="button"
          onClick={() => void saveExpiry()}
          disabled={busy !== null || Boolean(share.revoked_at)}
          className="min-h-9 rounded-lg bg-[#111827] px-3 text-xs font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy === "save" ? t("saving") : (zh ? "保存有效期" : "Save expiry")}
        </button>
      </div>
      {share.expires_at ? <p className="mt-1 text-xs text-secondary">{zh ? "当前有效期" : "Current expiry"}：{new Date(share.expires_at).toLocaleString(resolvedLocale)}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

type ShareWriteAction = "create" | "update" | "regenerate" | "revoke";

function shareRefreshError(zh: boolean, action: ShareWriteAction): string {
  if (action === "create") {
    return zh
      ? "分享已创建，但列表刷新失败。已生成的链接仍在上方，请刷新列表核对。"
      : "The share was created, but the list could not refresh. The generated link remains above; refresh the list to verify.";
  }
  if (action === "regenerate") {
    return zh
      ? "新链接已生成，但列表刷新失败。请刷新列表核对当前分享状态。"
      : "A new link was generated, but the list could not refresh. Refresh the list to verify the current share state.";
  }
  return zh
    ? "操作已完成，但列表刷新失败。请刷新列表核对当前分享状态。"
    : "The action completed, but the list could not refresh. Refresh the list to verify the current share state.";
}

function shareWriteError(failure: unknown, zh: boolean, action: ShareWriteAction): string {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 401) return zh ? "登录已过期，请重新登录后继续。" : "Your session expired. Sign in again to continue.";
    if (failure.status === 403) return zh ? "当前权限不允许此操作。" : "Your current permissions do not allow this action.";
    if (failure.status === 404) return zh ? "分享或所属对话已不存在，请刷新列表确认。" : "The share or its conversation is no longer available. Refresh the list to confirm.";
    if (failure.status === 409) return zh ? "分享状态已发生变化，请刷新列表后重试。" : "The share changed elsewhere. Refresh the list before retrying.";
    if (failure.status === 410) return zh ? "此分享已撤销或过期，不能继续修改。" : "This share was revoked or has expired and cannot be changed.";
    if (failure.status === 422) return zh ? "分享设置无效，请检查所选消息、有效期和密码。" : "The share settings are not valid. Check the selected messages, expiry and password.";
    if (failure.status === 429) return zh ? "操作过于频繁，请稍后重试。" : "Too many requests. Try again shortly.";
  }
  if (action === "revoke") {
    return zh
      ? "撤销结果尚未确认。请刷新列表核对后再决定是否重试。"
      : "The revoke result is not confirmed. Refresh the list before deciding whether to retry.";
  }
  return zh
    ? "操作结果尚未确认。请刷新列表核对后再决定是否重试。"
    : "The action result is not confirmed. Refresh the list before deciding whether to retry.";
}

function PrivacyToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-3 text-sm text-primary">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
    </label>
  );
}

function ShareUrlCopy({ value, zh }: { value: string; zh: boolean }) {
  const clipboard = useClipboardCopy(value);
  return <div className="min-w-0">
    <button type="button" disabled={clipboard.state === "copying"} onClick={() => void clipboard.copy()}
      className="min-h-11 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary disabled:opacity-60">
      {clipboard.state === "copying" ? (zh ? "正在复制…" : "Copying…") : clipboard.state === "copied" ? (zh ? "已复制链接" : "Link copied") : (zh ? "复制链接" : "Copy link")}
    </button>
    {clipboard.state === "copied" ? <span className="sr-only" role="status">{zh ? "分享链接已复制。" : "Share link copied."}</span> : null}
    {clipboard.state === "failed" ? <label className="mt-2 block text-xs text-secondary" role="status">
      {zh ? "无法自动复制，请手动复制完整链接。" : "Automatic copying failed. Copy the full link manually."}
      <textarea ref={clipboard.manualRef} readOnly value={value} rows={3} className="mt-1 block w-full rounded-md border border-ui bg-surface p-2 text-sm text-primary" />
    </label> : null}
  </div>;
}

function toDatetimeLocalValue(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function expiryValue(mode: "7d" | "30d" | "never" | "custom", customValue: string): string | null {
  if (mode === "never") return null;
  if (mode === "custom") return new Date(customValue).toISOString();
  const days = mode === "7d" ? 7 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function minimumDatetimeLocalValue(): string {
  const date = new Date(Date.now() + 60_000);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function validateFutureExpiry(value: string): { ok: true } | { ok: false; zh: string; en: string } {
  if (!value) return { ok: false, zh: "请选择到期时间。选择“永不过期”可不设置日期。", en: "Choose an expiry time, or select “Never” to keep the share permanent." };
  const date = new Date(value);
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  if (Number.isNaN(date.getTime()) || !parts || actual.some((part, index) => part !== Number(parts[index + 1] ?? 0)))
    return { ok: false, zh: "到期时间格式无效或该本地时间不存在。", en: "The expiry time is invalid or does not exist in your local timezone." };
  if (date.getTime() <= Date.now()) return { ok: false, zh: "到期时间必须晚于当前时间。", en: "The expiry time must be in the future." };
  return { ok: true };
}
