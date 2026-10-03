"use client";

import { useEffect, useState } from "react";
import { flushAnnotationOutbox } from "../lib/annotation-sync";
import { offlineDb } from "../lib/offline-db";
import { exportOfflinePending, OfflinePendingChangedError, readOfflinePending, type OfflinePendingSnapshot } from "../lib/offline-pending";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { flushPreferenceSync } from "../lib/preference-sync";

export function PendingChangesPanel({ initial, onCancel, onProceed, purpose = "signout", conversationIds }: {
  initial: OfflinePendingSnapshot; onCancel: () => void; onProceed: (fingerprint: string) => Promise<void>;
  purpose?: "signout" | "delete-copy" | "clear-files"; conversationIds?: string[];
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN", { confirm } = useInteractionDialog();
  const signout = purpose === "signout", filesOnly = purpose === "clear-files";
  const heading = signout ? (zh ? "退出前处理本机修改" : "Handle local changes before signing out") : (zh ? "清理前处理本机修改" : "Handle local changes before clearing data");
  const read = () => readOfflinePending(conversationIds);
  const [snapshot, setSnapshot] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [exported, setExported] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) {
      setError(cause instanceof OfflinePendingChangedError ? (zh ? "本机修改发生变化，已重新读取；请再次核对后操作。" : "Local changes changed and have been reloaded. Review them before continuing.")
        : (zh ? "操作未完成，本机资料仍保留。请检查连接或存储后重试。" : "The operation did not finish. Local data is retained. Check connection or storage and retry."));
      try { setSnapshot(await read()); } catch { /* Keep the last visible snapshot. */ }
    } finally { setBusy(false); }
  };
  const sync = () => perform(async () => {
    if (!conversationIds) await flushPreferenceSync({ refresh: true, retry: true });
    await offlineDb.outbox.filter((item) => !["CONFLICT", "INVALID"].includes(item.last_error ?? "")).modify({ attempts: 0, last_error: null, retry_after: 0 });
    for (let batch = 0; batch < 10; batch++) {
      const result = await flushAnnotationOutbox();
      if (!result.synced || result.conflicts) break;
    }
    const next = await read(); setSnapshot(next);
    setNotice(next.count ? (zh ? "已处理可同步的修改。草稿或冲突需先保存／解决，或导出后决定下一步。" : "Eligible edits were synced. Save drafts and resolve conflicts, or export before deciding what to do next.") : (zh ? "所有已提交修改均已确认，可以继续。" : "All submitted edits are confirmed. You can continue."));
  });
  const exportChanges = () => perform(async () => {
    const next = await read(); setSnapshot(next);
    const blob = await exportOfflinePending(next), url = URL.createObjectURL(blob);
    try { const link = document.createElement("a"); link.href = url; link.download = "chat-reader-unsynced-changes.zip"; document.body.appendChild(link); link.click(); link.remove(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 30_000); }
    setExported(next.fingerprint);
    setNotice(zh ? "已发起下载。请确认文件已保存，再决定是否清除此设备的资料。" : "Download started. Confirm the file is saved before clearing this device's data.");
  });
  const proceed = async () => {
    if (snapshot.count && !await confirm({ title: filesOnly ? (zh ? "已保存导出文件，仅清附件缓存？" : "Export saved — clear cached files only?") : signout ? (zh ? "放弃这些本机修改并继续退出？" : "Discard these local changes and continue signing out?") : (zh ? "放弃这些本机修改并删除副本？" : "Discard these local changes and delete the copy?"),
      description: filesOnly ? (zh ? "笔记、批注、草稿和待同步操作会继续保留；附件需重新下载。" : "Notes, annotations, drafts and pending edits remain. Files will need downloading again.") : signout ? (zh ? "此账户在本设备的受保护资料、待同步操作和草稿将被清除。服务器已保存的资料不变。" : "Protected copies, pending operations and drafts for this account will be cleared on this device. Data already saved on the server remains.") : (zh ? "仅清除此对话的本机副本、待同步修改和草稿。服务器资料与其他对话的本机修改保持不变。" : "This clears only this conversation's local copy, pending edits and drafts. Server data and other conversations' edits remain."), confirmLabel: filesOnly ? (zh ? "仅清附件缓存" : "Clear cached files only") : (zh ? "放弃并继续" : "Discard and continue"), danger: true })) return;
    await perform(() => onProceed(snapshot.fingerprint));
  };
  const proceedLabel = signout ? (!snapshot.count ? (zh ? "继续退出" : "Continue signing out") : exported === snapshot.fingerprint ? (zh ? "文件已保存，清除并退出" : "File saved — clear and sign out") : (zh ? "放弃本机修改并退出" : "Discard local changes and sign out")) : filesOnly ? (zh ? "仅清附件缓存" : "Clear cached files only") : snapshot.count ? (zh ? "放弃本机修改并删除副本" : "Discard local changes and delete copy") : (zh ? "删除副本" : "Delete copy");
  return <section className="space-y-4" aria-label={heading}>
    <button className="btn-secondary min-h-9 px-3 text-sm" disabled={busy} onClick={onCancel}>{signout ? (zh ? "返回账户设置" : "Back to account settings") : (zh ? "返回离线副本" : "Back to offline copies")}</button>
    <h3 className="text-base font-semibold">{heading}</h3>
    <dl className="divide-y divide-[var(--border)] border-y border-ui text-sm">{[[zh ? "待同步操作" : "Pending operations", snapshot.operations.length], [zh ? "未解决冲突" : "Unresolved conflicts", snapshot.conflicts.length], [zh ? "本机笔记草稿" : "Local notebook drafts", snapshot.drafts.length], [zh ? "Current / Index 草稿" : "Current / Index drafts", snapshot.continuationDrafts.length], [zh ? "待同步偏好" : "Pending preferences", Object.keys(snapshot.preferences?.changes ?? {}).length]].map(([label, count]) => <div key={label} className="flex justify-between gap-3 py-3"><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    {snapshot.continuationDrafts.length ? <p className="text-xs text-secondary">{zh ? "接续草稿需回到在线对话保存；导出会保留可重新上传的 Current / Index 文件。" : "Save continuation drafts from the online conversation. Export retains Current / Index files you can upload again."}</p> : null}
    <p className="text-xs leading-5 text-secondary">{zh ? "导出包含当前笔记、批注、草稿、冲突意图、待同步删除与偏好，可从文件中复制正文或参照偏好值恢复；不含附件文件，也不是个人 .cr 备份。导出不会自动标记为已同步。" : "Export includes notes, annotations, drafts, conflict intentions, pending deletions and preferences. Copy text or use the saved preference values to recover your changes. It excludes attachment files and is not a personal .cr backup. Export does not mark edits as synced."}</p>
    <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11 px-3 text-sm" disabled={busy || !online || !(snapshot.operations.length || Object.keys(snapshot.preferences?.changes ?? {}).length)} onClick={() => void sync()}>{zh ? "先同步" : "Sync first"}</button><button className="btn-secondary min-h-11 px-3 text-sm" disabled={busy || !snapshot.count} onClick={() => void exportChanges()}>{zh ? "导出本机修改" : "Export local changes"}</button><button className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={() => void perform(async () => { setSnapshot(await read()); })}>{zh ? "刷新状态" : "Refresh status"}</button></div>
    {snapshot.drafts.length || snapshot.conflicts.length ? <p className="text-xs text-secondary">{zh ? "也可返回笔记保存草稿，或在“离线与同步”中处理冲突后继续。" : "You can also return to the notebook to save drafts, or resolve conflicts in Offline & sync before continuing."}</p> : null}
    {filesOnly && snapshot.count ? <p className="text-xs text-secondary">{zh ? "请先同步或导出这些修改，再清理附件缓存。此操作不会放弃正文修改。" : "Sync or export these edits before clearing cached files. Text edits will be kept."}</p> : null}
    {error ? <p role="alert" className="border-l-2 border-[var(--danger)] pl-3 text-sm">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
    <div className="border-t border-ui pt-4"><button className={snapshot.count ? "min-h-11 rounded-md px-3 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "btn-primary min-h-11 px-3 text-sm"} disabled={busy || (signout && !online) || (filesOnly && snapshot.count > 0 && exported !== snapshot.fingerprint)} onClick={() => void proceed()}>{busy ? (zh ? "处理中…" : "Working…") : proceedLabel}</button></div>
  </section>;
}
