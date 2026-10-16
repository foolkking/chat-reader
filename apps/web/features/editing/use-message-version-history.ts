"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import {
  ApiRequestError, deleteMessageVersion, getMessage,
  getMessageVersions, getTask, selectMessageVersion,
} from "../../lib/api";
import { archiveRequestSignal } from "../../lib/archive-task-state";
import { authenticationGeneration, AUTH_UNAUTHORIZED_EVENT, OFFLINE_ACCESS_LOCKED_EVENT } from "../../lib/offline-access";
import type { MessageListItem, MessageVersionHistoryResponse } from "../../lib/types";

type Scope = { messageId: string; conversationId: string; pathname: string | null; epoch: number; enabled: boolean };
type Operation = { scope: Scope; controller: AbortController };
export type VersionIssue = "session" | "permission" | "missing" | "conflict" | "invalid" | "limited" | "service";
export type VersionFeedback = {
  kind: "rejected" | "unconfirmed" | "refresh-failed" | "checked" | "stale" | "read-error";
  issue?: VersionIssue;
  unknown?: boolean;
  matched?: boolean;
};
type View = {
  scope: Scope;
  phase: "idle" | "confirming" | "writing" | "checking";
  feedback: VersionFeedback | null;
  checkedHead: string | null;
  pendingTargetId: string | null;
  pendingKind: "select" | "delete" | null;
  derivedJobId: string | null;
  derivedReadFailed: boolean;
  derivedTerminal: "failed" | "cancelled" | null;
};
const initialView = (scope: Scope): View => ({
  scope, phase: "idle", feedback: null, checkedHead: null, pendingTargetId: null, pendingKind: null,
  derivedJobId: null, derivedReadFailed: false, derivedTerminal: null,
});

export function versionIssue(error: unknown): VersionIssue {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  if (status === 401) return "session";
  if (status === 403) return "permission";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  if (status === 429) return "limited";
  if (status && status >= 400 && status < 500 && status !== 408) return "invalid";
  return "service";
}

export function versionWriteIsUnconfirmed(error: unknown): boolean {
  return !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 408);
}

