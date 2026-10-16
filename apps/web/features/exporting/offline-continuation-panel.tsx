"use client";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { offlineDb } from "../../lib/offline-db";
import { assertOfflineAccess, captureOfflineAccess, OfflineAccessError } from "../../lib/offline-access";
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
  const database = offlineDb;
  const query = useQuery({
    queryKey: ["offline-continuation", database.name, conversationId],
    queryFn: async () => {
      const access = captureOfflineAccess();
      if (database !== offlineDb) throw new OfflineAccessError();
      const conversation = await database.conversations.get(conversationId);
      assertOfflineAccess(access);
      return conversation ?? null;
    },
    networkMode: "always",
  });
  const conversation = query.data?.id === conversationId ? query.data : null;
  const accessLocked = query.error instanceof OfflineAccessError;
  const readable = Boolean(conversation) && !accessLocked;
  const text = conversation?.continuation?.members[member]?.text;
  const retry = () => {
    if (!query.isFetching) void query.refetch({ cancelRefetch: false });
  };
  const retryButton = <button type="button" disabled={query.isFetching} onClick={retry}
    className="min-h-11 rounded-md border border-ui px-3 text-sm text-primary hover:bg-subtle disabled:opacity-50">
    {query.isFetching ? (zh ? "正在重试…" : "Retrying…") : (zh ? "重试" : "Retry")}
  </button>;
  let content: ReactNode = null;
  if (query.isPending) {
    content = <p role="status" aria-busy="true" className="py-12 text-secondary">{zh ? "正在读取接续内容…" : "Loading continuation files…"}</p>;
  } else if (!query.isError && !conversation) {
    content = <div role="status" className="space-y-3 py-12 text-secondary">
      <p>{zh ? "此离线对话副本已不可用。请回到资料库确认副本，联网后可重新下载。" : "This offline conversation copy is unavailable. Check the library; reconnect to download it again if needed."}</p>
      {retryButton}
    </div>;
  } else if (readable) {
    content = text === undefined
      ? <p className="py-12 text-secondary">{zh ? "此离线副本没有这个接续文件。" : "This offline copy does not contain this continuation file."}</p>
      : source
        ? <ContinuationFind zh={zh} contentKey={text}><pre className="whitespace-pre-wrap break-all font-mono text-sm leading-7">{text}</pre></ContinuationFind>
        : member === "index"
          ? <IndexReading text={text} zh={zh} onNavigate={onNavigate} viewState={viewState} />
          : <ContinuationFind zh={zh} contentKey={text}><div className="max-w-prose text-base leading-7 [&_h2]:mt-8 [&_p]:my-4"><MarkdownRenderer text={text} isAssistant={false} /></div></ContinuationFind>;
  }
  return <section className="min-w-0 space-y-5">
    <nav className="flex items-center gap-4 border-b border-ui" aria-label={zh ? "离线接续内容" : "Offline continuation content"}>
      {(["current", "index"] as const).map(name => <button key={name} type="button" aria-pressed={name === member} onClick={() => { setMember(name); if (viewState) viewState.member = name; }} className={`min-h-12 border-b-2 px-1 text-sm ${name === member ? "border-[var(--accent)] font-semibold" : "border-transparent text-secondary"}`}>{name === "current" ? "Current" : "Index"}</button>)}
      <button type="button" className="ml-auto min-h-11 rounded-md px-3 text-sm text-secondary hover:bg-subtle" aria-pressed={source} onClick={() => setSource(v => !v)}>{source ? (zh ? "阅读" : "Read") : (zh ? "原文" : "Source")}</button>
    </nav>
    <p className="text-sm leading-6 text-secondary">{zh ? "离线副本 · 只读。更新文件需回到在线对话，重新下载后可在这里查看。" : "Offline copy · Read only. Update files in the online conversation, then download again to see them here."}</p>
    {query.isError ? <div role="alert" className="space-y-3 text-sm text-secondary">
      <p>{accessLocked
        ? (zh ? "本机访问已锁定。请关闭此视图，回到资料库恢复访问后重试。" : "Local access is locked. Close this view and restore library access, then retry.")
        : readable
          ? (zh ? "无法刷新接续文件，当前显示此前读取的离线副本。" : "Could not refresh these files. Showing the previously read offline copy.")
          : (zh ? "无法读取本机接续文件，请重试。" : "Could not read continuation files from this device. Retry.")}</p>
      {retryButton}
    </div> : null}
    {content}
  </section>;
}
