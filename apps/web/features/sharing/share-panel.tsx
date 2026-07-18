"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createShare, getConversationShares, revokeShare, updateShare } from "../../lib/api";
import type { ShareRead } from "../../lib/types";
import { usePreferences, useTranslations } from "../../components/preferences-provider";

export function SharePanel({
  conversationId,
  selectedMessageIds,
}: {
  conversationId: string;
  selectedMessageIds: string[];
}) {
  const preferences = usePreferences();
  const t = useTranslations();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [expiryMode, setExpiryMode] = useState<"7d" | "30d" | "never" | "custom">("7d");
  const [useSelection, setUseSelection] = useState(false);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [allowExport, setAllowExport] = useState(false);
  const [shareTheme, setShareTheme] = useState<"light" | "dark">(preferences.resolvedTheme);
  const [shareLocale, setShareLocale] = useState<"zh-CN" | "en-US">(preferences.resolvedLocale);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const sharesQuery = useQuery({
    queryKey: ["shares", conversationId],
    queryFn: () => getConversationShares(conversationId),
  });

  async function submit() {
    setError(null);
    setIsCreating(true);
    try {
      const response = await createShare(conversationId, {
        title: title.trim() || null,
        description: description.trim() || null,
        scope: useSelection ? "selected_messages" : "conversation",
        selected_message_ids: useSelection ? selectedMessageIds : [],
        include_toc: includeToc,
        include_metadata: includeMetadata,
        allow_export: allowExport,
        expires_at: expiryValue(expiryMode, expiresAt),
        theme: shareTheme,
        locale: shareLocale,
      });
      setCreatedUrl(response.share_url);
      await sharesQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create share.");
    } finally {
      setIsCreating(false);
    }
  }

  async function copyUrl() {
    if (!createdUrl) {
      return;
    }
    await navigator.clipboard?.writeText(createdUrl);
  }

  return (
    <section className="min-w-0 overflow-x-hidden">
      <div className="border-b border-[#e5e7eb] pb-4">
        <h2 className="text-base font-semibold text-[#111827]">分享对话</h2>
        <p className="mt-1 text-sm text-[#6b7280]">创建只读链接，并随时延长有效期或撤销访问。</p>
      </div>
      <div className="mt-3 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-secondary">{t("shareTheme")}<select value={shareTheme} onChange={(event) => setShareTheme(event.target.value as "light" | "dark")} className="mt-1 w-full rounded-lg border border-ui bg-surface px-3 py-2"><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label>
          <label className="text-sm text-secondary">{t("shareLanguage")}<select value={shareLocale} onChange={(event) => setShareLocale(event.target.value as "zh-CN" | "en-US")} className="mt-1 w-full rounded-lg border border-ui bg-surface px-3 py-2"><option value="zh-CN">{t("chinese")}</option><option value="en-US">{t("english")}</option></select></label>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="分享标题（可选）"
          className="rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="说明（可选）"
          className="min-h-20 rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
        />
        <div>
          <p className="mb-2 text-sm text-[#374151]">有效期</p>
          <div className="grid grid-cols-4 rounded-lg bg-[#f3f4f6] p-1">
            {([{"label":"7 天","value":"7d"},{"label":"30 天","value":"30d"},{"label":"永久","value":"never"},{"label":"自定义","value":"custom"}] as const).map((item) => <button key={item.value} type="button" onClick={() => setExpiryMode(item.value)} className={`min-h-9 rounded-md text-xs ${expiryMode === item.value ? "bg-white font-medium shadow-sm" : "text-[#6b7280]"}`}>{item.label}</button>)}
          </div>
        </div>
        {expiryMode === "custom" ? <label className="text-sm text-[#374151]">
          到期时间
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
          />
        </label> : null}
        <label className="flex items-center gap-2 text-sm text-[#374151]">
          <input
            type="checkbox"
            checked={useSelection}
            disabled={selectedMessageIds.length === 0}
            onChange={(event) => setUseSelection(event.target.checked)}
          />
          仅分享所选消息（{selectedMessageIds.length}）
        </label>
        <label className="flex items-center gap-2 text-sm text-[#374151]"><input type="checkbox" checked={includeToc} onChange={(event) => setIncludeToc(event.target.checked)} />包含章节目录</label>
        <label className="flex items-center gap-2 text-sm text-[#374151]"><input type="checkbox" checked={includeMetadata} onChange={(event) => setIncludeMetadata(event.target.checked)} />包含元数据</label>
        <label className="flex items-center gap-2 text-sm text-[#374151]"><input type="checkbox" checked={allowExport} onChange={(event) => setAllowExport(event.target.checked)} />允许导出</label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          data-testid="create-share-button"
          onClick={submit}
          disabled={isCreating || (useSelection && selectedMessageIds.length === 0)}
          className="rounded-xl bg-[#111827] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#d1d5db]"
        >
          {isCreating ? "正在创建…" : "创建分享链接"}
        </button>
        {createdUrl ? (
          <div className="rounded-xl bg-[#f7f7f8] p-3">
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
                打开
              </a>
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-lg border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                复制链接
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold text-[#6b7280]">已创建的链接</h3>
        {sharesQuery.isLoading ? <p className="text-sm text-slate-500">正在加载分享链接…</p> : null}
        {sharesQuery.isError ? <p className="text-sm text-red-700">{sharesQuery.error.message}</p> : null}
        {(sharesQuery.data ?? []).map((share) => (
          <ShareManagementRow
            key={share.id}
            conversationId={conversationId}
            share={share}
            onCreatedUrl={setCreatedUrl}
            onChanged={() => sharesQuery.refetch()}
          />
        ))}
      </div>
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
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations();
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(share.expires_at));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(share.theme);
  const [locale, setLocale] = useState(share.locale);

  async function saveExpiry() {
    setBusy("save");
    setError(null);
    try {
      await updateShare(share.id, {
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        theme,
        locale,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update share.");
    } finally {
      setBusy(null);
    }
  }

  async function copyShareUrl() {
    if (!share.share_url) {
      return;
    }
    await navigator.clipboard?.writeText(share.share_url);
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
        allow_export: share.allow_export,
        expires_at: share.expires_at ?? null,
      });
      onCreatedUrl(response.share_url);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to regenerate share link.");
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
            {share.scope} / {share.access_count} opens
            {share.revoked_at ? " / revoked" : ""}
          </p>
          {share.share_url ? (
            <a href={share.share_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[#0f766e] hover:underline">
              {share.share_url}
            </a>
          ) : (
            <p className="mt-1 text-xs text-amber-700">URL unavailable for older shares; regenerate a managed link.</p>
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
                Open
              </a>
              <button
                type="button"
                onClick={() => void copyShareUrl()}
                className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                Copy
              </button>
            </>
          ) : null}
          {!share.share_url && !share.revoked_at ? (
            <button
              type="button"
              onClick={() => void regenerateShareLink()}
              disabled={busy !== null}
              className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-60"
            >
              {busy === "regenerate" ? "Creating" : "Regenerate link"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              setBusy("revoke");
              setError(null);
              try {
                await revokeShare(share.id);
                await onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to revoke share.");
              } finally {
                setBusy(null);
              }
            }}
            disabled={Boolean(share.revoked_at) || busy !== null}
            className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:text-[#9ca3af]"
          >
            {share.revoked_at ? "Revoked" : "Revoke"}
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-2 gap-2"><label className="text-xs font-medium text-secondary">{t("shareTheme")}<select value={theme} onChange={(event) => setTheme(event.target.value as "light" | "dark")} className="mt-1 block w-full rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm"><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label><label className="text-xs font-medium text-secondary">{t("shareLanguage")}<select value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en-US")} className="mt-1 block w-full rounded-lg border border-ui bg-surface px-2.5 py-1.5 text-sm"><option value="zh-CN">{t("chinese")}</option><option value="en-US">{t("english")}</option></select></label></div>
        <label className="text-xs font-medium text-[#6b7280]">
          Extend expiry
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            disabled={Boolean(share.revoked_at)}
            className="mt-1 block w-full rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-sm text-[#111827] outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/10 disabled:bg-[#f7f7f8]"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveExpiry()}
          disabled={busy !== null || Boolean(share.revoked_at)}
          className="min-h-9 rounded-lg bg-[#111827] px-3 text-xs font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy === "save" ? "Saving" : "Save expiry"}
        </button>
      </div>
      {share.expires_at ? <p className="mt-1 text-xs text-[#6b7280]">Current expiry: {new Date(share.expires_at).toLocaleString()}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
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
  if (mode === "custom") return customValue ? new Date(customValue).toISOString() : null;
  const days = mode === "7d" ? 7 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
