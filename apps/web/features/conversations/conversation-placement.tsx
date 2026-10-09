"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { ApiRequestError, getConversation, getProjects, placeConversation } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { ConversationDetail, ConversationListItem, ConversationPlacementResponse, ProjectConversationRead, ProjectRead, RecentItemRead } from "../../lib/types";

type Destination = { id: string | null; name: string };
type PlacementPhase = "choosing" | "moving" | "unknown" | "checking" | "review" | "unavailable" | "confirmed";
type PlacementState = {
  ticket: object;
  scope: string;
  epoch: number;
  conversation: ConversationListItem;
  target: Destination | null;
  search: string;
  phase: PlacementPhase;
  open: boolean;
  attempted: boolean;
  checked: ConversationDetail | null;
  error: string | null;
};

const projectKey = ["projects", "custom", "asc"];
const editable = (state: PlacementState) => state.phase === "choosing" || state.phase === "review";
const busy = (state: PlacementState | null) => state?.phase === "moving" || state?.phase === "checking";
const accessDenied = (error: unknown) => error instanceof ApiRequestError && [401, 403, 404].includes(error.status);

function placementFilters(id: string) {
  return [{ queryKey: ["conversation", "remote", id], exact: true },
    { queryKey: ["conversations"] }, { queryKey: ["project-conversations"] }, { queryKey: ["recent-items"] }];
}

function publishPlacement(client: QueryClient, result: ConversationPlacementResponse) {
  const saved = result.conversation;
  // Stop older reads before publishing. The response is a ListItem, not a full
  // Reader Detail; preserve detail-only data and all reading-position fields.
  for (const filter of placementFilters(saved.id)) void client.cancelQueries(filter).catch(() => undefined);
  const applies = (item: ConversationListItem) => item.id === saved.id && item.offline_revision <= saved.offline_revision;
  const update = <T extends ConversationListItem>(item: T): T => applies(item) ? {
    ...item, project_id: saved.project_id, project_name: saved.project_name,
    offline_revision: saved.offline_revision, updated_at: saved.updated_at,
  } : item;
  client.setQueryData<ConversationDetail>(["conversation", "remote", saved.id], item => item ? update(item) : item);
  for (const [key, rows] of client.getQueriesData<ConversationListItem[]>({ queryKey: ["conversations"] })) {
    if (!Array.isArray(rows)) continue;
    client.setQueryData(key, rows.filter(item => !(key[1] === "history" && saved.project_id !== null && applies(item))).map(update));
  }
  for (const [key, rows] of client.getQueriesData<ProjectConversationRead[]>({ queryKey: ["project-conversations"] })) {
    if (!Array.isArray(rows)) continue;
    client.setQueryData(key, rows.filter(item => !(key[1] !== result.placement.project_id && applies(item))).map(item => {
      if (!applies(item)) return item;
      return { ...update(item), project_relation: { ...item.project_relation,
        is_pinned: result.placement.is_pinned, sort_order: result.placement.sort_order,
        pinned_at: result.placement.is_pinned ? item.project_relation.pinned_at : null } };
    }));
  }
  client.setQueriesData<RecentItemRead[]>({ queryKey: ["recent-items"] }, rows => Array.isArray(rows)
    ? rows.map(item => applies(item.conversation) ? { ...item, project_id: result.placement.project_id, conversation: update(item.conversation) } : item)
    : rows);
  // Destination rows, relation timestamps, ordering and project counts require
  // a fresh list read. Never manufacture them from a partial response.
}