// One owner per MessageItem, not one per desktop/mobile representation.
// Public/offline readers use disabled, non-private query keys.
export function useMessageVersionHistory({
  message, enabled, zh, onChanged,
}: {
  message: MessageListItem;
  enabled: boolean;
  zh: boolean;
  onChanged: (message: MessageListItem, conversationRevision?: number, isCurrent?: () => boolean) => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const dialog = useInteractionDialog();
  const pathname = usePathname();
  const [, refreshAuthorization] = useState(0);
  const epoch = authenticationGeneration();
  const scope = useMemo<Scope>(() => ({
    messageId: message.id, conversationId: message.conversation_id, pathname, epoch, enabled,
  }), [message.id, message.conversation_id, pathname, epoch, enabled]);
  const scopeRef = useRef(scope);
  const live = useRef({ message, onChanged });
  live.current = { message, onChanged };
  const mounted = useRef(true);
  const blockedEpoch = useRef<number | null>(null);
  const operation = useRef<Operation | null>(null);
  const confirmedHead = useRef<string | null>(null);
  const previousPropHead = useRef(message.current_version?.id ?? null);
  const propHead = message.current_version?.id ?? null;
  if (previousPropHead.current !== propHead) {
    if (confirmedHead.current !== propHead) confirmedHead.current = null;
    previousPropHead.current = propHead;
  }
  const viewRef = useRef(initialView(scope));
  const [view, setView] = useState(viewRef.current);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    viewRef.current = initialView(scope);
  }
  const state = view.scope === scope ? view : viewRef.current;
  const active = enabled && blockedEpoch.current !== epoch;
  // Keep the established key shape so source-editor writes and other existing
  // readers invalidate the same history entry. Account/route ownership is
  // enforced by ownsScope and lifecycle cancellation, not by exposing the
  // authentication epoch in a private-cache key.
  const historyKey = useMemo(() => enabled
    ? ["message-versions", message.id]
    : ["message-versions", "inactive"], [enabled, message.id]);
  const derivedKey = ["version-derived-task", state.derivedJobId, epoch];

  function ownsScope() {
    return mounted.current && scopeRef.current === scope && scope.enabled
      && authenticationGeneration() === scope.epoch && blockedEpoch.current !== scope.epoch;
  }
  function owns(token: Operation) {
    return ownsScope() && operation.current === token && !token.controller.signal.aborted;
  }
  function update(patch: Partial<View>) {
    if (!ownsScope()) return;
    viewRef.current = { ...viewRef.current, ...patch, scope };
    setView(viewRef.current);
  }
  function begin(phase: View["phase"]): Operation | null {
    if (!ownsScope() || operation.current?.scope === scope) return null;
    operation.current?.controller.abort();
    const token = { scope, controller: new AbortController() };
    operation.current = token;
    update({ phase });
    return token;
  }
  function finish(token: Operation) {
    token.controller.abort();
    if (operation.current !== token) return;
    operation.current = null;
    update({ phase: "idle" });
  }
  function invalidateDerived() {
    for (const name of ["toc", "conversation-index", "search", "conversation-search", "sidebar-search"]) {
      void queryClient.invalidateQueries({ queryKey: [name] }).catch(() => undefined);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.controller.abort();
      operation.current = null;
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const retire = () => {
      blockedEpoch.current = scope.epoch;
      operation.current?.controller.abort();
      operation.current = null;
      refreshAuthorization(value => value + 1);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, retire);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, retire);
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    };
  }, [enabled]);
  useEffect(() => () => {
    const pending = operation.current;
    if (pending?.scope === scope) {
      pending.controller.abort();
      operation.current = null;
    }
    void queryClient.cancelQueries({ queryKey: historyKey, exact: true }).catch(() => undefined);
  }, [scope, historyKey, queryClient]);

  const versionsQuery = useQuery({
    queryKey: historyKey,
    queryFn: async ({ signal }) => {
      if (!ownsScope()) throw new Error("VERSION_SCOPE_RETIRED");
      const history = await getMessageVersions(scope.messageId, signal);
      if (!ownsScope()) throw new Error("VERSION_SCOPE_RETIRED");
      return history;
    },
    enabled: active && state.phase === "idle" && !state.feedback,
    retry: false,
    refetchOnReconnect: false,
  });
  const derivedTaskQuery = useQuery({
    queryKey: derivedKey,
    queryFn: async ({ signal }) => {
      if (!ownsScope()) throw new Error("VERSION_SCOPE_RETIRED");
      const task = await getTask(state.derivedJobId!, archiveRequestSignal(signal));
      if (!ownsScope()) throw new Error("VERSION_SCOPE_RETIRED");
      return task;
    },
    enabled: active && Boolean(state.derivedJobId) && !state.derivedReadFailed && !state.derivedTerminal,
    retry: false,
    refetchOnReconnect: false,
    refetchInterval: query => {
      if (query.state.error) return false;
      const status = query.state.data?.status;
      return !status || ["queued", "processing", "cancelling"].includes(status) ? 1500 : false;
    },
  });
  useEffect(() => {
    if (!ownsScope() || !state.derivedJobId) return;
    if (derivedTaskQuery.isError) {
      update({ derivedReadFailed: true });
      return;
    }
    const task = derivedTaskQuery.data;
    if (task?.job_id !== state.derivedJobId) return;
    if (task.status === "committed") {
      invalidateDerived();
      update({ derivedJobId: null, derivedReadFailed: false, derivedTerminal: null });
    } else if (task.status === "failed" || task.status === "cancelled") {
      update({ derivedTerminal: task.status, derivedReadFailed: false });
    }
    // Only a new task result/error changes this effect, not local disclosure.
  }, [scope, state.derivedJobId, derivedTaskQuery.data, derivedTaskQuery.isError]);

  const canonicalHead = confirmedHead.current ?? propHead;
  useEffect(() => {
    if (!ownsScope() || operation.current?.scope === scope || viewRef.current.feedback) return;
    const cached = queryClient.getQueryData<MessageVersionHistoryResponse>(historyKey);
    if (cached && cached.current_version_id !== (canonicalHead ?? null)) {
      void queryClient.invalidateQueries({ queryKey: historyKey, exact: true }).catch(() => undefined);
    }
    // Once per canonical head change; never a history polling/failed-read loop.
  }, [scope, canonicalHead, historyKey, queryClient]);

  const versions = useMemo(() => [...(versionsQuery.data?.items ?? [])]
    .sort((a, b) => a.version_number - b.version_number), [versionsQuery.data]);
  const currentIndex = versions.findIndex(item => item.id === versionsQuery.data?.current_version_id);
  const current = versions[currentIndex];
  function writable() {
    const read = queryClient.getQueryState(historyKey);
    const history = queryClient.getQueryData<MessageVersionHistoryResponse>(historyKey);
    return ownsScope() && !viewRef.current.feedback && operation.current?.scope !== scope
      && read?.status === "success" && read.fetchStatus !== "fetching"
      && Boolean(history?.items.some(item => item.id === history.current_version_id))
      && history?.current_version_id === live.current.message.current_version?.id;
  }
  async function write(kind: "select" | "delete", index: number) {
    if (!writable()) return;
    const target = versions[index];
    const head = live.current.message.current_version?.id;
    if (!target || (kind === "select" && target.id === head) || (kind === "delete" && !target.can_delete)) return;
    const token = begin(kind === "delete" ? "confirming" : "writing");
    if (!token) return;
    let accepted = false;
    try {
      if (kind === "delete") {
        const confirmed = await dialog.confirm({
          title: zh ? `永久删除 v${target.version_number}？` : `Permanently delete v${target.version_number}?`,
          description: zh ? "当前消息会自动切换到上一可用版本。此操作不能撤销。"
            : "The message will switch to the nearest earlier version. This cannot be undone.",
          confirmLabel: zh ? "永久删除" : "Delete permanently", danger: true,
        });
        if (!owns(token) || !confirmed) return;
      }
      const cached = queryClient.getQueryData<MessageVersionHistoryResponse>(historyKey);
      const read = queryClient.getQueryState(historyKey);
      if (!owns(token)) return;
      if (head !== live.current.message.current_version?.id || cached?.current_version_id !== head
        || read?.status !== "success" || read.fetchStatus === "fetching"
        || !cached?.items.some(item => item.id === target.id && (kind !== "delete" || item.can_delete))) {
        update({ feedback: { kind: "stale" } });
        return;
      }
      update({ phase: "writing" });
      await queryClient.cancelQueries({ queryKey: historyKey, exact: true });
      if (!owns(token)) return;
      const response = kind === "select"
        ? await selectMessageVersion(scope.messageId, target.id, token.controller.signal)
        : await deleteMessageVersion(scope.messageId, target.id, token.controller.signal);
      if (!owns(token)) return;
      accepted = true;
      confirmedHead.current = response.current_version_id;
      await queryClient.cancelQueries({ queryKey: historyKey, exact: true });
      if (!owns(token)) return;
      queryClient.setQueryData<MessageVersionHistoryResponse>(historyKey, existing => !existing ? existing : ({
        ...existing, current_version_id: response.current_version_id,
        items: existing.items.filter(item => !("deleted_version_id" in response) || item.id !== response.deleted_version_id)
          .map(item => ({ ...item, is_current: item.id === response.current_version_id })),
      }));
      update({
        pendingTargetId: null, pendingKind: null,
        derivedJobId: response.derived_status === "queued" ? response.derived_job_id ?? null : null,
        derivedReadFailed: false, derivedTerminal: null,
      });
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] }).catch(() => undefined);
      const visibleHead = live.current.message.current_version?.id;
      // Do not replace a different canonical version changed by another control.
      if (visibleHead !== head && visibleHead !== response.current_version_id) {
        update({ feedback: { kind: "refresh-failed" } });
        return;
      }
      try {
        await live.current.onChanged({ ...response.message, ordinal: live.current.message.ordinal }, response.conversation_revision, () => owns(token));
      } catch {
        if (owns(token)) update({ feedback: { kind: "refresh-failed" } });
      }
    } catch (error) {
      if (!owns(token)) return;
      const unknown = versionWriteIsUnconfirmed(error);
      update({ pendingTargetId: unknown ? target.id : null, pendingKind: unknown ? kind : null,
        feedback: accepted ? { kind: "refresh-failed" } : {
          kind: unknown ? "unconfirmed" : "rejected",
          issue: versionIssue(error), unknown,
        } });
    } finally {
      finish(token);
    }
  }

  async function checkCurrent() {
    const token = begin("checking");
    if (!token) return;
    const unknown = Boolean(viewRef.current.feedback?.unknown);
    const pendingTargetId = viewRef.current.pendingTargetId;
    const pendingKind = viewRef.current.pendingKind;
    update({ checkedHead: null });
    try {
      await queryClient.cancelQueries({ queryKey: historyKey, exact: true });
      if (!owns(token)) return;
      const [history, nextMessage] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: historyKey, staleTime: 0, retry: false,
          queryFn: async ({ signal }) => {
            const result = await getMessageVersions(scope.messageId, AbortSignal.any([signal, token.controller.signal]));
            if (!owns(token)) throw new Error("VERSION_SCOPE_RETIRED");
            return result;
          },
        }),
        getMessage(scope.messageId, token.controller.signal),
      ]);
      if (!owns(token)) return;
      if (history.message_id !== scope.messageId || nextMessage.id !== scope.messageId
        || nextMessage.conversation_id !== scope.conversationId
        || !history.current_version_id || history.current_version_id !== nextMessage.current_version?.id
        || !history.items.some(item => item.id === history.current_version_id)) {
        update({ feedback: { kind: "stale", unknown } });
        return;
      }
      const matches = !pendingTargetId || !pendingKind
        || (pendingKind === "select"
          ? history.current_version_id === pendingTargetId
          : history.current_version_id !== pendingTargetId && !history.items.some(item => item.id === pendingTargetId));
      await live.current.onChanged({ ...nextMessage, ordinal: live.current.message.ordinal, content_truncated: false }, undefined, () => owns(token));
      if (!owns(token)) return;
      if (unknown && !matches) {
        update({
          feedback: { kind: "stale", unknown: true, matched: false },
          checkedHead: history.current_version_id,
        });
        return;
      }
      invalidateDerived();
      update({
        feedback: unknown ? { kind: "checked", unknown: true, matched: true } : null,
        checkedHead: history.current_version_id,
      });
    } catch (error) {
      if (owns(token)) update({ feedback: { kind: "read-error", issue: versionIssue(error), unknown } });
    } finally {
      finish(token);
    }
  }
  function continueAfterCheck() {
    if (!ownsScope() || operation.current?.scope === scope || viewRef.current.feedback?.kind !== "checked") return;
    const history = queryClient.getQueryData<MessageVersionHistoryResponse>(historyKey);
    const read = queryClient.getQueryState(historyKey);
    if (read?.status !== "success" || read.fetchStatus === "fetching"
      || viewRef.current.checkedHead !== history?.current_version_id
      || history?.current_version_id !== live.current.message.current_version?.id
      || viewRef.current.feedback?.matched === false) {
      update({ feedback: { kind: "stale", unknown: true }, checkedHead: null });
      return;
    }
    update({ feedback: null, checkedHead: null, pendingTargetId: null, pendingKind: null });
  }
  async function checkDerived() {
    const jobId = viewRef.current.derivedJobId;
    if (!jobId) return;
    const token = begin("checking");
    if (!token) return;
    try {
      await queryClient.cancelQueries({ queryKey: derivedKey, exact: true });
      if (!owns(token)) return;
      const task = await getTask(jobId, archiveRequestSignal(token.controller.signal));
      if (!owns(token) || viewRef.current.derivedJobId !== jobId) return;
      queryClient.setQueryData(derivedKey, task);
      update({ derivedReadFailed: false });
    } catch {
      if (owns(token)) update({ derivedReadFailed: true });
    } finally {
      finish(token);
    }
  }
  const headMismatch = Boolean(versionsQuery.data)
    && (currentIndex < 0 || versionsQuery.data?.current_version_id !== canonicalHead);
  const needsAttention = Boolean(state.feedback || versionsQuery.isError || headMismatch || state.derivedReadFailed || state.derivedTerminal);
  return {
    scope, active, versions, current, currentIndex, phase: state.phase,
    feedback: state.feedback, needsAttention,
    loading: active && versionsQuery.isLoading,
    readFailed: versionsQuery.isError, readIssue: versionIssue(versionsQuery.error),
    refreshing: versionsQuery.isFetching, headMismatch,
    canWrite: active && state.phase === "idle" && !state.feedback && !versionsQuery.isError && !versionsQuery.isFetching && !headMismatch && currentIndex >= 0,
    derivedJobId: state.derivedJobId, derivedReadFailed: state.derivedReadFailed, derivedTerminal: state.derivedTerminal,
    select: (index: number) => write("select", index),
    remove: () => write("delete", currentIndex),
    checkCurrent, continueAfterCheck, checkDerived,
  };
}

export type MessageVersionHistoryController = ReturnType<typeof useMessageVersionHistory>;
