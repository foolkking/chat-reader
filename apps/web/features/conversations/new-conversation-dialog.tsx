"use client";

import { useEffect, useState } from "react";
import { Bot, Folder, Loader2, MessageSquarePlus, User, X } from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    setTitle("新对话");
    setProjectId(initialProjectId ?? "");
    setUserText("");
    setAssistantText("");
    setError(null);
  }, [initialProjectId, open]);

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
          { role: "user", content_markdown: userText.trim() },
          { role: "assistant", content_markdown: assistantText.trim() },
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
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conversation-title"
      data-testid="new-conversation-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onClose();
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLFormElement>("form")?.requestSubmit();
        }
      }}
    >
      <button type="button" className="absolute inset-0" aria-label="关闭新建对话" onClick={onClose} />
      <form onSubmit={submit} className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-lg border border-ui bg-raised shadow-2xl sm:rounded-lg">
        <header className="flex min-h-16 items-center gap-3 border-b border-ui px-4 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent" aria-hidden="true"><MessageSquarePlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="new-conversation-title" className="text-base font-semibold text-primary">新建对话</h2>
            <p className="text-xs text-secondary">User → Assistant</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="关闭新建对话" title="关闭"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_18rem]">
            <label className="text-xs font-medium text-secondary">
              对话标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} className="mt-1.5 h-11 w-full rounded-md border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]" />
            </label>
            <label className="text-xs font-medium text-secondary">
              <span className="inline-flex items-center gap-1"><Folder className="h-3.5 w-3.5" />归属项目</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]">
                <option value="">未分类</option>
                {projects.filter((project) => !project.is_default && !project.is_archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2" aria-label="初始对话消息">
            <MessageComposer
              role="User"
              icon={<User className="h-4 w-4" />}
              value={userText}
              onChange={setUserText}
              placeholder="输入第一条用户消息…"
              autoFocus
            />
            <MessageComposer
              role="Assistant"
              icon={<Bot className="h-4 w-4" />}
              value={assistantText}
              onChange={setAssistantText}
              placeholder="输入第一条助手消息…"
            />
          </div>
          {error ? <p role="alert" className="mt-3 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ui px-4 py-3 sm:px-5">
          <span className="mr-auto hidden text-xs text-secondary sm:block">Ctrl / ⌘ + Enter 创建</span>
          <button type="button" onClick={onClose} disabled={pending} className="min-h-11 rounded-md border border-ui px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">取消</button>
          <button type="submit" disabled={pending || !userText.trim() || !assistantText.trim()} className="inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-md bg-[var(--text)] px-5 text-sm font-medium text-[var(--surface)] disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />}
            {pending ? "正在创建" : "创建并打开"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function MessageComposer({ role, icon, value, onChange, placeholder, autoFocus = false }: { role: "User" | "Assistant"; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="flex min-h-72 flex-col overflow-hidden rounded-md border border-ui bg-page focus-within:border-[var(--accent)]">
      <span className="flex min-h-11 items-center gap-2 border-b border-ui px-3 text-sm font-semibold text-primary">{icon}{role}<span className="ml-auto text-xs font-normal text-secondary">{value.length.toLocaleString()} 字符</span></span>
      <textarea
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-60 flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-6 text-primary outline-none placeholder:text-secondary"
      />
    </label>
  );
}
