"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createShare, getConversationShares, revokeShare, updateShare } from "../../lib/api";
import type { ShareRead } from "../../lib/types";

export function SharePanel({
  conversationId,
  selectedMessageIds,
}: {
  conversationId: string;
  selectedMessageIds: string[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [useSelection, setUseSelection] = useState(false);
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
        include_toc: true,
        include_metadata: true,
        allow_export: false,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
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
    <section className="overflow-x-hidden rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-[#111827]">Share</h2>
      <div className="mt-3 grid gap-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Share title"
          className="rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
          className="min-h-20 rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
        />
        <label className="text-sm text-[#374151]">
          Expires at
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[#374151]">
          <input
            type="checkbox"
            checked={useSelection}
            disabled={selectedMessageIds.length === 0}
            onChange={(event) => setUseSelection(event.target.checked)}
          />
          Share selected messages ({selectedMessageIds.length})
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          data-testid="create-share-button"
          onClick={submit}
          disabled={isCreating || (useSelection && selectedMessageIds.length === 0)}
          className="rounded-xl bg-[#111827] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[#d1d5db]"
        >
          {isCreating ? "Creating" : "Create share"}
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
                Open
              </a>
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-lg border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
              >
                Copy URL
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Existing shares</h3>
        {sharesQuery.isLoading ? <p className="text-sm text-slate-500">Loading shares.</p> : null}
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
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(share.expires_at));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveExpiry() {
    setBusy("save");
    setError(null);
    try {
      await updateShare(share.id, {
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
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
