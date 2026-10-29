"use client";

import { useEffect, useRef, useState } from "react";
import { getConversation } from "../../lib/api";
import { runBatchSelection, type BatchSelectionResult } from "../../lib/batch-selection";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import type { ConversationDetail } from "../../lib/types";

type CheckState = {
  scope: string;
  generation: number;
  ids: string[];
  checked: ConversationDetail[];
  failedCount: number;
  busy: boolean;
  released: boolean;
};

/** Owned by the list, not a row which may disappear after a committed write. */
export function useBatchResultCheck(zh: boolean, scope = "conversations") {
  const [state, setState] = useState<CheckState | null>(null);
  const stateRef = useRef<CheckState | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const version = useRef(0);
  const update = (value: CheckState | null) => { stateRef.current = value; setState(value); };
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      controllerRef.current?.abort();
      version.current++;
      inFlight.current = false;
      update(null);
    };
    clear();
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, clear);
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
      version.current++;
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, clear);
    };
  }, [scope]);

  function record(result: BatchSelectionResult) {
    if (!mounted.current || scopeRef.current !== scope || !result.unconfirmedIds.length) return;
    const generation = authenticationGeneration();
    const previous = stateRef.current;
    // A later batch must not hide earlier unresolved requests.
    const previousIds = previous?.scope === scope && previous.generation === generation && !previous.released ? previous.ids : [];
    const ids = [...new Set([...previousIds, ...result.unconfirmedIds])];
    controllerRef.current?.abort();
    version.current++;
    inFlight.current = false;
    update({ scope, generation, ids, checked: [], failedCount: 0, busy: false, released: false });
  }

  async function check() {
    const previous = stateRef.current;
    if (!previous || previous.scope !== scope || previous.generation !== authenticationGeneration() || inFlight.current) return;
    inFlight.current = true;
    const generation = authenticationGeneration();
    const controller = new AbortController();
    controllerRef.current = controller;
    const stopOnIdentityChange = () => controller.abort();
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, stopOnIdentityChange);
    const currentVersion = ++version.current;
    const checked: ConversationDetail[] = [];
    update({ ...previous, checked: [], busy: true, failedCount: 0 });
    try {
      const result = await runBatchSelection(previous.ids, async (id) => {
        checked.push(await getConversation(id, AbortSignal.timeout(15_000)));
      }, 4, { signal: controller.signal });
      if (!mounted.current || scopeRef.current !== scope || currentVersion !== version.current || generation !== authenticationGeneration()) return;
      update({ ...previous, checked, busy: false,
        failedCount: result.failedIds.length + result.unconfirmedIds.length + result.notStartedIds.length });
    } finally {
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, stopOnIdentityChange);
      if (controllerRef.current === controller) controllerRef.current = null;
      if (currentVersion === version.current) inFlight.current = false;
    }
  }

  const visible = state?.scope === scope && state.generation === authenticationGeneration() ? state : null;
  const blockedIds = visible && !visible.released ? new Set(visible.ids) : new Set<string>();
  const surface = visible ? (
    <section className="space-y-2 rounded-lg border border-ui bg-surface px-4 py-3 text-sm" aria-label={zh ? "批量结果核对" : "Batch result check"} aria-busy={visible.busy}>
      <p className="text-secondary" role="status">{zh
        ? `有 ${visible.ids.length} 项原请求结果未确认。下方只读核对显示当前状态，不是原请求回执，也不会扩大撤销范围。`
        : `${visible.ids.length} original results are unconfirmed. This read-only check shows current state, not a receipt, and does not expand Undo.`}</p>
      {visible.checked.length > 0 ? <ul className="max-h-60 overflow-y-auto divide-y divide-[var(--border)]">
        {visible.checked.map((conversation) => <li key={conversation.id} className="flex flex-wrap items-center gap-2 py-2">
          <a href={`/conversations/${conversation.id}`} className="min-w-0 break-words text-accent underline underline-offset-2">{conversation.display_title || conversation.title}</a>
          <span className="text-xs text-secondary">{conversation.status === "archived" ? (zh ? "已归档" : "Archived") : (zh ? "活动" : "Active")} · {conversation.project_name || (zh ? "未分类" : "Unclassified")}</span>
        </li>)}
      </ul> : null}
      {visible.failedCount ? <p role="alert" className="text-[var(--danger)]">{zh ? `${visible.failedCount} 项未能读取，仍不能确认。` : `${visible.failedCount} items could not be read and remain unconfirmed.`}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={visible.busy} onClick={() => void check()} className="btn-secondary min-h-11 px-3">{visible.busy ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对未确认项当前状态" : "Check current state of unconfirmed items")}</button>
        {!visible.released && visible.checked.length === visible.ids.length && !visible.failedCount ? <button type="button" disabled={visible.busy} onClick={() => {
          if (scopeRef.current === scope && visible.generation === authenticationGeneration()) update({ ...visible, released: true });
        }} className="btn-secondary min-h-11 px-3">
          {zh ? "已核对，按当前状态继续" : "Reviewed; continue with current state"}
        </button> : null}
        {visible.released ? <p className="self-center text-xs text-secondary">{zh ? "已允许重新选择。若需再次修改，仍须明确发起新操作。" : "Selection is enabled again. Any further change still requires a new explicit action."}</p> : null}
      </div>
    </section>
  ) : null;
  return { record, blockedIds, surface };
}
