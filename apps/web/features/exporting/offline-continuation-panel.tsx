"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { offlineDb } from "../../lib/offline-db";
import { usePreferences } from "../../components/preferences-provider";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { IndexReading } from "./continuation-document";
import type { ContinuationNavigate, ContinuationViewState } from "./continuation-index";
import { ContinuationFind } from "./continuation-find";

export function OfflineContinuationPanel({ conversationId, onNavigate, viewState }: { conversationId: string; onNavigate?: ContinuationNavigate; viewState?: ContinuationViewState }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [member, setMember] = useState<"current" | "index">(viewState?.member ?? "current");
  const [source, setSource] = useState(false);
  const { data: conversation } = useQuery({ queryKey: ["offline-continuation", offlineDb.name, conversationId], queryFn: () => offlineDb.conversations.get(conversationId), networkMode: "always" });
  const text = conversation?.continuation?.members[member]?.text;
  return <section className="min-w-0 space-y-5">
    <nav className="flex items-center gap-4 border-b border-ui" aria-label={zh ? "离线接续内容" : "Offline continuation content"}>
      {(["current", "index"] as const).map(name => <button key={name} type="button" aria-pressed={name === member} onClick={() => { setMember(name); if (viewState) viewState.member = name; }} className={`min-h-12 border-b-2 px-1 text-sm ${name === member ? "border-[var(--accent)] font-semibold" : "border-transparent text-secondary"}`}>{name === "current" ? "Current" : "Index"}</button>)}
      <button type="button" className="ml-auto min-h-11 rounded-md px-3 text-sm text-secondary hover:bg-subtle" aria-pressed={source} onClick={() => setSource(v => !v)}>{source ? (zh ? "阅读" : "Read") : (zh ? "原文" : "Source")}</button>
    </nav>
    <p className="text-sm leading-6 text-secondary">{zh ? "离线副本 · 只读。更新文件需回到在线对话，重新下载后可在这里查看。" : "Offline copy · Read only. Update files in the online conversation, then download again to see them here."}</p>
    {text === undefined ? <p className="py-12 text-secondary">{zh ? "此离线副本没有这个接续文件。" : "This offline copy does not contain this continuation file."}</p> : source ? <ContinuationFind zh={zh} contentKey={text}><pre className="whitespace-pre-wrap break-all font-mono text-sm leading-7">{text}</pre></ContinuationFind> : member === "index" ? <IndexReading text={text} zh={zh} onNavigate={onNavigate} viewState={viewState} /> : <ContinuationFind zh={zh} contentKey={text}><div className="max-w-prose text-base leading-7 [&_h2]:mt-8 [&_p]:my-4"><MarkdownRenderer text={text} isAssistant={false} /></div></ContinuationFind>}
  </section>;
}
