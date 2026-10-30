"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, deleteUserFeatureEntry, getUserFeatureEntries, saveUserFeatureEntry } from "../lib/api";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../lib/offline-access";
import type { UserFeatureCollection, UserFeatureEntry } from "../lib/types";

type Attempt = {
  kind: "save" | "remove"; entry: UserFeatureEntry<unknown>; generation: number; token: object;
  phase: "writing" | "unknown" | "checking" | "matches" | "absent" | "different" | "read_failed";
  current?: UserFeatureEntry<unknown> | null;
};
// At most one unresolved operation per collection and account epoch in this tab.
// Memory only: reopening a panel must not replace a lost-response create UUID.
const attempts = new Map<UserFeatureCollection, Attempt>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => listeners.forEach(listener => listener());
function currentAttempt(collection: UserFeatureCollection) {
  const attempt = attempts.get(collection);
  return attempt?.generation === authenticationGeneration() ? attempt : null;
}
function comparable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${comparable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function useFeatureEntryRecovery<T>(collection: UserFeatureCollection, zh: boolean,
  onSaved: (entry: UserFeatureEntry<T>) => void, onRemoved: (entry: UserFeatureEntry<T>) => void,
  onContinue: (intended: UserFeatureEntry<T>, current: UserFeatureEntry<T> | null) => void) {
  const queryClient = useQueryClient();
  const renderGeneration = authenticationGeneration();
  const snapshot = useCallback(() => currentAttempt(collection), [collection]);
  const attempt = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    const reset = () => {
      for (const [key, value] of attempts) if (value.generation !== authenticationGeneration()) attempts.delete(key);
      publish();
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, reset);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, reset);
  }, []);
  const owns = (owned: Attempt) => currentAttempt(collection)?.token === owned.token;
  function replace(owned: Attempt, changes: Partial<Attempt>) {
    if (owns(owned)) { attempts.set(collection, { ...owned, ...changes }); publish(); }
  }
  function clear(owned: Attempt) { if (owns(owned)) { attempts.delete(collection); publish(); } }
  async function send(kind: Attempt["kind"], entry: UserFeatureEntry<T>, retry?: Attempt) {
    if (renderGeneration !== authenticationGeneration()) throw new Error("FEATURE_ACCOUNT_CHANGED");
    if (!retry && currentAttempt(collection)) throw new Error("FEATURE_RESULT_REQUIRES_CHECK");
    if (retry && (!owns(retry) || currentAttempt(collection)?.phase !== "absent"
      || kind !== "save" || retry.entry.revision !== 0)) throw new Error("FEATURE_RETRY_REQUIRES_CHECK");
    const owned: Attempt = retry ?? { kind, entry, generation: authenticationGeneration(), token: {}, phase: "writing" };
    attempts.set(collection, { ...owned, phase: "writing" }); publish();
    try {
      const result = kind === "save"
        ? await saveUserFeatureEntry<T>(collection, entry.id, { expected_revision: entry.revision, value: entry.value })
        : await deleteUserFeatureEntry(collection, entry.id, entry.revision);
      if (!owns(owned)) throw new Error("FEATURE_ACCOUNT_CHANGED");
      if (kind === "save" && result) onSaved(result as UserFeatureEntry<T>);
      else if (kind === "remove") onRemoved(entry);
      clear(owned);
      return result;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)) clear(owned);
      else replace(owned, { phase: "unknown" });
      throw error;
    }
  }
  async function check(owned: Attempt) {
    if (!owns(owned)) return;
    replace(owned, { phase: "checking" });
    try {
      const rows = await getUserFeatureEntries<T>(collection);
      if (!owns(owned)) return;
      queryClient.setQueryData(["user-feature-entries", collection], rows);
      const current = rows.find(row => row.id === owned.entry.id) ?? null;
      const matches = owned.kind === "remove" ? !current : current && comparable(current.value) === comparable(owned.entry.value);
      replace(owned, { current, phase: matches ? "matches" : current ? "different" : "absent" });
    } catch { replace(owned, { phase: "read_failed" }); }
  }
  const waiting = attempt?.phase === "writing" || attempt?.phase === "checking";
  const panel = attempt && attempt.phase !== "writing" ? <div role="status" className="mt-3 space-y-2 border-y border-ui py-3 text-sm text-secondary">
    <p>{attempt.phase === "matches"
      ? (zh ? "已读取核对：当前状态与原请求目标一致。" : "Read-only check: the current state matches your request.")
      : attempt.phase === "absent"
        ? (zh ? "已读取核对：原请求的条目不存在。可按原身份重试，不会另建重复条目。" : "Read-only check: the entry is absent. Retry the original identity, not a new entry.")
        : attempt.phase === "different"
          ? (zh ? "当前值与原请求不同，请对照后继续编辑；不会自动覆盖。" : "The current value differs. Review it before editing; nothing is overwritten automatically.")
          : attempt.phase === "read_failed"
            ? (zh ? "核对读取失败，草稿和原请求身份仍保留。" : "The check failed. Your draft and request identity are retained.")
            : (zh ? "保存结果尚未确认。先读取核对，不会自动重复提交。" : "The result is unconfirmed. Check it without replaying the write.")}</p>
    <details><summary className="min-h-11 cursor-pointer py-3">{zh ? "查看保留的请求与当前值" : "Review retained request and current value"}</summary><div className="grid gap-3 sm:grid-cols-2">{[
      [zh ? "原请求目标" : "Intended", attempt.entry.value], [zh ? "当前服务器值" : "Current", attempt.current?.value],
    ].map(([label, value]) => <div key={String(label)}><p className="font-medium">{String(label)}</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-subtle p-3 text-xs">{JSON.stringify(value, null, 2) ?? (zh ? "尚未核对" : "Not checked")}</pre></div>)}</div></details>
    {attempt.phase === "matches" ? <button className="btn-secondary min-h-11 px-3" onClick={() => {
      if (!owns(attempt)) return;
      if (attempt.kind === "save" && attempt.current) onSaved(attempt.current as UserFeatureEntry<T>);
      else if (attempt.kind === "remove") onRemoved(attempt.entry as UserFeatureEntry<T>);
      clear(attempt);
    }}>{zh ? "接受已核对结果" : "Accept checked result"}</button> : null}
    {attempt.phase === "absent" && attempt.kind === "save" && attempt.entry.revision === 0 ? <button className="btn-secondary min-h-11 px-3" onClick={() => {
      void send("save", attempt.entry as UserFeatureEntry<T>, attempt).catch(() => {});
    }}>{zh ? "按原请求重试" : "Retry original request"}</button> : null}
    {!["matches", "different", "absent"].includes(attempt.phase) ? <button disabled={waiting} className="btn-secondary min-h-11 px-3" onClick={() => void check(attempt)}>{waiting ? (zh ? "正在核对…" : "Checking…") : (zh ? "只读核对当前状态" : "Check current state")}</button> : null}
    {attempt.phase === "different" || attempt.phase === "absent" ? <button className="ml-2 min-h-11 px-3 underline" onClick={() => {
      if (!owns(attempt)) return;
      onContinue(attempt.entry as UserFeatureEntry<T>, (attempt.current ?? null) as UserFeatureEntry<T> | null);
      clear(attempt);
    }}>{zh ? "保留草稿，按当前状态继续编辑" : "Keep draft and edit against current state"}</button> : null}
  </div> : null;
  return {
    save: (entry: UserFeatureEntry<T>) => send("save", entry) as Promise<UserFeatureEntry<T>>,
    remove: (entry: UserFeatureEntry<T>) => send("remove", entry) as Promise<void>,
    errorText: (error: unknown) => error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)
      ? (zh ? "请求已被拒绝；草稿仍保留，请检查输入或权限。" : "Request rejected. Your draft is retained; check the input or permissions.")
      : (zh ? "结果未确认；原请求已保留，请先只读核对。" : "Result unconfirmed. The original request is retained; check the current state first."),
    blocked: Boolean(attempt), panel,
  };
}
