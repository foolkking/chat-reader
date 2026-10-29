"use client";

import { CheckSquare2, LoaderCircle, Scissors, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, executeConversationSplit, getConversationDialogueIndex, previewConversationSplit } from "../../lib/api";
import type { ConversationSplitMode, ConversationSplitWorkspaceInput, ConversationSplitWorkspacePreview, ConversationSplitWorkspaceResponse, DialogueIndexItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";

const modes: Array<{ id: ConversationSplitMode; zh: string; en: string }> = [
  { id: "range_copy", zh: "连续区间", en: "Range" },
  { id: "boundary_copy", zh: "边界双份", en: "Boundary" },
  { id: "discrete_copy", zh: "离散消息", en: "Discrete" },
];

type SplitAttempt = {
  conversationId: string;
  key: string;
  request: ConversationSplitWorkspaceInput;
  preview: ConversationSplitWorkspacePreview;
};

export function ConversationSplitWorkspace({ open, conversationId, conversationTitle, selectedMessageIds, onClose, onCompleted, restoreFocus }: {
  open: boolean;
  conversationId: string;
  conversationTitle: string;
  selectedMessageIds: string[];
  onClose: () => void;
  onCompleted: (response: ConversationSplitWorkspaceResponse) => Promise<void> | void;
  restoreFocus?: () => HTMLElement | null;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [items, setItems] = useState<DialogueIndexItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ConversationSplitMode>("range_copy");
  const [startId, setStartId] = useState("");
  const [endId, setEndId] = useState("");
  const [boundaryId, setBoundaryId] = useState("");
  const [discreteIds, setDiscreteIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ConversationSplitWorkspacePreview | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [result, setResult] = useState<ConversationSplitWorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mounted = useRef(true);
  const scope = useRef(0);
  const operation = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedIdsRef = useRef(selectedMessageIds);
  selectedIdsRef.current = selectedMessageIds;
  const localeRef = useRef(zh);
  localeRef.current = zh;
  const generation = useRef(authenticationGeneration());
  const pendingAttemptsRef = useRef(new Map<string, SplitAttempt>());
  const [pendingAttempt, setPendingAttempt] = useState<SplitAttempt | null>(null);
  useDialogFocus({ open, rootRef, initialFocusRef: closeButtonRef, onClose: close, restoreFocus });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scope.current += 1;
      operation.current += 1;
    };
  }, []);
  useEffect(() => {
    const retireForIdentityChange = () => {
      scope.current++;
      operation.current++;
      pendingAttemptsRef.current.clear();
      setPendingAttempt(null);
      setResult(null);
      setBusy(false);
      onClose();
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, retireForIdentityChange);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, retireForIdentityChange);
  }, [onClose]);

  useEffect(() => {
    const currentScope = ++scope.current;
    generation.current = authenticationGeneration();
    operation.current += 1;
    setLoading(false);
    setBusy(false);
    setItems([]);
    setStartId("");
    setEndId("");
    setBoundaryId("");
    setDiscreteIds(new Set());
    setPreview(null);
    setResult(null);
    setTitles([]);
    const currentAttempt = pendingAttemptsRef.current.get(conversationId) ?? null;
    setPendingAttempt(currentAttempt);
    if (currentAttempt) {
      setMode(currentAttempt.request.mode);
      setStartId(currentAttempt.request.startMessageId ?? "");
      setEndId(currentAttempt.request.endMessageId ?? "");
      setBoundaryId(currentAttempt.request.boundaryMessageId ?? "");
      setDiscreteIds(new Set(currentAttempt.request.messageIds ?? []));
      setTitles(currentAttempt.request.titles ?? []);
      setPreview(currentAttempt.preview);
    }
    setError(currentAttempt
      ? (localeRef.current ? "上次拆分结果未确认。可以安全重试同一请求；不要改计划或新建另一笔拆分。" : "The previous split is unconfirmed. Safely retry the same request; do not change the plan or start another split.")
      : null);
    setLoadError(false);
    if (!open) return;
    const selectedOnOpen = [...selectedIdsRef.current];
    setLoading(true);
    void loadDialogueIndex(conversationId).then((nextItems) => {
      if (!isCurrentScope(currentScope)) return;
      setItems(nextItems);
      if (currentAttempt) return;
      const selected = nextItems.filter((item) => selectedOnOpen.includes(item.message_id));
      setStartId(selected[0]?.message_id ?? nextItems[0]?.message_id ?? "");
      setEndId(selected[selected.length - 1]?.message_id ?? nextItems[nextItems.length - 1]?.message_id ?? "");
      setBoundaryId(selected[selected.length - 1]?.message_id ?? nextItems[Math.max(0, Math.floor(nextItems.length / 2) - 1)]?.message_id ?? "");
      setDiscreteIds(new Set(selected.map((item) => item.message_id)));
    }).catch((reason) => {
      if (isCurrentScope(currentScope)) {
        setLoadError(true);
        setError(splitErrorMessage(reason, localeRef.current, "load"));
      }
    }).finally(() => {
      if (isCurrentScope(currentScope)) setLoading(false);
    });
    return () => {
      if (scope.current === currentScope) {
        scope.current += 1;
        operation.current += 1;
      }
    };
  }, [conversationId, loadAttempt, open]);

  function isCurrentScope(currentScope: number, currentOperation?: number) {
    return mounted.current && generation.current === authenticationGeneration()
      && scope.current === currentScope && (currentOperation === undefined || operation.current === currentOperation);
  }

  function retireOperation() {
    operation.current += 1;
    setBusy(false);
  }

  function close() {
    scope.current += 1;
    operation.current += 1;
    setBusy(false);
    onClose();
  }

  function retryLoad() {
    if (loading || busy) return;
    setLoadAttempt((attempt) => attempt + 1);
  }

  const indexById = useMemo(() => new Map(items.map((item, index) => [item.message_id, index])), [items]);
  const includedIds = useMemo(() => {
    if (mode === "discrete_copy") return discreteIds;
    if (mode === "boundary_copy") return new Set(items.map((item) => item.message_id));
    const start = indexById.get(startId);
    const end = indexById.get(endId);
    if (start === undefined || end === undefined || end < start) return new Set<string>();
    return new Set(items.slice(start, end + 1).map((item) => item.message_id));
  }, [boundaryId, discreteIds, endId, indexById, items, mode, startId]);

  if (!open) return null;

  function input(): ConversationSplitWorkspaceInput {
    if (mode === "range_copy") return { mode, startMessageId: startId, endMessageId: endId, titles };
    if (mode === "boundary_copy") return { mode, boundaryMessageId: boundaryId, titles };
    return { mode, messageIds: items.filter((item) => discreteIds.has(item.message_id)).map((item) => item.message_id), titles };
  }

  function changeMode(nextMode: ConversationSplitMode) {
    if (busy || loading || activePendingAttempt) return;
    retireOperation();
    setMode(nextMode);
    setPreview(null);
    setResult(null);
    setTitles([]);
    setError(null);
  }

  async function requestPreview() {
    if (busy || loading || loadError || invalid || activePendingAttempt) return;
    const currentScope = scope.current;
    const currentOperation = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await previewConversationSplit(conversationId, input());
      if (!isCurrentScope(currentScope, currentOperation)) return;
      setPreview(next);
      setTitles(next.groups.map((group) => group.suggested_title));
    } catch (reason) {
      if (!isCurrentScope(currentScope, currentOperation)) return;
      setError(splitErrorMessage(reason, zh, "preview"));
    } finally {
      if (isCurrentScope(currentScope, currentOperation)) setBusy(false);
    }
  }

  async function execute() {
    if (busy || loading || result !== null) return;
    const existing = pendingAttemptsRef.current.get(conversationId);
    if (loadError && !existing) return;
    if (!existing && !preview) return;
    const currentScope = scope.current;
    const currentOperation = ++operation.current;
    const attempt = existing?.conversationId === conversationId
      ? existing
      : { conversationId, key: crypto.randomUUID(), request: input(), preview: preview! };
    pendingAttemptsRef.current.set(conversationId, attempt);
    setPendingAttempt(attempt);
    setBusy(true);
    setError(null);
    try {
      const response = await executeConversationSplit(conversationId, attempt.request, attempt.key);
      if (!isCurrentScope(currentScope, currentOperation)) return;
      pendingAttemptsRef.current.delete(conversationId);
      setPendingAttempt(null);
      setResult(response);
      try {
        await onCompleted(response);
        if (!isCurrentScope(currentScope, currentOperation)) return;
      } catch {
        if (isCurrentScope(currentScope, currentOperation)) {
          setError(zh
            ? "拆分已完成，但对话列表未能刷新。新对话链接仍然有效，请稍后刷新列表。"
            : "The split completed, but the conversation list could not refresh. The new links are still valid; refresh the list later.");
        }
      }
    } catch (reason) {
      if (isCurrentScope(currentScope, currentOperation)) {
        const definiteRejection = reason instanceof ApiRequestError
          && reason.status >= 400 && reason.status < 500 && reason.status !== 408
          && reason.code !== "SPLIT_IDEMPOTENCY_CONFLICT";
        if (definiteRejection && !existing) {
          pendingAttemptsRef.current.delete(conversationId);
          setPendingAttempt(null);
          setError(splitErrorMessage(reason, zh, "execute"));
        } else if (definiteRejection) {
          // A rejection of a later retry cannot prove the original request
          // failed (access or API version may have changed after its commit).
          setError(zh
            ? "本次重试未被接受，但原拆分结果仍未确认。原计划和回执键已保留；请恢复访问或服务后安全重试，不要新建另一笔。"
            : "This retry was rejected, but the original split is still unconfirmed. Its plan and receipt key are retained. Restore access or service compatibility before safely retrying; do not start another split.");
        } else {
          setError(zh
            ? "拆分结果尚未确认。使用下面的“安全重试同一次拆分”会复用同一回执键和完全相同的请求，不会重复创建。"
            : "The split result is unconfirmed. “Retry the same split safely” reuses the same receipt key and exact request, preventing duplicate creation.");
        }
      }
    } finally {
      if (isCurrentScope(currentScope, currentOperation)) setBusy(false);
    }
  }

  const startIndex = indexById.get(startId);
  const endIndex = indexById.get(endId);
  const reversedRange = mode === "range_copy" && startIndex !== undefined && endIndex !== undefined && endIndex < startIndex;
  const invalid = mode === "range_copy" ? !startId || !endId || startIndex === undefined || endIndex === undefined || reversedRange
    : mode === "boundary_copy" ? !boundaryId : discreteIds.size === 0;
  const activePendingAttempt = pendingAttempt?.conversationId === conversationId ? pendingAttempt : null;

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[230] flex items-end justify-center bg-[var(--overlay)] p-0 outline-none md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="conversation-split-title">
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={close} />
      <section className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl md:max-w-5xl md:rounded-xl">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <Scissors className="h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><h2 id="conversation-split-title" className="text-base font-semibold text-primary">{zh ? "拆分对话" : "Split conversation"}</h2><p className="truncate text-xs text-secondary">{conversationTitle}</p></div>
          <button ref={closeButtonRef} type="button" onClick={close} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-h-0 flex-col border-b border-ui md:border-b-0 md:border-r">
            <div className="grid grid-cols-3 gap-1 border-b border-ui p-2" aria-label={zh ? "拆分模式" : "Split mode"}>
              {modes.map((option) => <button key={option.id} type="button" disabled={busy || loading || Boolean(activePendingAttempt)} onClick={() => changeMode(option.id)} className={`min-h-10 rounded-lg px-2 text-sm font-medium ${mode === option.id ? "bg-[var(--text)] text-[var(--surface)]" : "text-secondary hover:bg-subtle"} disabled:cursor-wait disabled:opacity-50`}>{zh ? option.zh : option.en}</button>)}
            </div>

            <div className="space-y-3 border-b border-ui p-3">
              {mode === "range_copy" ? <div className="grid gap-2 sm:grid-cols-2"><MessageSelect disabled={busy || loading || Boolean(activePendingAttempt)} label={zh ? "起始消息" : "Start"} value={startId} items={items} onChange={(value) => { retireOperation(); setStartId(value); setPreview(null); }} /><MessageSelect disabled={busy || loading || Boolean(activePendingAttempt)} label={zh ? "结束消息" : "End"} value={endId} items={items} onChange={(value) => { retireOperation(); setEndId(value); setPreview(null); }} /></div> : null}
              {reversedRange ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "结束消息不能早于起始消息。" : "End must not precede start."}</p> : null}
              {mode === "boundary_copy" ? <MessageSelect disabled={busy || loading || Boolean(activePendingAttempt)} label={zh ? "前半段结束于" : "First result ends at"} value={boundaryId} items={items.slice(0, -1)} onChange={(value) => { retireOperation(); setBoundaryId(value); setPreview(null); }} /> : null}
              <p className="text-xs leading-5 text-secondary">{mode === "range_copy" ? (zh ? "复制起止之间的全部消息；时间线中高亮的中间消息也会被包含。" : "Copies every message between the endpoints, including highlighted messages in between.") : mode === "boundary_copy" ? (zh ? "以边界生成前、后两个新对话，原对话保持不变。" : "Creates two new conversations around the boundary; the source stays unchanged.") : (zh ? "只复制明确勾选的消息，不会自动补齐问答轮次。" : "Copies only checked messages without completing turns.")}</p>
            </div>

            <div className="min-h-[15rem] flex-1 overflow-y-auto p-2" aria-label={zh ? "消息时间线" : "Message timeline"}>
              {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin" />{zh ? "正在加载完整对话…" : "Loading full conversation…"}</div> : loadError ? <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-secondary"><p>{error ?? (zh ? "无法读取完整对话。" : "Unable to load the complete conversation.")}</p><button type="button" disabled={loading || busy} onClick={retryLoad} className="min-h-10 rounded-lg border border-ui bg-raised px-4 font-medium text-primary hover:bg-subtle disabled:opacity-50">{zh ? "重试读取" : "Retry reading"}</button></div> : items.map((item) => {
                const included = includedIds.has(item.message_id);
                const boundary = mode === "boundary_copy" && item.message_id === boundaryId;
                return <button key={item.message_id} type="button" disabled={busy || loading || Boolean(activePendingAttempt)} onClick={() => {
                  if (mode === "discrete_copy") { retireOperation(); setDiscreteIds((current) => { const next = new Set(current); if (next.has(item.message_id)) next.delete(item.message_id); else next.add(item.message_id); return next; }); setPreview(null); }
                  if (mode === "boundary_copy" && item.message_id !== items[items.length - 1]?.message_id) { retireOperation(); setBoundaryId(item.message_id); setPreview(null); }
                }} className={`mb-1 grid w-full grid-cols-[2rem_3.5rem_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-2 text-left ${included ? "bg-[var(--accent-soft)]" : "hover:bg-subtle"}`}>
                  <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg ${included ? "text-accent" : "text-secondary"}`}>{mode === "discrete_copy" ? (included ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />) : <span className="text-xs font-semibold">{item.ordinal}</span>}</span>
                  <span className="pt-1.5 text-[11px] font-semibold uppercase text-secondary">{item.role === "user" ? (zh ? "你" : "You") : "AI"}</span>
                  <span className="min-w-0 pt-1 text-sm leading-5 text-primary"><span className="line-clamp-2">{item.preview || (zh ? "空消息" : "Empty message")}</span>{boundary ? <span className="mt-1 inline-block text-[11px] font-semibold text-accent">{zh ? "边界：此消息属于前半段" : "Boundary: included in first result"}</span> : null}</span>
                </button>;
              })}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-surface p-4">
            <h3 className="text-sm font-semibold text-primary">{zh ? "结果预览" : "Result preview"}</h3>
            <p className="mt-1 text-xs leading-5 text-secondary">{zh ? `当前计划包含 ${includedIds.size} 条消息。提交前由服务端再次校验范围与权限。` : `${includedIds.size} messages are currently included. The server validates the final plan before execution.`}</p>
            {preview ? <div className="mt-4 space-y-3">{preview.groups.map((group, index) => <label key={`${index}-${group.message_count}`} className="block rounded-lg border border-ui bg-raised p-3 text-xs text-secondary"><span className="font-semibold text-primary">{zh ? `结果 ${index + 1}` : `Result ${index + 1}`} · {group.message_count} {zh ? "条消息" : "messages"}</span><input disabled={busy || Boolean(activePendingAttempt)} value={titles[index] ?? ""} onChange={(event) => setTitles((current) => current.map((value, position) => position === index ? event.target.value : value))} className="mt-2 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-60" /></label>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-ui p-4 text-sm leading-6 text-secondary">{zh ? "选择范围后生成预览，这里会显示最终创建的一个或两个对话。" : "Preview the selection to see the one or two conversations that will be created."}</div>}
            {result ? <div className="mt-4 space-y-2" role="status">{result.conversations.map((conversation) => <a key={conversation.conversation_id} href={`/conversations/${conversation.conversation_id}`} className="block rounded-lg border border-ui bg-raised p-3 text-sm font-medium text-accent hover:bg-subtle">{conversation.display_title} · {conversation.message_count}</a>)}</div> : null}
            {error && !loadError ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-5">
              {activePendingAttempt ? <button type="button" disabled={busy || loading} onClick={() => void execute()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}{zh ? "安全重试同一次拆分" : "Retry the same split safely"}</button> : <>
                <button type="button" disabled={busy || loading || loadError || invalid} onClick={() => void requestPreview()} className="min-h-10 rounded-lg border border-ui bg-raised px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{zh ? "生成预览" : "Preview"}</button>
                <button type="button" disabled={busy || loading || loadError || !preview || result !== null || titles.some((title) => !title.trim())} onClick={() => void execute()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}{zh ? "创建新对话" : "Create"}</button>
              </>}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function MessageSelect({ disabled = false, label, value, items, onChange }: { disabled?: boolean; label: string; value: string; items: DialogueIndexItem[]; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-primary">{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-60">{items.map((item) => <option key={item.message_id} value={item.message_id}>#{item.ordinal} · {item.role} · {item.preview.slice(0, 70)}</option>)}</select></label>;
}

async function loadDialogueIndex(conversationId: string): Promise<DialogueIndexItem[]> {
  const items: DialogueIndexItem[] = [];
  let offset = 0;
  while (true) {
    const page = await getConversationDialogueIndex(conversationId, { offset, limit: 5000 });
    items.push(...page.items);
    if (!page.has_more || page.items.length === 0) return items;
    offset += page.items.length;
  }
}

function splitErrorMessage(error: unknown, zh: boolean, operation: "load" | "preview" | "execute"): string {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  if (status === 401) return zh ? "登录状态已过期，请重新登录后继续。" : "Your session expired. Sign in again to continue.";
  if (status === 403) return zh ? "当前权限不允许拆分此对话。" : "Your current permissions do not allow splitting this conversation.";
  if (status === 404) return zh ? "对话已不存在或已被移除，请重新打开列表。" : "This conversation is no longer available. Reopen it from the list.";
  if (status === 409) return zh ? "对话已发生变化，请重新加载后再拆分。" : "The conversation changed. Reload it before splitting.";
  if (status === 422) return zh ? "拆分范围或标题无效，请检查后重试。" : "The split range or title is invalid. Check it and try again.";
  if (status === 429) return zh ? "请求过于频繁，请稍后再试。" : "Too many requests. Try again shortly.";
  if (operation === "load") return zh ? "无法读取完整对话，请重试。" : "Unable to load the complete conversation. Try again.";
  if (operation === "preview") return zh ? "无法生成拆分预览，请检查选择后重试。" : "Unable to create the split preview. Check the selection and try again.";
  return zh ? "拆分结果尚未确认，请先检查对话列表后再决定是否重试。" : "The split result is unconfirmed. Check the conversation list before deciding whether to retry.";
}
