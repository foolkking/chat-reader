"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { offlineDb } from "../lib/offline-db";
import { readingConflictKey, readingSignature, readingSyncKey, readSyncedReadingPosition, resolveReadingPosition, type ReadingSyncState } from "../lib/reading-position-sync";
import type { ReadingPositionRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

export function ReadingPositionSyncStatus({ conversationId, onUseServer, storageError, onRetryStorage, showIdle = false }: {
  conversationId: string; onUseServer?: (position: ReadingPositionRead) => Promise<void>;
  storageError?: boolean; onRetryStorage?: () => Promise<void>;
  showIdle?: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [view, setView] = useState<{ local?: ReadingPositionRead; server?: ReadingPositionRead | null; conflict: boolean; pending: number; failed: boolean; submitted: boolean }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(false), [readAttempt, setReadAttempt] = useState(0);
  const [navigationTarget, setNavigationTarget] = useState<ReadingPositionRead | null>(null);
  useEffect(() => {
    const db = offlineDb;
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    const query = liveQuery(async () => {
      const [local, state, conflict, pending] = await Promise.all([db.readingPositions.get(conversationId), db.settings.get(readingSyncKey(conversationId)), db.settings.get(readingConflictKey(conversationId)), db.outbox.where("conversation_id").equals(conversationId).filter((row) => row.entity_type === "reading_position").toArray()]);
      return { local, server: (state?.value as ReadingSyncState | undefined)?.server, conflict: Boolean(conflict), pending: pending.length, failed: pending.some((row) => Boolean(row.last_error) && row.last_error !== "CONFLICT"), submitted: pending.some((row) => row.submitted) };
    });
    // Dexie's liveQuery intentionally suppresses DatabaseClosedError. Explicit
    // open makes a failed initial connection visible and lets Retry reopen it.
    void db.open().then(() => {
      if (!active) return;
      subscription = query.subscribe({ next: (value) => { setView(value); setReadFailed(false); }, error: () => setReadFailed(true) });
    }).catch(() => { if (active) setReadFailed(true); });
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) void readSyncedReadingPosition(conversationId, true).catch(() => undefined); };
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    return () => { active = false; subscription?.unsubscribe(); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [conversationId, readAttempt]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch { setError(zh ? "进度已变化或操作未完成，请重新核对后重试。" : "Progress changed or the action did not finish. Review and retry."); }
    finally { setBusy(false); }
  };
  if (!showIdle && !storageError && !readFailed && !view?.conflict && !view?.pending && !error && !navigationTarget) return null;
  const choose = (choice: "local" | "server") => perform(async () => {
    if (!view?.local || !view.server) return;
    const result = await resolveReadingPosition(conversationId, choice, view.server.revision ?? 1, readingSignature(view.local));
    if (result && onUseServer) { setNavigationTarget(result); await onUseServer(result); setNavigationTarget(null); }
  });
  return <section aria-label={zh ? "阅读进度同步" : "Reading progress sync"} className="space-y-2 border-b border-ui bg-surface px-3 py-2 text-xs">
    {view?.conflict ? <>
      <p className="font-medium">{zh ? "另一设备也更新了阅读位置" : "Another device updated your reading position"}</p>
      <p>{zh ? "本机" : "Local"}: {describe(view.local, zh)} · {zh ? "另一设备" : "Other device"}: {describe(view.server, zh)}</p>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-9 px-3" disabled={busy || view.submitted} onClick={() => void choose("local")}>{zh ? "继续本机位置" : "Continue here"}</button><button className="btn-secondary min-h-9 px-3" disabled={busy || view.submitted} onClick={() => void choose("server")}>{zh ? "使用另一设备位置" : "Use other device position"}</button></div>
    </> : view?.pending ? <p role="status">{view.failed ? (zh ? "阅读进度同步失败，本机位置已保留。" : "Reading progress sync failed. Your local position is saved.") : (zh ? "阅读进度已保存在本机，等待同步。" : "Reading progress is saved locally and waiting to sync.")}</p> : null}
    {storageError ? <p role="alert">{zh ? "阅读进度尚未保存，请重试；正文仍可阅读。" : "Reading progress could not be saved. Retry; the text remains readable."}</p> : null}
    {readFailed ? <p role="alert">{zh ? "无法读取本机进度，请检查浏览器存储。" : "Cannot read local progress. Check browser storage."}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {navigationTarget && error ? <button className="btn-secondary min-h-9 px-3" disabled={busy} onClick={() => void perform(async () => { await onUseServer?.(navigationTarget); setNavigationTarget(null); })}>{zh ? "重新定位已选位置" : "Retry locating the chosen position"}</button> : null}
    {showIdle && view && !view.conflict && !view.pending ? <p role="status">{zh ? "阅读位置已保存" : "Reading position saved"}</p> : null}
    {view?.failed || storageError || readFailed ? <button className="btn-secondary min-h-9 px-3" disabled={busy} onClick={() => void perform(async () => {
      await offlineDb.open();
      if (readFailed) await readSyncedReadingPosition(conversationId, navigator.onLine, true);
      setReadAttempt((value) => value + 1);
      if (storageError) await onRetryStorage?.();
      await offlineDb.outbox.where("conversation_id").equals(conversationId).filter((row) => row.entity_type === "reading_position" && row.last_error !== "CONFLICT").modify({ attempts: 0, last_error: null, retry_after: 0 });
      window.dispatchEvent(new Event("chat-reader:outbox"));
    })}>{zh ? "重试进度保存与同步" : "Retry saving and syncing progress"}</button> : null}
    {!onUseServer ? <a className="inline-flex min-h-9 items-center text-accent hover:underline" href={navigator.onLine ? `/conversations/${conversationId}` : `/library?conversationId=${conversationId}`}>{zh ? "打开对话" : "Open conversation"}</a> : null}
  </section>;
}

function describe(row: ReadingPositionRead | null | undefined, zh: boolean) {
  if (!row) return "—";
  const ordinal = row.anchor_data.ordinal;
  return `${typeof ordinal === "number" ? `${zh ? "消息" : "Message"} ${ordinal} · ` : ""}${zh ? "段落" : "Block"} ${(row.block_index ?? 0) + 1}`;
}
