"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createShare, getConversationShares, revokeShare } from "../../lib/api";

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
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
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
            <p data-testid="created-share-url" className="break-all text-sm text-[#374151]">
              {createdUrl}
            </p>
            <button
              type="button"
              onClick={copyUrl}
              className="mt-2 rounded-lg border border-[#d1d5db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
            >
              Copy URL
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-5 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-normal text-[#6b7280]">Existing shares</h3>
        {sharesQuery.isLoading ? <p className="text-sm text-slate-500">Loading shares.</p> : null}
        {sharesQuery.isError ? <p className="text-sm text-red-700">{sharesQuery.error.message}</p> : null}
        {(sharesQuery.data ?? []).map((share) => (
          <div key={share.id} className="rounded-xl border border-[#e5e5e5] p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-[#111827]">{share.title || share.token_prefix}</p>
                <p className="text-xs text-[#6b7280]">
                  {share.scope} / {share.access_count} opens
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await revokeShare(share.id);
                  await sharesQuery.refetch();
                }}
                disabled={Boolean(share.revoked_at)}
                className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:text-[#9ca3af]"
              >
                {share.revoked_at ? "Revoked" : "Revoke"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
