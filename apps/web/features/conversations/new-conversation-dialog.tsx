"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Folder, Loader2, MessageSquarePlus, User, X } from "lucide-react";
import { ApiRequestError, createConversation } from "../../lib/api";
import type { ConversationCreateResponse, ProjectRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useUnsavedClose } from "../../components/use-unsaved-close";
import { useDialogFocus } from "../../components/use-dialog-focus";

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
  onCreated: (result: ConversationCreateResponse) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const defaultTitle = zh ? "新对话" : "New conversation";
  const initialTitle = useRef(defaultTitle);
  const submitting = useRef(false);
  const [title, setTitle] = useState(defaultTitle);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestClose = useUnsavedClose({ dirty: Boolean(userText || assistantText || title !== initialTitle.current || projectId !== (initialProjectId ?? "")), busy: pending, onClose });
  useDialogFocus({ open, rootRef, onClose: requestClose });

  useEffect(() => {
    if (!open) return;
    initialTitle.current = defaultTitle;
    setTitle(defaultTitle);
    setProjectId(initialProjectId ?? "");
    setUserText("");
    setAssistantText("");
    setError(null);
  // Opening starts a new draft; preference refreshes must not erase it.
  }, [initialProjectId, open]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !userText.trim() || !assistantText.trim()) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createConversation({
        title: title.trim() || defaultTitle,
        project_id: projectId || null,
        messages: [
          { role: "user", content_markdown: userText },
          { role: "assistant", content_markdown: assistantText },
        ],
      });
      onCreated(result);
    } catch (cause) {
      setError(newConversationError(cause, zh));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conversation-title"
      data-testid="new-conversation-dialog"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLFormElement>("form")?.requestSubmit();
        }
      }}
    >
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => void requestClose()} />
      <form onSubmit={submit} className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-lg border border-ui bg-raised shadow-2xl sm:rounded-lg">
        <header className="flex min-h-16 items-center gap-3 border-b border-ui px-4 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent" aria-hidden="true"><MessageSquarePlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="new-conversation-title" className="text-base font-semibold text-primary">{zh ? "新建对话" : "New conversation"}</h2>
            <p className="text-xs text-secondary">User → Assistant</p>
          </div>
          <button type="button" onClick={() => void requestClose()} className="flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" disabled={pending} aria-label={zh ? "关闭新建对话" : "Close new conversation"} title={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 overflow-y-auto"><fieldset disabled={pending} className="min-w-0 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_18rem]">
            <label className="text-xs font-medium text-secondary">
              {zh ? "对话标题" : "Conversation title"}
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} className="mt-1.5 h-11 w-full rounded-md border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]" />
            </label>
            <label className="text-xs font-medium text-secondary">
              <span className="inline-flex items-center gap-1"><Folder className="h-3.5 w-3.5" />{zh ? "归属项目" : "Project"}</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)]">
                <option value="">{zh ? "未分类" : "Unclassified"}</option>
                {projects.filter((project) => !project.is_default && !project.is_archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2" aria-label={zh ? "初始对话消息" : "Initial messages"}>
            <MessageComposer
              role="User"
              icon={<User className="h-4 w-4" />}
              value={userText}
              onChange={setUserText}
              placeholder={zh ? "输入第一条用户消息…" : "Enter the first user message…"}
              autoFocus
            />
            <MessageComposer
              role="Assistant"
              icon={<Bot className="h-4 w-4" />}
              value={assistantText}
              onChange={setAssistantText}
              placeholder={zh ? "输入第一条助手消息…" : "Enter the first assistant message…"}
            />
          </div>
          {error ? <p role="alert" className="mt-3 rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        </fieldset></div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ui px-4 py-3 sm:px-5">
          <span className="mr-auto hidden text-xs text-secondary sm:block">{zh ? "Ctrl / ⌘ + Enter 创建" : "Ctrl / ⌘ + Enter to create"}</span>
          <button type="button" onClick={() => void requestClose()} disabled={pending} className="min-h-11 rounded-md border border-ui px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{zh ? "取消" : "Cancel"}</button>
          <button type="submit" disabled={pending || !userText.trim() || !assistantText.trim()} className="inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-md bg-[var(--text)] px-5 text-sm font-medium text-[var(--surface)] disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />}
            {pending ? (zh ? "正在创建" : "Creating") : (zh ? "创建并打开" : "Create and open")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function newConversationError(cause: unknown, zh: boolean): string {
  if (cause instanceof ApiRequestError) {
    if (cause.status === 401) return zh ? "登录已过期，请重新登录后继续。" : "Your session expired. Sign in again to continue.";
    if (cause.status === 403) return zh ? "当前权限不允许新建对话。" : "Your current permissions do not allow creating a conversation.";
    if (cause.status === 404) return zh ? "所选项目已不存在，请重新选择后重试。" : "The selected project is no longer available. Choose another project and retry.";
    if (cause.status === 409) return zh ? "项目状态已发生变化，请重新加载后再创建。" : "The project changed elsewhere. Reload before creating the conversation.";
    if (cause.status === 413 || cause.status === 422) return zh ? "对话标题或初始消息不符合要求，请检查后重试；输入仍保留。" : "The title or initial messages are not valid. Check them and retry; your input is retained.";
    if (cause.status === 429) return zh ? "创建过于频繁，请稍后重试。" : "Too many create requests. Try again shortly.";
  }
  return zh
    ? "创建结果尚未确认。表单内容仍保留；请先返回对话列表检查是否已创建，再决定是否重试。"
    : "The creation result is not confirmed. Your form is retained; check the conversation list before deciding whether to retry.";
}

function MessageComposer({ role, icon, value, onChange, placeholder, autoFocus = false }: { role: "User" | "Assistant"; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  return (
    <label className="flex min-h-72 flex-col overflow-hidden rounded-md border border-ui bg-page focus-within:border-[var(--accent)]">
      <span className="flex min-h-11 items-center gap-2 border-b border-ui px-3 text-sm font-semibold text-primary">{icon}{role}<span className="ml-auto text-xs font-normal text-secondary">{value.length.toLocaleString()} {zh ? "字符" : "characters"}</span></span>
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
