"use client";

import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { ApiRequestError, getConversation, updateConversation } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { ConversationDetail, ConversationListItem, ConversationUpdateInput, RecentItemRead } from "../../lib/types";

type MetadataField = "title" | "description";
type Phase = "editing" | "saving" | "unknown" | "checking" | "different" | "unavailable" | "confirmed";

function fieldValue(conversation: ConversationListItem, field: MetadataField): string {
  return field === "title" ? conversation.display_title || conversation.title : conversation.description_markdown ?? "";
}

function matchesField(conversation: ConversationListItem, field: MetadataField, value: string | null): boolean {
  return field === "title"
    ? conversation.title === value && conversation.display_title === value
    : (conversation.description_markdown ?? "") === value;
}

/** Mounted for one conversation/field; background refreshes never replace its draft. */
export function ConversationMetadataDialog({ conversation, field, onClose, onAccepted, onChanged, restoreFocus }: {
  conversation: ConversationListItem;
  field: MetadataField;
  onClose: () => void;
  onAccepted: (message: string) => void;
  onChanged?: () => Promise<void> | void;
  restoreFocus: () => HTMLElement | null;
}) {
  const client = useQueryClient();
  const dialog = useInteractionDialog();
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [draft, setDraft] = useState(() => fieldValue(conversation, field));
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const base = useRef(conversation);
  const comparison = useRef<ConversationDetail | null>(null);
  const draftRef = useRef(draft);
  const phaseRef = useRef<Phase>("editing");
  const asking = useRef(false);
  const mounted = useRef(true);
  const session = useRef({ id: conversation.id, field, epoch: authenticationGeneration() });
  const latestScope = useRef({ id: conversation.id, field });
  latestScope.current = { id: conversation.id, field };
  const submitted = useRef<string | null>(null);
  const hadUnknownWrite = useRef(false);
  const checkController = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const inputId = useId();
  const title = field === "title" ? (zh ? "重命名对话" : "Rename conversation") : (zh ? "编辑简介" : "Edit description");
  const length = Array.from(draft.trim()).length;
  const lengthError = field === "description" && length > 500
    ? (zh ? "简介最多 500 个字符，请缩短后保存。草稿未被截断。" : "Use 500 characters or fewer. Shorten the description to save; your draft has not been cut.")
    : null;
  const busy = phase === "saving" || phase === "checking";
  const locked = phase !== "editing" || confirming;
  const isCurrent = () => mounted.current
    && session.current.epoch === authenticationGeneration()
    && session.current.id === latestScope.current.id && session.current.field === latestScope.current.field;
  const transition = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; checkController.current?.abort(); };
  }, []);

  async function requestClose() {
    if (!isCurrent() || asking.current || ["saving", "checking", "confirmed"].includes(phaseRef.current)) return;
    if (draftRef.current === fieldValue(base.current, field) && !hadUnknownWrite.current) { transition("confirmed"); onClose(); return; }
    asking.current = true;
    setConfirming(true);
    try {
      const discard = await dialog.confirm({
        title: hadUnknownWrite.current ? (zh ? "关闭未确认的编辑？" : "Close this unconfirmed edit?")
          : (zh ? "放弃未保存的修改？" : "Discard unsaved changes?"),
        description: hadUnknownWrite.current
          ? (zh ? "关闭会丢弃本次草稿和核对状态，但不会取消或撤销服务器上的保存。"
            : "Closing discards this draft and check state. It does not cancel or undo the save on the server.")
          : (zh ? "关闭后，这次输入的内容将丢失。" : "Closing will discard what you entered."),
        confirmLabel: zh ? "关闭并丢弃草稿" : "Close and discard draft",
        danger: true,
      });
      if (discard && isCurrent()) { transition("confirmed"); onClose(); }
    } finally {
      asking.current = false;
      if (isCurrent()) setConfirming(false);
    }
  }

  useDialogFocus({ open: true, rootRef, initialFocusRef: inputRef, onClose: () => void requestClose(), restoreFocus });

  function accept(saved: ConversationDetail, checked = false) {
    if (!isCurrent()) return;
    if (saved.id !== conversation.id) {
      hadUnknownWrite.current = true;
      transition("unknown");
      setError(zh ? "返回内容与此对话不符，无法确认保存结果。请核对当前内容。" : "The response did not match this conversation. Check the current value before continuing.");
      return;
    }
    transition("confirmed");
    const filters = [
      { queryKey: ["conversation", "remote", conversation.id], exact: true },
      { queryKey: ["conversations"] },
      { queryKey: ["project-conversations"] },
      { queryKey: ["recent-items"] },
    ];
    // Cancellation is synchronous inside Query; late pre-save reads must not
    // overwrite the acknowledged value. No missing cache/record is manufactured.
    for (const filter of filters) void client.cancelQueries(filter).catch(() => undefined);
    const update = <T extends ConversationListItem>(item: T): T => {
      if (item.id !== saved.id || item.offline_revision > saved.offline_revision) return item;
      return { ...item, title: saved.title, display_title: saved.display_title,
        description_markdown: saved.description_markdown, updated_at: saved.updated_at, offline_revision: saved.offline_revision };
    };
    client.setQueryData<ConversationDetail>(filters[0].queryKey, item => item ? update(item) : item);
    for (const queryKey of [["conversations"], ["project-conversations"]]) {
      client.setQueriesData<ConversationListItem[]>({ queryKey }, items => Array.isArray(items) ? items.map(update) : items);
    }
    client.setQueriesData<RecentItemRead[]>({ queryKey: ["recent-items"] }, items => (
      Array.isArray(items) ? items.map(item => ({ ...item, conversation: update(item.conversation) })) : items
    ));
    onAccepted(checked
      ? (zh ? "已采用服务器当前内容。" : "Current server value confirmed.")
      : (field === "title" ? (zh ? "对话标题已保存。" : "Conversation title saved.")
        : (zh ? "简介已保存。" : "Description saved.")));
    onClose();
    // Completion is independent of refresh. The existing list owner handles its
    // normal scope; exact Reader/recent/project copies also need a fresh read.
    for (const filter of filters.filter(item => !onChanged || item.queryKey[0] !== "conversations")) {
      void client.invalidateQueries(filter).catch(() => undefined);
    }
    if (onChanged) void Promise.resolve().then(() => {
      if (session.current.epoch === authenticationGeneration()) return onChanged();
    }).catch(() => undefined);
  }

  async function save() {
    if (!isCurrent() || asking.current || phaseRef.current !== "editing") return;
    const value = draftRef.current.trim();
    if (field === "title" && !value) {
      setError(zh ? "对话标题不能为空。" : "Conversation title cannot be empty.");
      inputRef.current?.focus();
      return;
    }
    if (field === "description" && Array.from(value).length > 500) {
      inputRef.current?.focus();
      return;
    }
    // Initial untouched editors are no-ops. After an unknown write and explicit
    // comparison, both title fields must match before dropping a reviewed save.
    if (value === fieldValue(base.current, field).trim()
      && (!hadUnknownWrite.current || matchesField(base.current, field, value))) {
      transition("confirmed"); onClose(); return;
    }
    const patch: ConversationUpdateInput = field === "title"
      ? { title: value, display_title: value } : { description_markdown: value || null };
    submitted.current = value;
    transition("saving");
    setError(null);
    let saved: ConversationDetail;
    try {
      // An aborted client request can still commit on the server; any timeout
      // therefore enters read-only checking, never automatic PATCH replay.
      saved = await updateConversation(conversation.id, patch, AbortSignal.timeout(15_000));
    } catch (failure) {
      if (!isCurrent()) return;
      if (failure instanceof ApiRequestError && [400, 422].includes(failure.status)) {
        transition("editing");
        setError(zh ? "服务器未接受这次修改，草稿仍保留。请检查内容后保存。" : "The server did not accept this edit. Your draft is kept; review it before saving.");
      } else {
        hadUnknownWrite.current = true;
        transition(failure instanceof ApiRequestError && [401, 403, 404].includes(failure.status) ? "unavailable" : "unknown");
        setError(zh ? "暂时无法确认保存结果。草稿仍保留，请先核对当前内容。" : "The save could not be confirmed. Your draft is kept; check the current value first.");
      }
      return;
    }
    accept(saved);
  }

  async function check() {
    if (!isCurrent() || asking.current || !["unknown", "different", "unavailable"].includes(phaseRef.current)) return;
    comparison.current = null;
    transition("checking");
    setCurrent(null);
    setError(null);
    const controller = new AbortController();
    checkController.current = controller;
    let saved: ConversationDetail;
    try {
      saved = await getConversation(conversation.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (saved.id !== conversation.id) throw new Error("Unexpected conversation response");
    } catch (failure) {
      if (!isCurrent()) return;
      transition(failure instanceof ApiRequestError && [401, 403, 404].includes(failure.status) ? "unavailable" : "unknown");
      setError(zh ? "当前内容核对失败。草稿仍保留；恢复连接或访问权限后再核对。" : "Could not check the current value. Your draft is kept; check again when connection or access is restored.");
      return;
    } finally {
      if (checkController.current === controller) checkController.current = null;
    }
    if (!isCurrent()) return;
    if (matchesField(saved, field, submitted.current)) { accept(saved, true); return; }
    comparison.current = saved;
    setCurrent(saved);
    transition("different");
  }

  function keepDraft() {
    if (!isCurrent() || asking.current || phaseRef.current !== "different" || !current || current !== comparison.current) return;
    base.current = current;
    comparison.current = null;
    submitted.current = null;
    setCurrent(null);
    setError(null);
    transition("editing");
    inputRef.current?.focus();
  }

  function change(value: string) {
    if (!isCurrent() || asking.current || phaseRef.current !== "editing") return;
    draftRef.current = value;
    setDraft(value);
    setError(null);
  }

  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby={inputId + "-title"} onPointerDown={event => event.stopPropagation()}>
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => void requestClose()} />
      <form ref={rootRef} tabIndex={-1} noValidate
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:max-w-lg sm:rounded-xl"
        onSubmit={event => { event.preventDefault(); void save(); }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ui px-5 py-3">
          <h2 id={inputId + "-title"} className="text-lg font-semibold text-primary">{title}</h2>
          <button type="button" disabled={busy || confirming} onClick={() => void requestClose()} aria-label={zh ? "关闭" : "Close"}
            className="btn-ghost flex min-h-11 min-w-11 items-center justify-center disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div>
            <label htmlFor={inputId} className="block text-sm font-medium text-primary">
              {field === "title" ? (zh ? "对话标题" : "Conversation title") : (zh ? "Markdown 简介（可选）" : "Markdown description (optional)")}
            </label>
            {field === "description" ? <textarea id={inputId} ref={inputRef as RefObject<HTMLTextAreaElement | null>}
              rows={5} value={draft} readOnly={locked} onChange={event => change(event.target.value)}
              aria-invalid={Boolean(lengthError)} aria-describedby={inputId + "-help" + (lengthError || error ? " " + inputId + "-error" : "")}
              className="mt-2 block w-full resize-y rounded-lg border border-ui bg-surface px-3 py-2 text-base text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] sm:text-sm" />
              : <input id={inputId} ref={inputRef as RefObject<HTMLInputElement | null>} value={draft} readOnly={locked} required
                onChange={event => change(event.target.value)} aria-invalid={Boolean(error && phase === "editing")}
                aria-describedby={error ? inputId + "-error" : undefined}
                className="mt-2 h-11 w-full rounded-lg border border-ui bg-surface px-3 text-base text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] sm:text-sm" />}
            {field === "description" ? <p id={inputId + "-help"} className="mt-2 text-xs leading-5 text-secondary">
              {zh ? "清空后保存即可移除简介。按 Unicode 字符计数，组合表情可能占多个字符。" : "Clear and save to remove it. Counts Unicode characters; combined emoji may count as more than one."}
              <span className="ml-2 tabular-nums">{length} / 500</span>
            </p> : null}
            {lengthError || error ? <p id={inputId + "-error"} role="alert" className="mt-2 text-sm text-[var(--danger)]">{lengthError || error}</p> : null}
          </div>
          {phase === "different" && current ? <div className="space-y-3 border-t border-ui pt-4">
            <p role="status" className="text-sm text-secondary">{zh
              ? "服务器当前内容与草稿不同。核对不能证明之前的请求没有写入；请比较后再决定。"
              : "The current value differs from your draft. This check cannot prove the earlier save never happened. Compare before deciding."}</p>
            <div><h3 className="text-sm font-medium text-primary">{zh ? "服务器当前内容" : "Current server value"}</h3>
              <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ui bg-surface p-3 text-sm text-primary">
                {field === "title" && current.title !== current.display_title ? <dl className="space-y-3">
                  <div><dt className="text-xs text-secondary">{zh ? "已存标题" : "Saved title"}</dt><dd className="mt-1">{current.title}</dd></div>
                  <div><dt className="text-xs text-secondary">{zh ? "显示标题" : "Display title"}</dt><dd className="mt-1">
                    {current.display_title || (zh ? "（未单独设置，使用已存标题）" : "(not set; uses saved title)")}</dd></div>
                </dl> : <p>{fieldValue(current, field) || (zh ? "（空）" : "(empty)")}</p>}
              </div>
              {field === "title" && current.title !== current.display_title ? <p className="mt-2 text-sm text-secondary">
                {zh ? "再次保存会将两个标题都设为草稿内容。" : "Saving again sets both titles to your draft."}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={confirming} className="btn-secondary min-h-11 px-3 text-sm" onClick={keepDraft}>{zh ? "保留草稿继续编辑" : "Continue editing draft"}</button>
              <button type="button" disabled={confirming} className="btn-secondary min-h-11 px-3 text-sm"
                onClick={() => { if (isCurrent() && !asking.current && phaseRef.current === "different" && current === comparison.current) accept(current, true); }}>{zh ? "采用当前内容" : "Use current value"}</button>
            </div>
          </div> : null}
          {phase === "unavailable" ? <p className="text-sm text-secondary">{zh ? "此对话可能已不可用，或当前没有访问权限。不会自动重试保存。" : "This conversation may be unavailable or access may have changed. Saving will not be retried automatically."}</p> : null}
          {busy ? <p role="status" className="text-sm text-secondary">{phase === "saving" ? (zh ? "正在保存…" : "Saving…") : (zh ? "正在核对当前内容…" : "Checking current value…")}</p> : null}
          {phase === "editing" && hadUnknownWrite.current ? <p className="text-sm text-secondary">{zh ? "草稿已保留。再次保存将替换服务器上的此项内容。" : "Your draft is kept. Saving again replaces this field on the server."}</p> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ui px-5 py-3">
          <button type="button" disabled={busy || confirming} onClick={() => void requestClose()} className="btn-secondary min-h-11 px-4 text-sm disabled:opacity-50">{zh ? "取消" : "Cancel"}</button>
          {["unknown", "different", "unavailable", "checking"].includes(phase)
            ? <button type="button" disabled={busy || confirming} onClick={() => void check()} className="btn-primary min-h-11 px-4 text-sm disabled:opacity-50">{zh ? "核对当前内容" : "Check current value"}</button>
            : <button type="submit" disabled={busy || confirming} className="btn-primary min-h-11 px-4 text-sm disabled:opacity-50">{busy ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存" : "Save")}</button>}
        </footer>
      </form>
    </div>,
    document.body,
  );
}
