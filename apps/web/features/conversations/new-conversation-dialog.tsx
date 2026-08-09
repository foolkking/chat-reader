"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createConversation } from "../../lib/api";
import type { ProjectRead } from "../../lib/types";

export function NewConversationDialog({
  open,
  projects,
  initialProjectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projects: ProjectRead[];
  initialProjectId?: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [title, setTitle] = useState("新对话");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!userText.trim() || !assistantText.trim()) return;
    setPending(true);
    setError(null);
    try {
      const result = await createConversation({
        title: title.trim() || "新对话",
        project_id: projectId || null,
        messages: [
          { role: "user", content_markdown: userText },
          { role: "assistant", content_markdown: assistantText },
        ],
      });
      onCreated(result.conversation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新建对话失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onClose} />
      <form onSubmit={submit} className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:rounded-2xl">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <div className="min-w-0 flex-1"><h2 id="new-conversation-title" className="text-base font-semibold text-primary">新建对话</h2><p className="text-xs text-secondary">一次创建一条用户消息和一条助手消息</p></div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="text-sm font-medium text-primary">标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} className="mt-1.5 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm outline-none focus:border-[var(--accent)]" /></label>
            <label className="text-sm font-medium text-primary">项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm outline-none focus:border-[var(--accent)]"><option value="">未分类</option>{projects.filter((project) => !project.is_default && !project.is_archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          </div>
          <label className="block text-sm font-medium text-primary"><span className="inline-flex rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs text-accent">User</span><textarea value={userText} onChange={(event) => setUserText(event.target.value)} rows={7} placeholder="输入用户消息（支持 Markdown）" className="mt-2 w-full resize-y rounded-xl border border-ui bg-page p-3 font-mono text-sm leading-6 outline-none focus:border-[var(--accent)]" /></label>
          <label className="block text-sm font-medium text-primary"><span className="inline-flex rounded-full bg-[var(--text)] px-2 py-1 text-xs text-[var(--surface)]">Assistant</span><textarea value={assistantText} onChange={(event) => setAssistantText(event.target.value)} rows={7} placeholder="输入助手消息（支持 Markdown）" className="mt-2 w-full resize-y rounded-xl border border-ui bg-page p-3 font-mono text-sm leading-6 outline-none focus:border-[var(--accent)]" /></label>
          {error ? <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-ui p-4"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-ui px-4 text-sm font-medium text-primary hover:bg-subtle">取消</button><button type="submit" disabled={pending || !userText.trim() || !assistantText.trim()} className="min-h-11 rounded-lg bg-[var(--text)] px-5 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{pending ? "正在创建…" : "创建并打开"}</button></footer>
      </form>
    </div>
  );
}