/** A list/sidebar owns this state; removing a moved row does not remove recovery. */
export function useConversationPlacement({ scope, unavailable, onChanged }: {
  scope: string;
  unavailable: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const client = useQueryClient();
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const epoch = authenticationGeneration();
  const [state, setState] = useState<PlacementState | null>(null);
  const stateRef = useRef<PlacementState | null>(null);
  const latest = useRef({ scope, unavailable, onChanged });
  latest.current = { scope, unavailable, onChanged };
  const mounted = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const focusOrigin = useRef<(() => HTMLElement | null) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const visible = state?.scope === scope && state.epoch === epoch && !unavailable ? state : null;
  const projectsQuery = useQuery({
    queryKey: projectKey,
    queryFn: ({ signal }) => getProjects({ sort: "custom", direction: "asc" }, AbortSignal.any([signal, AbortSignal.timeout(15_000)])),
    enabled: Boolean(visible?.open && editable(visible) && visible.target?.id !== null),
    retry: false,
  });
  const projects = (projectsQuery.data ?? []).filter(project => !project.is_default && !project.is_archived);
  const projectsReady = projectsQuery.isSuccess && !projectsQuery.isFetching;

  function update(next: PlacementState | null) { stateRef.current = next; setState(next); }
  function current(op: PlacementState) {
    return mounted.current && stateRef.current?.ticket === op.ticket
      && op.scope === latest.current.scope && op.epoch === authenticationGeneration();
  }
  function usable(op: PlacementState) { return current(op) && !latest.current.unavailable; }

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestController.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (stateRef.current && (stateRef.current.scope !== scope || stateRef.current.epoch !== epoch)) {
      requestController.current?.abort(); update(null); focusOrigin.current = null; previousFocus.current = null;
    }
  }, [epoch, scope]);

  function destination(op: PlacementState): Destination | null {
    if (!op.target || op.target.id === null) return op.target;
    // Check Query's live state as well as the rendered controls: a cached target
    // may have disappeared or its read failed between render and activation.
    const query = client.getQueryState<ProjectRead[]>(projectKey);
    if (query?.status !== "success" || query.fetchStatus !== "idle") return null;
    const project = query.data?.find(item => item.id === op.target?.id && !item.is_default && !item.is_archived
      && item.name.toLocaleLowerCase().includes(op.search.trim().toLocaleLowerCase()));
    return project ? { id: project.id, name: project.name } : null;
  }

  function refresh(op: PlacementState) {
    if (!usable(op)) return;
    const filters = placementFilters(op.conversation.id).filter(filter => !latest.current.onChanged || filter.queryKey[0] !== "conversations");
    for (const filter of [...filters, ...(!latest.current.onChanged ? [{ queryKey: ["projects"] }] : [])]) {
      void client.invalidateQueries(filter, { cancelRefetch: false }).catch(() => undefined);
    }
    void Promise.resolve().then(() => { if (usable(op)) return latest.current.onChanged?.(); }).catch(() => undefined);
  }

  async function send(op: PlacementState) {
    if (!usable(op) || stateRef.current !== op || busy(op)) return;
    const target = destination(op);
    if (!target) {
      update({ ...op, error: zh ? "请从成功读取的当前列表中选择目标项目。" : "Choose a destination from the successfully loaded current list." });
      return;
    }
    const base = op.checked ?? op.conversation;
    if (base.status !== "active") return;
    const pending: PlacementState = { ...op, conversation: base, target, phase: "moving", attempted: true, checked: null, error: null };
    update(pending); // Synchronous reservation, before the first await.
    const controller = new AbortController();
    requestController.current = controller;
    let result: ConversationPlacementResponse;
    try {
      result = await placeConversation(base.id, { target_project_id: target.id, target_section: "normal", expected_offline_revision: base.offline_revision },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
    } catch (error) {
      if (!current(pending) || stateRef.current?.phase !== "moving") return;
      update({ ...pending, open: stateRef.current.open, phase: accessDenied(error) ? "unavailable" : "unknown",
        error: error instanceof ApiRequestError && [400, 409, 422].includes(error.status)
          ? (zh ? "这次移动未被接受。请先核对当前归属，再决定是否移动。" : "This move was not accepted. Check the current location before deciding to move again.")
          : (zh ? "暂时无法确认移动结果，请先核对当前归属。" : "The move could not be confirmed. Check the current location first.") });
      return;
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
    if (!current(pending) || stateRef.current?.phase !== "moving") return;
    const saved = result?.conversation, placed = result?.placement;
    if (latest.current.unavailable || !saved || !placed || saved.id !== base.id || placed.project_id !== target.id
      || saved.offline_revision !== placed.offline_revision
      || !Number.isSafeInteger(placed.offline_revision) || placed.offline_revision < base.offline_revision) {
      update({ ...pending, open: stateRef.current.open, phase: "unknown",
        error: zh ? "返回内容无法确认这次移动，请核对当前归属。" : "The response could not confirm this move. Check the current location." });
      return;
    }
    const accepted: PlacementState = { ...pending, phase: "confirmed", open: false,
      target: { id: placed.project_id, name: saved.project_name ?? target.name } };
    update(accepted);
    publishPlacement(client, result);
    refresh(accepted);
  }

  function start(conversation: ConversationListItem, restoreFocus: () => HTMLElement | null, unclassified = false) {
    const previous = stateRef.current;
    if (!mounted.current || latest.current.unavailable || scope !== latest.current.scope || epoch !== authenticationGeneration() || conversation.status !== "active"
      || (previous && current(previous) && previous.phase !== "confirmed")) return;
    focusOrigin.current = restoreFocus;
    previousFocus.current = restoreFocus();
    const op: PlacementState = { ticket: {}, scope: latest.current.scope, epoch: authenticationGeneration(), conversation,
      target: unclassified ? { id: null, name: "" } : null, search: "", phase: "choosing", open: !unclassified,
      attempted: false, checked: null, error: null };
    update(op);
    if (unclassified) void send(op);
  }

  function changeSearch(value: string) {
    const op = stateRef.current;
    if (!op || !visible?.open || !op.open || !usable(op) || op.ticket !== visible.ticket || !editable(op)) return;
    const next = { ...op, search: value, error: null };
    if (next.target && !destination(next)) next.target = null;
    update(next);
  }

  function choose(id: string) {
    const op = stateRef.current;
    if (!op || !visible?.open || !op.open || !usable(op) || op.ticket !== visible.ticket || !editable(op)) return;
    const next = { ...op, target: { id, name: "" } };
    const target = destination(next);
    if (target) update({ ...next, target, error: null });
  }

  async function submit() {
    const op = stateRef.current;
    if (!op || !visible?.open || !op.open || !usable(op) || op.ticket !== visible.ticket || !editable(op)
      || (op.phase === "review" && op.checked !== visible.checked)) return;
    await send(op);
  }

  async function check() {
    const op = stateRef.current;
    if (!op || !visible || !usable(op) || op.ticket !== visible.ticket || op.open !== visible.open
      || !["unknown", "review", "unavailable"].includes(op.phase)
      || (op.phase === "review" && op.checked !== visible.checked)) return;
    const pending: PlacementState = { ...op, phase: "checking", checked: null, error: null, open: true };
    update(pending); // Retire every previous comparison before starting a GET.
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const saved = await getConversation(op.conversation.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!current(pending) || stateRef.current?.phase !== "checking") return;
      if (saved.id !== op.conversation.id || !Number.isSafeInteger(saved.offline_revision) || saved.offline_revision < op.conversation.offline_revision) throw new Error("Unexpected placement check");
      if (latest.current.unavailable || saved.status !== "active") {
        update({ ...pending, open: stateRef.current.open, phase: "unavailable", error: zh ? "此对话当前不可移动。未再次发送移动请求。" : "This conversation cannot currently be moved. No further move was sent." });
        return;
      }
      update({ ...pending, open: stateRef.current.open, phase: "review", checked: saved });
    } catch (error) {
      if (current(pending) && stateRef.current?.phase === "checking") update({ ...pending, open: stateRef.current.open,
        phase: accessDenied(error) ? "unavailable" : "unknown", error: zh ? "当前归属核对失败；原目标仍保留，请恢复连接或访问权限后再核对。" : "Could not check the current location. The intended destination is kept; check again when connection or access is restored." });
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }

  function close() {
    const op = stateRef.current;
    if (!op || !visible || !usable(op) || op.ticket !== visible.ticket) return;
    update(op.attempted ? { ...op, open: false } : null);
  }
  function reopen() {
    const op = stateRef.current;
    if (!op || !visible || !usable(op) || op.ticket !== visible.ticket || op.phase === "confirmed") return;
    update({ ...op, open: true }); // Opening recovery never starts a GET or PUT.
  }
  function dismiss() {
    const op = stateRef.current;
    if (!op || !visible || !usable(op) || op.ticket !== visible.ticket || busy(op)) return;
    update(null);
  }

  return { state: visible, projects, projectsReady, projectsQuery, choose, changeSearch, submit, check, close, reopen, dismiss,
    start, noticeRef, previousFocus, busy: busy(visible), blocked: unavailable || Boolean(visible && visible.phase !== "confirmed"),
    canSubmit: Boolean(visible && editable(visible) && destination(visible)),
    restoreFocus: () => {
      if (epoch !== authenticationGeneration() || scope !== latest.current.scope) return null;
      const origin = focusOrigin.current?.();
      return origin?.isConnected && origin.getClientRects().length ? origin : noticeRef.current;
    } };
}

export type ConversationPlacementController = ReturnType<typeof useConversationPlacement>;

export function ConversationPlacementSurface({ placement, floating = false }: {
  placement: ConversationPlacementController;
  floating?: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const id = useId();
  const rootRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { state } = placement;
  useDialogFocus({ open: Boolean(state?.open), rootRef, initialFocusRef: inputRef,
    onClose: placement.close, restoreFocus: placement.restoreFocus });
  useLayoutEffect(() => {
    if (state?.open && document.activeElement === document.body) {
      // Pending phases remove their action. Keep lost focus at the trap's first
      // enabled control (Close), without moving focus from a chosen control.
      rootRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus({ preventScroll: true });
    }
  }, [state?.open, state?.phase]);
  useLayoutEffect(() => {
    if (!state || state.open || placement.busy) return;
    const previous = placement.previousFocus.current;
    if (!previous) return;
    if (document.activeElement !== document.body && document.activeElement !== previous) {
      placement.previousFocus.current = null;
    } else if (!previous.isConnected && document.activeElement === document.body && placement.noticeRef.current?.getClientRects().length) {
      placement.previousFocus.current = null;
      placement.noticeRef.current.focus({ preventScroll: true });
    }
  }, [placement.busy, placement.noticeRef, placement.previousFocus, state]);
  if (!state) return null;
  const title = state.conversation.display_title || state.conversation.title;
  const targetName = state.phase === "unavailable" ? undefined : state.target?.id === null ? (zh ? "未分类" : "Unclassified")
    : (editable(state) ? placement.projects.find(project => project.id === state.target?.id)?.name : undefined) ?? state.target?.name;
  const needsCheck = ["unknown", "unavailable", "review"].includes(state.phase);
  const message = state.phase === "confirmed" ? (zh ? `移动已确认：${targetName}。` : `Move confirmed: ${targetName}.`)
    : state.phase === "moving" ? (zh ? "正在移动对话…" : "Moving conversation…")
    : state.phase === "checking" ? (zh ? "正在核对当前归属…" : "Checking current location…")
    : state.phase === "review" ? (zh ? "已读取当前归属。再次移动需要明确确认。" : "Current location read. Moving again requires your confirmation.")
    : state.error;
  const checkButton = needsCheck ? <button type="button" onClick={() => void placement.check()} className="btn-secondary min-h-11 px-3">
    {zh ? "核对当前归属" : "Check current location"}</button> : null;
  const notice = !state.open && state.attempted ? <div ref={placement.noticeRef} tabIndex={-1} data-testid="conversation-placement-feedback"
    role={state.phase === "unknown" || state.phase === "unavailable" ? "alert" : "status"}
    className={(floating ? "fixed inset-x-3 bottom-4 z-[240] mx-auto max-w-lg " : "") + "rounded-lg border border-ui bg-raised px-4 py-3 text-sm text-secondary outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"}>
    {state.phase !== "unavailable" ? <p className="break-words font-medium text-primary">{title}</p> : null}
    <p>{message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {checkButton}
      {state.phase !== "confirmed" ? <button type="button" onClick={placement.reopen} className="btn-secondary min-h-11 px-3">{zh ? "查看移动" : "Review move"}</button> : null}
      {!placement.busy ? <button type="button" onClick={placement.dismiss} className="btn-secondary min-h-11 px-3">{state.phase === "confirmed" ? (zh ? "关闭提示" : "Dismiss") : (zh ? "丢弃本次核对" : "Dismiss this check")}</button> : null}
    </div>
    {needsCheck ? <p className="mt-2 text-xs">{zh ? "丢弃核对不会取消或撤销服务器上的移动。" : "Dismissing this check does not cancel or undo the move on the server."}</p> : null}
  </div> : null;
  const filtered = placement.projects.filter(project => project.name.toLocaleLowerCase().includes(state.search.trim().toLocaleLowerCase()));
  const picker = editable(state) && state.target?.id !== null;
  return <>{notice}{state.open ? createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={id + "-title"} onPointerDown={event => event.stopPropagation()}
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4">
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={placement.close} />
      <form ref={rootRef} tabIndex={-1} className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl outline-none sm:max-w-lg sm:rounded-xl"
        onSubmit={event => { event.preventDefault(); void placement.submit(); }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ui px-5 py-3">
          <h2 id={id + "-title"} className="text-lg font-semibold text-primary">{zh ? "移动对话" : "Move conversation"}</h2>
          <button type="button" onClick={placement.close} aria-label={zh ? "关闭" : "Close"} className="btn-ghost flex min-h-11 min-w-11 items-center justify-center"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-sm text-secondary">
          {state.phase !== "unavailable" ? <p className="break-words font-medium text-primary">{title}</p> : null}
          {message ? <p role={state.error ? "alert" : "status"}>{message}</p> : null}
          {state.checked ? <div className="space-y-2 border-y border-ui py-3">
            <p className="font-medium text-primary">{zh ? "当前可见归属" : "Current visible location"}</p>
            <p className="break-words">{state.checked.project_name ?? (zh ? "未分类（也可能属于归档项目）" : "Unclassified (may belong to an archived project)")}</p>
            <p>{zh ? "这是当前读取结果，不是上次移动的回执；也不能证明之前的请求未提交。" : "This is a current read, not a receipt for the earlier move or proof that it did not commit."}</p>
          </div> : null}
          {picker ? <div>
            <label htmlFor={id + "-search"} className="block font-medium text-primary">{zh ? "搜索项目" : "Search projects"}</label>
            <input ref={inputRef} id={id + "-search"} type="search" value={state.search} onChange={event => placement.changeSearch(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-base text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] sm:text-sm" />
            {placement.projectsQuery.isFetching || placement.projectsQuery.isPending ? <p role="status" className="mt-3">{zh ? "正在读取项目…" : "Loading projects…"}</p> : null}
            {placement.projectsQuery.isError ? <div role="alert" className="mt-3 space-y-2">
              <p>{zh ? "项目读取失败；已有名称仅供参考，重试成功后才能选择。" : "Could not read projects. Cached names are for reference; retry before choosing."}</p>
              <button type="button" disabled={placement.projectsQuery.isFetching} onClick={() => void placement.projectsQuery.refetch()} className="btn-secondary min-h-11 px-3 disabled:opacity-50">{zh ? "重试读取项目" : "Retry projects"}</button>
            </div> : null}
            <fieldset disabled={!placement.projectsReady} className="mt-3 min-w-0">
              <legend className="mb-2 font-medium text-primary">{zh ? "目标项目" : "Destination project"}</legend>
              <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border)] border-y border-ui">
                {filtered.map(project => <label key={project.id} className="flex min-h-11 items-center gap-3 px-2 py-2 hover:bg-subtle has-[:disabled]:opacity-50">
                  <input type="radio" name={id + "-destination"} value={project.id} checked={state.target?.id === project.id}
                    onChange={() => placement.choose(project.id)} className="h-4 w-4 shrink-0 accent-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]" />
                  <span className="min-w-0 break-words text-primary">{project.name}</span>
                </label>)}
              </div>
            </fieldset>
            {placement.projectsReady && filtered.length === 0 ? <p className="mt-3">{placement.projects.length
              ? (zh ? "没有匹配的项目。" : "No matching projects.")
              : (zh ? "没有可用的活动项目，可从侧边栏新建项目或恢复已归档项目。" : "No active projects. Create one in the sidebar or restore an archived project.")}</p> : null}
            {state.search ? <button type="button" onClick={() => placement.changeSearch("")} className="btn-secondary mt-2 min-h-11 px-3">{zh ? "清除搜索" : "Clear search"}</button> : null}
          </div> : null}
          {targetName ? <p className="break-words">{zh ? "所选目标：" : "Selected destination: "}<span className="font-medium text-primary">{targetName}</span></p> : null}
          {state.attempted ? <p className="text-xs">{zh ? "关闭后仍可在当前页面查看这次移动；不会取消或撤销服务器请求。" : "Closing keeps this move available to review on this page. It does not cancel or undo the server request."}</p> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ui px-5 py-3">
          {checkButton}
          <button type="button" onClick={placement.close} className="btn-secondary min-h-11 px-3">{zh ? "返回" : "Back"}</button>
          {editable(state) ? <button type="submit" disabled={!placement.canSubmit} className="btn-primary min-h-11 px-4 disabled:opacity-50">
            {state.phase === "review" ? (zh ? "按当前状态再次移动" : "Move again using current state") : (zh ? "移动到所选项目" : "Move to selected project")}
          </button> : null}
        </footer>
      </form>
    </div>, document.body) : null}</>;
}
