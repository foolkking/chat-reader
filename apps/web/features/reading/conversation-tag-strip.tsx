"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getUserFeatureEntries } from "../../lib/api";
import { getOfflineConversationTags } from "../../lib/offline-db";
import type { ConversationTagValue } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { conversationTagsQueryKey, ConversationTagsPanel } from "./conversation-tags-panel";

export function ConversationTagStrip({ conversationId, offline = false, title, positionLabel, compact = false }: {
  conversationId: string; offline?: boolean; title?: string; positionLabel?: string; compact?: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const root = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.type === "focusin" && (event.target === document.body || event.target === document.documentElement)) return;
      for (const details of root.current?.querySelectorAll("details[open]") ?? []) {
        if (event.target instanceof Node && !details.contains(event.target)) details.removeAttribute("open");
      }
    };
    const escapeAfterBlur = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // Disabling a submitted button can move focus to body. The root's
      // bubbled handler cannot receive that Escape; keep the open disclosure
      // dismissible without moving focus away from another control or modal.
      if (event.target !== document.body && event.target !== document.documentElement) return;
      const details = Array.from(root.current?.querySelectorAll<HTMLDetailsElement>("details[open]") ?? [])
        .find(item => item.getClientRects().length);
      if (!details?.getClientRects().length) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escapeAfterBlur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escapeAfterBlur);
    };
  }, []);
  const query = useQuery({
    queryKey: offline ? [...conversationTagsQueryKey, "strip", "offline", conversationId] : conversationTagsQueryKey,
    networkMode: offline ? "always" : "online",
    queryFn: async ({ signal }) => offline
      ? (await getOfflineConversationTags(conversationId)).map((name, index) => ({ id: String(index), value: { name, conversation_ids: [conversationId] } }))
      : getUserFeatureEntries<ConversationTagValue>("conversation-tag", signal),
  });
  const tags = (query.data ?? []).filter(tag => tag.value.conversation_ids.includes(conversationId));
  const visibleCount = compact ? 1 : 2;
  const hint = zh ? "点击管理标签" : "Click to manage tags";
  const chip = (tag: typeof tags[number]) => offline
    ? <span key={tag.id} className="max-w-32 truncate px-1 text-xs text-secondary">#{tag.value.name}</span>
    : <Link key={tag.id} href={`/tags?tag=${tag.id}`} className="inline-flex min-h-8 min-w-0 max-w-32 items-center px-1 text-xs text-secondary hover:text-accent focus-visible:ring-2 focus-visible:ring-[var(--focus)]"><span className="truncate">#{tag.value.name}</span></Link>;
  return <div ref={root} className={compact ? "contents" : "relative min-w-0"} data-reader-auxiliary onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof Element)) return;
    const details = event.target.closest("details[open]");
    if (details) { event.preventDefault(); event.stopPropagation(); details.removeAttribute("open"); details.querySelector("summary")?.focus({ preventScroll: true }); }
  }}>
    {!offline ? <details className="relative min-w-0 flex-1" onToggle={event => setPicking(event.currentTarget.open)}><summary data-reader-tags-trigger title={`${title ?? ""} · ${hint}`} aria-label={`${title ?? ""} — ${hint}`} className="flex min-h-8 w-fit max-w-full cursor-pointer list-none items-center rounded text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] [&::-webkit-details-marker]:hidden"><h1 className="truncate text-base font-semibold">{title}</h1></summary>
      {picking ? <div role="group" aria-label={zh ? "对话标签" : "Conversation tags"} className="absolute left-0 top-full z-[80] max-h-[60dvh] w-80 max-w-[calc(100vw-96px)] overflow-auto rounded-lg border border-ui bg-raised shadow-sm"><ConversationTagsPanel conversationId={conversationId} /></div> : null}
    </details> : <h1 className="min-h-8 min-w-0 flex-1 truncate content-center text-base font-semibold text-primary" title={title}>{title}</h1>}
    <div className={`flex min-h-7 min-w-0 items-center gap-2 text-xs text-secondary ${compact ? "order-last basis-full" : ""}`} data-reader-position-and-tags>
      <span className="shrink-0 tabular-nums" data-reader-current-message>{positionLabel}</span>
      <div className="flex min-w-0 items-center gap-1">
        {tags.slice(0, visibleCount).map(chip)}
        {tags.length > visibleCount ? <details className="relative shrink-0"><summary aria-label={zh ? "更多标签" : "More tags"} className="flex min-h-8 cursor-pointer list-none items-center px-1 text-xs text-secondary">+{tags.length - visibleCount}</summary><div className="absolute right-0 top-full z-[80] grid max-h-64 w-52 overflow-auto rounded-lg border border-ui bg-raised p-2 shadow-sm">{tags.slice(visibleCount).map(chip)}</div></details> : null}
      </div>
    </div>
  </div>;
}
