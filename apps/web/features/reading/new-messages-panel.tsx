"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, captureNewMessageBaseline, getNewMessageChanges } from "../../lib/api";

export function NewMessagesPanel({ conversationId, onNavigate }: { conversationId: string; onNavigate: (messageId: string) => void }) {
  return <BaselinePanel key={conversationId} conversationId={conversationId} onNavigate={onNavigate} />;
}

function BaselinePanel({ conversationId, onNavigate }: { conversationId: string; onNavigate: (messageId: string) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const queryKey = ["new-message-changes", conversationId] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getNewMessageChanges(conversationId, signal),
  });
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  async function checkResult() {
    setChecking(true); setChecked(false); setCheckFailed(false);
    const result = await query.refetch();
    setChecking(false); setChecked(!result.isError); setCheckFailed(result.isError);
  }
  const baseline = useMutation({
    mutationFn: () => captureNewMessageBaseline(conversationId),
    onMutate: () => { setChecked(false); setCheckFailed(false); setConfirmedAt(null); },
    onSuccess: result => { setConfirmedAt(result.captured_at); void client.invalidateQueries({ queryKey }); },
  });
  const baselineError = baseline.isError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
    {baseline.error instanceof ApiRequestError && baseline.error.status === 413
      ? (zh ? "对话超过 100,000 条消息，暂不支持建立基线。" : "Baselines support up to 100,000 messages.")
      : (zh ? "刚才的保存结果未确认。核对只读取当前基线，不会再次提交。" : "The last save is unconfirmed. Checking only reads the current baseline; it never resubmits.")}
    <button type="button" disabled={checking} onClick={() => void checkResult()} className="ml-2 min-h-11 underline">{zh ? "检查刚才结果" : "Check last result"}</button>
    {checkFailed ? <span className="block">{zh ? "核对失败，保留未确认状态。" : "Check failed. The save remains unconfirmed."}</span> : null}
    {checked ? <span className="block">{zh ? "已读取当前基线；它可能来自刚才的操作或其他标签页，不能据时间认定保存成功。下方按钮会明确建立新快照，包含现在服务器上的消息。" : "Current baseline read. It may come from this operation or another tab; its time does not prove the last save succeeded. The button below creates a NEW snapshot of messages currently on the server."}</span> : null}
  </p> : null;
  const writeDisabled = baseline.isPending || checking || (baseline.isError && !checked);
  const captureLabel = baseline.isError
    ? (zh ? "明确建立新的服务器快照" : "Create a new server snapshot")
    : (zh ? "标记服务器当前正文为已看" : "Mark current server content as seen");
  const receipt = <p role="status" className="mt-2 text-xs text-secondary">
    {confirmedAt ? (zh ? `已确认保存：${confirmedAt}` : `Save confirmed: ${confirmedAt}`)
      : query.data?.baseline_captured_at ? (zh ? `当前基线时间：${query.data.baseline_captured_at}` : `Current baseline: ${query.data.baseline_captured_at}`)
        : (zh ? "当前没有已保存基线。" : "There is no saved baseline.")}
  </p>;
  if (query.isPending) return <p className="text-xs text-secondary">{zh ? "正在检查新增正文…" : "Checking for new content…"}</p>;
  if (query.isError) return <div className="text-xs text-[var(--danger)]"><p role="alert">{zh ? "暂时无法检查新增正文。" : "New content could not be checked right now."}<button type="button" disabled={checking} onClick={() => void checkResult()} className="ml-2 min-h-11 underline">{zh ? "重试核对" : "Retry check"}</button></p>{baselineError}</div>;
  const data = query.data;
  if (!data.baseline_available) {
    return (
      <div className="rounded-lg border border-ui bg-subtle p-3 text-sm">
        <p className="font-medium text-primary">{zh ? "还没有阅读基线" : "No reading baseline yet"}</p>
        <p className="mt-1 text-xs text-secondary">{zh ? "建立基线后，回来时只提示之后新增的消息。" : "Set a baseline to see only messages added after this visit."}</p>
        <button type="button" onClick={() => baseline.mutate()} disabled={writeDisabled} className="mt-2 min-h-11 rounded-md bg-[var(--text)] px-3 text-xs text-[var(--surface)] disabled:opacity-60">
          {baseline.isPending ? (zh ? "正在保存…" : "Saving…") : captureLabel}
        </button>
        {receipt}
        {baselineError}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ui bg-subtle p-3 text-sm">
      <div className="flex items-center gap-2">
        <p className="font-medium text-primary">{data.new_message_count ? (zh ? `新增 ${data.new_message_count} 条消息` : `${data.new_message_count} new messages`) : (zh ? "没有新增消息" : "No new messages")}</p>
        <button type="button" onClick={() => baseline.mutate()} disabled={writeDisabled} className="ml-auto min-h-11 rounded-md border border-ui px-2 text-xs text-secondary disabled:opacity-60">
          {captureLabel}
        </button>
      </div>
      {baselineError}
      {receipt}
      {data.has_more ? <p className="mt-2 text-xs text-secondary">{zh ? `这里只列出前 ${data.items.length} 条；跳转正文可继续阅读。` : `Showing the first ${data.items.length}; open the conversation to keep reading.`}</p> : null}
      {data.items.length ? <ul className="mt-2 grid gap-1 text-xs text-secondary">{data.items.map(item => <li key={item.message_id}>
        <button type="button" onClick={() => onNavigate(item.message_id)} className="min-h-9 w-full truncate rounded px-1 text-left hover:bg-surface">
          <span className="mr-2 text-primary">{item.role}</span>{item.preview || (zh ? "（无文本预览）" : "(no text preview)")}
        </button>
      </li>)}</ul> : null}
    </div>
  );
}
