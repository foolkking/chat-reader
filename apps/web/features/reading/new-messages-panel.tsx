"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, captureNewMessageBaseline, getNewMessageChanges } from "../../lib/api";

export function NewMessagesPanel({ conversationId, onNavigate }: { conversationId: string; onNavigate: (messageId: string) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const queryKey = ["new-message-changes", conversationId] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getNewMessageChanges(conversationId, signal),
  });
  const baseline = useMutation({
    mutationFn: () => captureNewMessageBaseline(conversationId),
    onSuccess: () => void client.invalidateQueries({ queryKey }),
  });
  const baselineError = baseline.isError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
    {baseline.error instanceof ApiRequestError && baseline.error.status === 413
      ? (zh ? "对话超过 100,000 条消息，暂不支持建立基线。" : "Baselines support up to 100,000 messages.")
      : (zh ? "保存结果未确认；请先重新检查，再决定是否重试。" : "Saving was not confirmed. Check the baseline before retrying.")}
    <button type="button" onClick={() => void query.refetch()} className="ml-2 min-h-9 underline">{zh ? "重新检查" : "Check again"}</button>
  </p> : null;
  if (query.isPending) return <p className="text-xs text-secondary">{zh ? "正在检查新增正文…" : "Checking for new content…"}</p>;
  if (query.isError) return <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "暂时无法检查新增正文。" : "New content could not be checked right now."}<button type="button" onClick={() => void query.refetch()} className="ml-2 min-h-9 underline">{zh ? "重试" : "Retry"}</button></p>;
  const data = query.data;
  if (!data.baseline_available) {
    return (
      <div className="rounded-lg border border-ui bg-subtle p-3 text-sm">
        <p className="font-medium text-primary">{zh ? "还没有阅读基线" : "No reading baseline yet"}</p>
        <p className="mt-1 text-xs text-secondary">{zh ? "建立基线后，回来时只提示之后新增的消息。" : "Set a baseline to see only messages added after this visit."}</p>
        <button type="button" onClick={() => baseline.mutate()} disabled={baseline.isPending} className="mt-2 min-h-9 rounded-md bg-[var(--text)] px-3 text-xs text-[var(--surface)] disabled:opacity-60">
          {baseline.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "标记当前正文为已看" : "Mark current content as seen")}
        </button>
        {baselineError}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ui bg-subtle p-3 text-sm">
      <div className="flex items-center gap-2">
        <p className="font-medium text-primary">{data.new_message_count ? (zh ? `新增 ${data.new_message_count} 条消息` : `${data.new_message_count} new messages`) : (zh ? "没有新增消息" : "No new messages")}</p>
        <button type="button" onClick={() => baseline.mutate()} disabled={baseline.isPending} className="ml-auto min-h-8 rounded-md border border-ui px-2 text-xs text-secondary disabled:opacity-60">
          {zh ? "更新基线" : "Update baseline"}
        </button>
      </div>
      {baselineError}
      {data.has_more ? <p className="mt-2 text-xs text-secondary">{zh ? `这里只列出前 ${data.items.length} 条；跳转正文可继续阅读。` : `Showing the first ${data.items.length}; open the conversation to keep reading.`}</p> : null}
      {data.items.length ? <ul className="mt-2 grid gap-1 text-xs text-secondary">{data.items.map(item => <li key={item.message_id}>
        <button type="button" onClick={() => onNavigate(item.message_id)} className="min-h-9 w-full truncate rounded px-1 text-left hover:bg-surface">
          <span className="mr-2 text-primary">{item.role}</span>{item.preview || (zh ? "（无文本预览）" : "(no text preview)")}
        </button>
      </li>)}</ul> : null}
    </div>
  );
}
