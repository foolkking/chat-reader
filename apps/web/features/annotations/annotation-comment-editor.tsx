"use client";

import { useState } from "react";
import type { AnnotationRead } from "../../lib/types";

import type { CommentDraft } from "../../lib/annotation-comment-drafts";
export type { CommentDraft } from "../../lib/annotation-comment-drafts";

// The workspace owns draft lifetime across filters/close. Keystrokes only
// rerender this editor; a long annotation list need not rerender for each one.
export function AnnotationCommentEditor({ annotation, readDraft, focused, zh, loading = false, onChange, onSave, onDiscard, onCheck }: {
  annotation: AnnotationRead; readDraft: (id: string) => CommentDraft | undefined; focused: boolean; zh: boolean;
  loading?: boolean;
  onChange: (annotation: AnnotationRead, value: string) => void;
  onSave: (annotation: AnnotationRead, overwrite?: boolean, automatic?: boolean) => Promise<void>;
  onDiscard: (annotation: AnnotationRead) => Promise<void>; onCheck: () => Promise<void>;
}) {
  const [, render] = useState(0);
  const draft = readDraft(annotation.id);
  const changed = draft && annotation.comment_markdown !== draft.base.comment_markdown && annotation.comment_markdown !== draft.text;
  return <div className="mt-2 space-y-2">
    <label className="block space-y-1 text-xs text-secondary"><span>{zh ? "评论" : "Comment"}</span><textarea
      autoFocus={focused && annotation.annotation_type === "comment"} readOnly={loading} aria-busy={loading} value={draft?.text ?? annotation.comment_markdown}
      onChange={event => { onChange(annotation, event.target.value); render(value => value + 1); }}
      onBlur={event => { if (!(event.relatedTarget as HTMLElement | null)?.closest?.("[data-comment-actions]")) void onSave(annotation, false, true); }}
      className="min-h-20 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm text-primary outline-none focus:border-[var(--accent)]"
      placeholder={zh ? "Markdown 评论" : "Markdown comment"} /></label>
    {draft?.status === "saving" ? <p className="text-xs text-secondary" role="status">{zh ? "正在保存评论…" : "Saving comment…"}</p>
      : draft?.status === "error" ? <p className="text-xs text-[var(--danger)]" role="alert">{zh ? "评论保存未获确认，草稿已保留。可读取当前评论后再决定。" : "Comment save was not confirmed. Your draft is retained; check the current comment before deciding."}</p> : null}
    {draft ? <div data-comment-actions className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-secondary">{zh ? "未保存的评论" : "Unsaved comment"}</span>
      {changed ? <p className="w-full whitespace-pre-wrap break-words border-l-2 border-ui pl-2 text-secondary">{zh ? "当前评论已有更新：" : "The current comment has changed:"}{"\n"}{annotation.comment_markdown || (zh ? "（空评论）" : "(Empty comment)")}</p> : null}
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={draft.status === "saving"} onClick={() => void onSave(annotation, Boolean(changed))}>{changed ? (zh ? "应用此草稿" : "Apply this draft") : draft.status === "error" ? (zh ? "重试保存评论" : "Retry saving comment") : (zh ? "保存评论" : "Save comment")}</button>
      {draft.status === "error" || draft.status === "conflict" ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void onCheck()}>{zh ? "读取当前评论" : "Check current comment"}</button> : null}
      <button type="button" className="min-h-11 px-3 text-secondary underline" disabled={draft.status === "saving"} onClick={() => void onDiscard(annotation)}>{zh ? "放弃草稿" : "Discard draft"}</button>
    </div> : null}
  </div>;
}
