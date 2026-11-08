"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { getUserFeatureEntries } from "../../lib/api";
import { getOfflineConversationTags } from "../../lib/offline-db";
import type { ConversationTagValue } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { conversationTagsQueryKey, ConversationTagsPanel } from "./conversation-tags-panel";

export function ConversationTagStrip({ conversationId, offline = false }: { conversationId: string; offline?: boolean }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const root = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      for (const details of root.current?.querySelectorAll("details[open]") ?? []) {
        if (event.target instanceof Node && !details.contains(event.target)) details.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const query = useQuery({
    queryKey: offline ? [...conversationTagsQueryKey, "strip", "offline", conversationId] : conversationTagsQueryKey,
    networkMode: offline ? "always" : "online",
    queryFn: async ({ signal }) => offline
      ? (await getOfflineConversationTags(conversationId)).map((name, index) => ({ id: String(index), value: { name, conversation_ids: [conversationId] } }))
      : getUserFeatureEntries<ConversationTagValue>("conversation-tag", signal),
  });
  const tags = (query.data ?? []).filter(tag => tag.value.conversation_ids.includes(conversationId));
  const chip = (tag: typeof tags[number]) => offline
    ? <span key={tag.id} className="px-2 text-xs text-secondary">{tag.value.name}</span>
    : <Link key={tag.id} href={`/tags?tag=${tag.id}`} className="inline-flex min-h-11 max-w-40 items-center px-2 text-xs text-secondary hover:text-accent"><span className="truncate">#{tag.value.name}</span></Link>;
  return <div ref={root} className="relative flex min-w-0 flex-wrap items-center gap-1" data-reader-auxiliary onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const details = (event.target as Element).closest("details[open]");
    if (details) { event.preventDefault(); event.stopPropagation(); details.removeAttribute("open"); details.querySelector("summary")?.focus({ preventScroll: true }); }
  }}>
    {tags.slice(0, 2).map(chip)}
    {tags.length > 2 ? <details className="relative"><summary className="flex min-h-11 cursor-pointer items-center px-2 text-xs text-secondary">+{tags.length - 2}</summary><div className="absolute left-0 top-full z-[80] grid max-h-64 w-52 overflow-auto rounded-lg border border-ui bg-raised p-2 shadow-sm">{tags.slice(2).map(chip)}</div></details> : null}
    {!offline ? <details className="relative" onToggle={event => setPicking(event.currentTarget.open)}><summary data-reader-tags-trigger className="flex min-h-11 cursor-pointer list-none items-center gap-1 px-2 text-xs text-secondary"><Plus className="h-3.5 w-3.5" />{zh ? "标签" : "Tags"}</summary>
      {picking ? <div role="group" aria-label={zh ? "对话标签" : "Conversation tags"} className="absolute left-0 top-full z-[80] max-h-[60dvh] w-80 max-w-[calc(100vw-32px)] overflow-auto rounded-lg border border-ui bg-raised shadow-sm"><ConversationTagsPanel conversationId={conversationId} /></div> : null}
    </details> : null}
  </div>;
}
