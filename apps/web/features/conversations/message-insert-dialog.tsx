"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { insertConversationMessages } from "../../lib/api";
import type { MessageInsertResponse, MessageListItem } from "../../lib/types";
import { useDialogFocus } from "../../components/use-dialog-focus";

export function MessageInsertDialog({
  open,
  conversationId,
  anchor,
  revision,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  conversationId: string;
  anchor: MessageListItem | null;
  revision?: number;
  onClose: () => void;
  onSubmitted: (result: MessageInsertResponse) => void;
}) {
  const [position, setPosition] = useState<"before" | "after">("after");
  const [mode, setMode] = useState<"single" | "pair">("single");
  const [role, setRole] = useState<"user" | "assistant">(anchor?.role === "user" ? "assistant" : "user");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ open, rootRef, onClose });
  const anchorMessage = anchor;
  if (!open || !anchorMessage) return null;
  const anchorMessageId = anchorMessage.id;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!first.trim() || (mode === "pair" && !second.trim())) return;
    setPending(true);
    setError(null);
    try {
      const result = await insertConversationMessages(conversationId, {
        anchor_message_id: anchorMessageId,
        position,
        mode,
        expected_offline_revision: revision,
        messages: mode === "pair"
          ? [{ role: "user", content_markdown: first }, { role: "assistant", content_markdown: second }]
          : [{ role, content_markdown: first }],
      });
      onSubmitted(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "插入消息失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[270] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="message-insert-title">
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={onClose} />
      <form onSubmit={submit} className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:rounded-2xl">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4"><div className="min-w-0 flex-1"><h2 id="message-insert-title" className="text-base font-semibold text-primary">插入消息</h2><p className="truncate text-xs text-secondary">相邻消息：{anchorMessage.role === "user" ? "User" : "Assistant"} · {anchorMessage.current_version?.plain_text?.slice(0, 80)}</p></div><button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="关闭"><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-primary">位置<select data-dialog-initial-focus="true" value={position} onChange={(event) => setPosition(event.target.value as "before" | "after")} className="mt-1.5 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm"><option value="before">插入到此消息之前</option><option value="after">插入到此消息之后</option></select></label><label className="text-sm font-medium text-primary">方式<select value={mode} onChange={(event) => setMode(event.target.value as "single" | "pair")} className="mt-1.5 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm"><option value="single">插入一条消息</option><option value="pair">插入 User + Assistant</option></select></label></div>
          {mode === "single" ? <label className="text-sm font-medium text-primary">身份<select value={role} onChange={(event) => setRole(event.target.value as "user" | "assistant")} className="mt-1.5 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm"><option value="user">User</option><option value="assistant">Assistant</option></select><textarea value={first} onChange={(event) => setFirst(event.target.value)} rows={8} className="mt-2 w-full resize-y rounded-xl border border-ui bg-page p-3 font-mono text-sm leading-6" placeholder="输入 Markdown 消息" /></label> : <div className="space-y-3"><label className="block text-sm font-medium text-primary">User<textarea value={first} onChange={(event) => setFirst(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-ui bg-page p-3 font-mono text-sm leading-6" /></label><label className="block text-sm font-medium text-primary">Assistant<textarea value={second} onChange={(event) => setSecond(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-ui bg-page p-3 font-mono text-sm leading-6" /></label></div>}
          {error ? <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-ui p-4"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-ui px-4 text-sm">取消</button><button type="submit" disabled={pending || !first.trim() || (mode === "pair" && !second.trim())} className="min-h-11 rounded-lg bg-[var(--text)] px-5 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{pending ? "正在插入…" : "插入消息"}</button></footer>
      </form>
    </div>
  );
}
