"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { useWorkspaceShell } from "../../components/workspace-shell";
import { usePreferences } from "../../components/preferences-provider";
import { ConversationTagsPanel, conversationTagsQueryKey } from "../../features/reading/conversation-tags-panel";
import { ConversationList } from "../../features/conversations/conversation-list";
import { getUserFeatureEntries } from "../../lib/api";
import type { ConversationTagValue } from "../../lib/types";

export default function TagsRoute() {
  const zh = usePreferences().resolvedLocale === "zh-CN", workspace = useWorkspaceShell();
  const tagId = useSearchParams()?.get("tag") ?? undefined;
  const [mobile, setMobile] = useState(0);
  const [status, setStatus] = useState<"active" | "archived">("active");
  const tags = useQuery({ queryKey: conversationTagsQueryKey, queryFn: ({ signal }) => getUserFeatureEntries<ConversationTagValue>("conversation-tag", signal) });
  const tag = tags.data?.find(item => item.id === tagId);
  const title = tagId ? (tag?.value.name ?? (zh ? "标签对话" : "Tagged conversations")) : (zh ? "标签管理" : "Manage tags");
  const content = <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <MobilePageHeader title={title} description={zh ? "私人标签，不改变对话归属" : "Private tags; conversations stay in their projects"}
      onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobile(value => value + 1)} />
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      {tagId ? <><div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/tags" className="inline-flex min-h-11 items-center text-sm text-accent">{zh ? "管理全部标签" : "Manage all tags"}</Link>
        <label className="text-sm text-secondary">{zh ? "对话状态" : "Conversation status"}<select value={status} onChange={event => setStatus(event.target.value as "active" | "archived")} className="ml-2 min-h-11 rounded-md border border-ui bg-surface px-3"><option value="active">{zh ? "未归档" : "Active"}</option><option value="archived">{zh ? "已归档" : "Archived"}</option></select></label>
      </div><ConversationList key={`${tagId}:${status}`} tagId={tagId} mode={status} /></>
        : <div className="mx-auto max-w-3xl"><ConversationTagsPanel management /></div>}
    </div>
  </section>;
  return workspace.embedded ? content : <main className="flex h-screen overflow-hidden bg-page text-primary"><ProjectSidebar mobileOpenSignal={mobile} showMobileTrigger={false} />{content}</main>;
}
