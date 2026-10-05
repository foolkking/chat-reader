"use client";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { SupportMarkdownEditor } from "./support-markdown-editor";
import { useSupportDraft } from "./use-support-draft";
import { emptySupportDraft, supportDraftKey, SupportDraftConflict } from "../lib/support-drafts";
import { SupportError, supportErrorText, supportFetch, supportInbox, supportKindText, type SupportAction, type SupportDetail, type SupportFlight, type SupportKind, type SupportLimits } from "../lib/support-client";
import { ACCOUNT_CAPABILITIES_CHANGED_EVENT, type AccountCapabilities } from "../lib/auth-client";
import { assertOfflineAccess, captureOfflineAccess } from "../lib/offline-access";

export const supportInputClass = "mt-1 min-h-11 w-full rounded-md border border-ui bg-surface px-3 py-2 text-sm text-primary";
export const supportButtonClass = "btn-secondary min-h-11 px-3 text-sm";
export function SupportRequestForm({ request, admin, kind = "QUESTION", initialLimits, capabilities, buildDiagnostics, onSaved, onLeave, onRefresh, onDirtyChange }: {
  request?: SupportDetail; admin: boolean; kind?: SupportKind; initialLimits?: SupportLimits; capabilities: AccountCapabilities | null;
  buildDiagnostics?: () => string; onSaved: (request: SupportDetail) => void; onLeave: () => void;
  onRefresh?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN", { confirm } = useInteractionDialog();
  const store = useSupportDraft(supportDraftKey(request ? `reply:${request.id}` : "new"), { ...emptySupportDraft(kind, request?.revision), ...(!request && initialLimits ? { importLimit: String(initialLimits.import_size_mb ?? ""), mergeLimit: String(initialLimits.merge_message_count ?? "") } : {}) }, onDirtyChange);
  const { draft } = store;
  const [online, setOnline] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const mounted = useRef(true), submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const locked = !store.ready || busy || Boolean(draft.flight) || Boolean(store.error);
  const changed = request && draft.baseRevision !== request.revision;
  const closed = request && !["OPEN", "WAITING"].includes(request.status);
  const mailAvailable = request?.mail_available ?? capabilities?.support_mail_available ?? false;
  const limits = (): SupportLimits => ({ ...(draft.importLimit ? { import_size_mb: Number(draft.importLimit) } : {}), ...(draft.mergeLimit ? { merge_message_count: Number(draft.mergeLimit) } : {}) });
  const actionLabel = (action: SupportAction) => ({ REPLY: zh ? "回复" : "Reply", APPROVE: zh ? "批准申请" : "Approve request", REJECT: zh ? "不批准" : "Decline", RESOLVE: zh ? "标记已解决" : "Resolve", REQUEST_INFO: zh ? "请用户补充" : "Request information", WITHDRAW: zh ? "撤回请求" : "Withdraw request" })[action];
  const submit = async () => {
    if (submitting.current || busy) return;
    const access = captureOfflineAccess(); setError(null);
    let flight: SupportFlight | null = draft.flight;
    if (!flight) {
      const body = draft.body.trim() + (draft.diagnostics ? `\n\n---\n\n\`\`\`json\n${draft.diagnostics}\n\`\`\`` : "");
      if (!draft.body.trim() || body.length > 20000 || (!request && !draft.title.trim())) return;
      if (request && draft.action !== "REPLY" && !(await confirm({ title: `${actionLabel(draft.action)}？`, description: draft.action === "APPROVE" ? (zh ? "确认后立即提高此账户的生效限制，处理说明会保存在请求中。" : "This immediately increases the account's effective limits and records your explanation.") : (zh ? "处理结果与说明会保存在此请求中。" : "The outcome and explanation will be recorded in this request."), confirmLabel: actionLabel(draft.action), danger: draft.action === "WITHDRAW" || draft.action === "REJECT" }))) return;
      assertOfflineAccess(access);
      flight = { key: crypto.randomUUID(), method: "POST", path: request ? `${supportInbox(admin)}/${request.id}/${draft.action === "REPLY" ? "messages" : "decision"}` : "/api/me/requests", payload: request ? { base_revision: draft.baseRevision, body, notify: draft.notify, ...(draft.action !== "REPLY" ? { action: draft.action, limits: draft.action === "APPROVE" ? limits() : {} } : {}) } : { kind: draft.kind, title: draft.title.trim(), body, limits: draft.kind === "LIMIT" ? limits() : {}, notify_admin: draft.notify, notify_replies: draft.notifyReplies } };
    }
    submitting.current = true; setBusy(true);
    try {
      await store.persist({ ...draft, flight });
      await store.flush(); assertOfflineAccess(access);
      const result = await supportFetch<SupportDetail>(flight.path, flight);
      if (!result.id || !Number.isInteger(result.revision) || !Array.isArray(result.messages)) throw new SupportError("INVALID_RESPONSE", 502);
      assertOfflineAccess(access);
      await store.remove();
      assertOfflineAccess(access);
      window.dispatchEvent(new Event(ACCOUNT_CAPABILITIES_CHANGED_EVENT));
      if (mounted.current) { onDirtyChange?.(false); onSaved(result); }
    } catch (e) {
      if (mounted.current) setError(e);
      // Only explicit rejection is safe to turn back into an editable draft.
      // Network/5xx/invalid responses retain the exact flight for replay.
      if (e instanceof SupportError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.code !== "IDEMPOTENCY_CONFLICT") {
        await store.persist({ ...draft, flight: null }).catch(() => undefined);
        if (mounted.current && (e.code === "REQUEST_CHANGED" || e.code === "REQUEST_CLOSED")) onRefresh?.();
      }
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  const leave = async () => { try { await store.flush(); onDirtyChange?.(false); onLeave(); } catch (e) { setError(e); } };
  const discard = async () => {
    if (draft.flight) return;
    if (!(await confirm({ title: zh ? "删除这份草稿？" : "Delete this draft?", confirmLabel: zh ? "删除草稿" : "Delete draft", danger: true }))) return;
    try { await store.remove(); onDirtyChange?.(false); onLeave(); } catch (e) { setError(e); }
  };
  const showLimits = !request ? draft.kind === "LIMIT" : draft.action === "APPROVE";
  const requestedNames = request ? Object.keys(request.requested_limits) : ["import_size_mb", "merge_message_count"];
  const fields = [
    { name: "import_size_mb", value: draft.importLimit, change: (v: string) => store.change({ importLimit: v }), label: zh ? "单文件导入（MiB）" : "Import per file (MiB)", min: 1, max: request?.requested_limits.import_size_mb ?? capabilities?.limit_hard_bounds?.import_size_mb },
    { name: "merge_message_count", value: draft.mergeLimit, change: (v: string) => store.change({ mergeLimit: v }), label: zh ? "合并消息数" : "Merged messages", min: 2, max: request?.requested_limits.merge_message_count ?? capabilities?.limit_hard_bounds?.merge_message_count },
  ];
  const invalidLimits = showLimits && (!draft.importLimit && !draft.mergeLimit || fields.some(f => f.value && (!Number.isSafeInteger(Number(f.value)) || Number(f.value) < f.min || (f.max != null && Number(f.value) > f.max))) || Boolean(request && requestedNames.some(name => !fields.find(f => f.name === name)?.value)));
  return <form className="space-y-4" aria-label={request ? (zh ? "回复与处理" : "Reply and decide") : (zh ? "新请求" : "New request")} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {initialLimits && store.restored ? <p className="text-sm text-secondary">{zh ? "已恢复你之前的草稿，请确认申请项目和数值。" : "Your previous draft was restored. Review its requested limits before submitting."}</p> : null}
    {!store.ready && !store.error ? <p role="status" className="text-sm text-secondary">{zh ? "读取草稿…" : "Loading draft…"}</p> : null}
    {store.error ? <div role="alert" className="space-y-2 border-l-2 border-[var(--callout-warning-border)] pl-3 text-sm"><p>{store.error instanceof SupportDraftConflict ? (zh ? "另一窗口保存了草稿。你的输入仍在这里，可先复制再读取最新草稿。" : "Another window saved this draft. Your input remains here; copy it before loading the latest draft.") : (zh ? "草稿未能保存到本机。请保留此页面并重试。" : "The draft could not be saved locally. Keep this page open and retry.")}</p><button type="button" className={supportButtonClass} onClick={() => void (store.error instanceof SupportDraftConflict ? store.reload() : store.retry()).catch(setError)}>{store.error instanceof SupportDraftConflict ? (zh ? "读取最新草稿" : "Load latest draft") : (zh ? "重试保存" : "Retry saving")}</button></div> : null}
    {!request ? <>
      <label className="block text-sm">{zh ? "请求类型" : "Request type"}<select disabled={locked} className={supportInputClass} value={draft.kind} onChange={e => store.change({ kind: e.target.value as SupportKind })}>{(["QUESTION", "ISSUE", "LIMIT"] as const).map(k => <option key={k} value={k}>{supportKindText(k, zh)}</option>)}</select></label>
      <label className="block text-sm">{zh ? "标题" : "Title"}<input required maxLength={160} disabled={locked} className={supportInputClass} value={draft.title} onChange={e => store.change({ title: e.target.value })} /></label>
    </> : <label className="block text-sm">{zh ? "处理方式" : "Action"}<select className={supportInputClass} disabled={locked} value={draft.action} onChange={e => store.change({ action: e.target.value as SupportAction, ...(e.target.value === "APPROVE" ? { importLimit: String(request.requested_limits.import_size_mb ?? ""), mergeLimit: String(request.requested_limits.merge_message_count ?? "") } : {}) })}>{(admin ? ["REPLY", ...(request.kind === "LIMIT" ? ["APPROVE", "REJECT"] : ["RESOLVE"]), "REQUEST_INFO"] : ["REPLY", "WITHDRAW"]).map(a => <option key={a} value={a}>{actionLabel(a as SupportAction)}</option>)}</select></label>}
    {showLimits ? <fieldset className="space-y-3 border-y border-ui py-3"><legend className="text-sm font-medium">{request ? (zh ? "批准后的上限" : "Approved limits") : (zh ? "希望调整为" : "Requested limits")}</legend><div className="grid gap-3 sm:grid-cols-2">{fields.filter(f => requestedNames.includes(f.name)).map(f => <label key={f.name} className="text-sm text-secondary">{f.label}<input type="number" inputMode="numeric" step={1} min={f.min} max={f.max ?? undefined} required={Boolean(request)} disabled={locked} className={supportInputClass} value={f.value} onChange={e => f.change(e.target.value)} />{f.max != null ? <span className="mt-1 block text-xs">{zh ? "最高 " : "Maximum "}{f.max}</span> : null}</label>)}</div>{!request ? <p className="text-xs text-secondary">{zh ? "只填写需要提高的项目，留空表示不申请。" : "Fill only the limits you need increased; leave the others blank."}</p> : null}</fieldset> : null}
    <div><p className="mb-2 text-sm font-medium">{request ? (zh ? "回复或处理说明" : "Reply or decision note") : (zh ? "说明" : "Details")}</p><SupportMarkdownEditor value={draft.body} onChange={body => store.change({ body })} disabled={locked} /><p className="mt-1 text-right text-xs text-secondary">{draft.body.length.toLocaleString()} / 20,000</p></div>
    <details className="border-y border-ui"><summary className="min-h-11 cursor-pointer py-3 text-sm text-secondary">{zh ? "邮件与诊断（可选）" : "Email and diagnostics (optional)"}</summary><div className="space-y-3 pb-4 text-sm">
      {mailAvailable ? <><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={locked} checked={draft.notify} onChange={e => store.change({ notify: e.target.checked })} />{admin ? (zh ? "邮件通知用户" : "Notify the user by email") : (zh ? "邮件通知管理员" : "Notify the administrator by email")}</label>{!request ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={locked} checked={draft.notifyReplies} onChange={e => store.change({ notifyReplies: e.target.checked })} />{zh ? "回复时接收邮件" : "Email me when there is a reply"}</label> : null}</> : <p className="text-xs text-secondary">{zh ? "邮件暂不可用，请在此查看回复。" : "Email is unavailable. Check replies here."}</p>}
      {buildDiagnostics || draft.diagnostics ? <><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={locked} checked={Boolean(draft.diagnostics)} onChange={e => { try { store.change({ diagnostics: e.target.checked ? buildDiagnostics?.() ?? "" : "" }); } catch (failure) { setError(failure); } }} />{zh ? "附上脱敏诊断" : "Attach redacted diagnostics"}</label>{draft.diagnostics ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-ui p-3 text-xs">{draft.diagnostics}</pre> : null}</> : null}
    </div></details>
    {changed && !draft.flight ? <div className="border-l-2 border-[var(--callout-warning-border)] pl-3 text-sm"><p>{zh ? "请求已更新。请查看上方最新回复，确认后继续。" : "This request has changed. Review the latest replies above before continuing."}</p><button type="button" disabled={locked} className={`${supportButtonClass} mt-2`} onClick={() => store.change({ baseRevision: request!.revision })}>{zh ? "已查看，继续使用我的输入" : "Reviewed; keep my input"}</button></div> : null}
    {closed && !draft.flight ? <p className="text-sm text-secondary">{zh ? "请求已结束。草稿仍可复制或删除，不能继续提交。" : "This request is closed. You can copy or delete the draft, but cannot submit it."}</p> : null}
    {draft.flight && !busy ? <p role="status" className="text-sm text-secondary">{zh ? "上次提交尚未确认，重试不会重复创建。" : "The previous submission is unconfirmed. Retrying will not create a duplicate."}</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{supportErrorText(error, zh)}</p> : null}
    {!online ? <p role="status" className="text-sm text-secondary">{zh ? "当前离线，草稿保存在本机。联网后请手动提交。" : "You are offline. The draft stays on this device; submit it manually when connected."}</p> : null}
    <p role="status" className="text-xs text-secondary">{store.saving ? (zh ? "正在保存草稿…" : "Saving draft…") : store.ready && !store.error ? (zh ? "草稿保存在本机" : "Draft saved on this device") : ""}</p>
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ui pt-3"><div className="flex flex-wrap gap-2"><button type="button" className={supportButtonClass} disabled={busy || !store.ready} onClick={() => void leave()}>{zh ? "保存并返回" : "Save and back"}</button><button type="button" className="btn-ghost min-h-11 px-3 text-sm text-secondary" disabled={busy || !store.ready || Boolean(draft.flight)} onClick={() => void discard()}>{zh ? "删除草稿" : "Delete draft"}</button></div><button type="submit" className="btn-primary min-h-11 px-4 text-sm" disabled={busy || !store.ready || Boolean(store.error) || !online || (!draft.flight && (Boolean(changed) || Boolean(closed) || !draft.body.trim() || draft.body.length + (draft.diagnostics ? draft.diagnostics.length + 24 : 0) > 20000 || (!request && !draft.title.trim()) || invalidLimits))}>{busy ? (zh ? "正在提交…" : "Submitting…") : draft.flight ? (zh ? "重试提交" : "Retry submission") : request ? actionLabel(draft.action) : (zh ? "提交请求" : "Submit request")}</button></footer>
  </form>;
}
