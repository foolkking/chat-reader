"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { usePreferences } from "./preferences-provider";
import { SupportMessageContent } from "./support-markdown-editor";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { SupportRequestForm, supportButtonClass, supportInputClass } from "./support-request-form";
import { SupportLimitEditor } from "./support-limit-editor";
import { readAccountCapabilities, type AccountCapabilities } from "../lib/auth-client";
import { readCachedHelpInfo } from "../lib/help-status";
import { assertOfflineAccess, authenticationGeneration, captureOfflineAccess } from "../lib/offline-access";
import { SupportError, supportErrorText, supportFetch, supportInbox, supportKindText, supportStatusText, type SupportDetail, type SupportKind, type SupportLimits, type SupportPage } from "../lib/support-client";
import { offlineDb } from "../lib/offline-db";
import { readSupportDraft, supportDraftKey, type SavedSupportDraft } from "../lib/support-drafts";

export function useSupportResource<T>(path: string | null) {
  const epoch = authenticationGeneration();
  const [snapshot, setSnapshot] = useState<{ path: string; epoch: number; data: T } | null>(null);
  const [state, setState] = useState<{ path: string; epoch: number; loading: boolean; error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ path, epoch, loading: true, error: null });
    void supportFetch<T>(path, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setSnapshot({ path, epoch, data });
        setState({ path, epoch, loading: false, error: null });
      }
    }).catch(error => {
      if (!controller.signal.aborted) {
        if (inaccessible(error)) setSnapshot(null);
        setState({ path, epoch, loading: false, error });
      }
    });
    return () => controller.abort();
  }, [path, attempt, epoch]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  const current = state?.path === path && state?.epoch === epoch;
  return { data: snapshot?.path === path && snapshot?.epoch === epoch ? snapshot.data : null,
    error: current ? state.error : null, loading: Boolean(path && (!current || state.loading)), reload };
}

function inaccessible(error: unknown) { return error instanceof SupportError && [401, 403, 404].includes(error.status); }

export function SupportRequestsPanel({ initialRequestId, initialKind, initialLimits, onBack, onDirtyChange, buildDiagnostics, onOpenUser }: { initialRequestId?: string; initialKind?: SupportKind; initialLimits?: SupportLimits; onBack?: () => void; onDirtyChange?: (dirty: boolean) => void; buildDiagnostics?: () => string; onOpenUser?: (id: string) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [caps, setCaps] = useState<AccountCapabilities | null>(null), [role, setRole] = useState<"ADMIN" | "USER" | null>(null), [capError, setCapError] = useState(false), [capAttempt, setCapAttempt] = useState(0);
  const [selected, setSelected] = useState(initialRequestId ?? ""), [compose, setCompose] = useState(Boolean(initialKind));
  const [status, setStatus] = useState(""), [kind, setKind] = useState(""), [offset, setOffset] = useState(0), [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<SavedSupportDraft[]>([]), [draftError, setDraftError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), listScroll = useRef(0);
  const returnRow = useRef(""), restoreList = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setCapError(false);
    void (async () => { const access = captureOfflineAccess(); try { const result = await readAccountCapabilities(controller.signal); assertOfflineAccess(access); if (!controller.signal.aborted) { setCaps(result); setRole(result.role); } }
      catch { if (controller.signal.aborted) return; const cached = await readCachedHelpInfo(); assertOfflineAccess(access); if (!controller.signal.aborted) { if (!navigator.onLine && cached?.capabilities.role) setRole(cached.capabilities.role); else setCapError(true); } } })().catch(() => { if (!controller.signal.aborted) setCapError(true); });
    return () => controller.abort();
  }, [capAttempt]);
  useEffect(() => {
    if (compose || selected) return;
    let active = true; setDraftError(false);
    const access = captureOfflineAccess();
    void offlineDb.settings.where("key").startsWith("support-draft:").toArray().then(rows => { assertOfflineAccess(access); if (active) setDrafts(rows as SavedSupportDraft[]); }).catch(() => { if (active) setDraftError(true); });
    return () => { active = false; };
  }, [compose, selected]);
  const admin = role === "ADMIN";
  const page = useSupportResource<SupportPage>(role && !selected && !compose ? `${supportInbox(admin)}?offset=${offset}&limit=15${status ? `&status=${status}` : ""}${kind ? `&kind=${kind}` : ""}` : null);
  useLayoutEffect(() => { if (selected || compose || !restoreList.current) heading.current?.focus(); }, [selected, compose, role]);
  useLayoutEffect(() => {
    if (selected || compose || !page.data || page.loading) return;
    if (!page.error && offset > 0 && offset >= page.data.total) {
      listScroll.current = 0; restoreList.current = true;
      setOffset(Math.max(0, Math.ceil(page.data.total / 15) * 15 - 15));
      return;
    }
    if (!restoreList.current) return;
    restoreList.current = false;
    const container = heading.current?.closest<HTMLElement>("[data-settings-scroll-root]");
    const target = Array.from(container?.querySelectorAll<HTMLElement>("[data-support-request-id]") ?? []).find(row => row.dataset.supportRequestId === returnRow.current);
    (target ?? heading.current)?.focus({ preventScroll: true });
    container?.scrollTo(0, target ? listScroll.current : 0);
    if (target && container) {
      const bounds = target.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) target.scrollIntoView({ block: "nearest" });
    }
  }, [page.data, page.loading, page.error, selected, compose, offset]);
  const open = (id: string) => { listScroll.current = heading.current?.closest("[data-settings-scroll-root]")?.scrollTop ?? 0; returnRow.current = id; setSelected(id); setNotice(""); };
  const back = () => { restoreList.current = true; setCompose(false); setSelected(""); };
  const saved = (request: SupportDetail) => { setCompose(false); setSelected(request.id); setNotice(zh ? "已保存到请求记录。" : "Saved to the request."); };
  if (capError || !role) return <div className="space-y-3"><p role={capError ? "alert" : "status"} className="text-sm text-secondary">{capError ? (zh ? "无法读取账户权限，请联网后重试。" : "Could not read account permissions. Connect and retry.") : (zh ? "读取账户…" : "Loading account…")}</p>{capError ? <button type="button" className={supportButtonClass} onClick={() => setCapAttempt(n => n + 1)}>{zh ? "重试" : "Retry"}</button> : null}{onBack ? <button type="button" className={supportButtonClass} onClick={onBack}>{zh ? "返回帮助" : "Back to help"}</button> : null}</div>;
  const readFeedback = <>
    {page.loading ? <p role="status" className="text-sm text-secondary">{zh ? "读取请求…" : "Loading requests…"}</p> : null}
    {page.error ? <SupportLoadError error={page.error} retry={page.reload} zh={zh} /> : null}
  </>;
  return <section className="space-y-4" aria-label={zh ? "请求与帮助" : "Requests and help"}>
    {!selected && !compose && onBack ? <button type="button" className="btn-ghost inline-flex min-h-11 items-center gap-2 text-sm" onClick={onBack}><ArrowLeft size={16} />{zh ? "返回帮助" : "Back to help"}</button> : null}
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">{compose ? (zh ? "写请求" : "Write a request") : selected ? (zh ? "请求详情" : "Request detail") : admin ? (zh ? "用户请求" : "User requests") : (zh ? "我的请求" : "My requests")}</h3>{!selected && !compose && !admin ? <button type="button" className="btn-primary min-h-11 px-4 text-sm" onClick={() => setCompose(true)}>{zh ? "写请求" : "Write a request"}</button> : null}</header>
    {notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}
    {compose && !admin ? <SupportRequestForm kind={initialKind} initialLimits={initialLimits} admin={false} capabilities={caps} buildDiagnostics={buildDiagnostics} onSaved={saved} onLeave={back} onDirtyChange={onDirtyChange} /> : selected ? <SupportRequestDetail key={selected} id={selected} admin={admin} caps={caps} onBack={back} onDirtyChange={onDirtyChange} buildDiagnostics={buildDiagnostics} onOpenUser={onOpenUser} /> : <>
      {drafts.length ? <details className="border-y border-ui"><summary className="min-h-11 cursor-pointer py-3 text-sm">{zh ? `本机草稿（${drafts.length}）` : `Drafts on this device (${drafts.length})`}</summary><ul className="divide-y divide-[var(--border)]">{drafts.map(row => <li key={row.key}><button type="button" className="min-h-11 w-full break-words py-3 text-left text-sm text-accent" onClick={() => { if (row.key === supportDraftKey("new")) setCompose(true); else if (row.key.startsWith(supportDraftKey("reply:"))) open(row.key.slice(supportDraftKey("reply:").length)); }}>{row.value.title || (zh ? "未发送的回复" : "Unsent reply")}{row.value.flight ? (zh ? " · 提交待确认" : " · Awaiting confirmation") : ""}</button></li>)}</ul></details> : null}
      {draftError ? <p role="alert" className="text-sm text-secondary">{zh ? "未能读取本机草稿，请重新打开此页面。" : "Could not read local drafts. Reopen this panel."}</p> : null}
      <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-xs text-secondary">{zh ? "状态" : "Status"}<select aria-label={zh ? "状态" : "Status"} className={supportInputClass} value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">{zh ? "全部" : "All"}</option>{["OPEN", "WAITING", "APPROVED", "REJECTED", "RESOLVED", "WITHDRAWN", "IMPORTED"].map(s => <option key={s} value={s}>{supportStatusText(s, zh)}</option>)}</select></label><label className="min-w-0 flex-1 text-xs text-secondary">{zh ? "类型" : "Type"}<select aria-label={zh ? "类型" : "Type"} className={supportInputClass} value={kind} onChange={e => { setKind(e.target.value); setOffset(0); }}><option value="">{zh ? "全部" : "All"}</option>{(["LIMIT", "QUESTION", "ISSUE"] as const).map(k => <option key={k} value={k}>{supportKindText(k, zh)}</option>)}</select></label></div>
      {!page.data ? readFeedback : <>
        <ul className="divide-y divide-[var(--border)] border-y border-ui">{page.data.items.map(row => <li key={row.id}>
          <button type="button" data-support-request-id={row.id} onClick={() => open(row.id)} className="w-full space-y-2 rounded px-2 py-4 text-left hover:bg-subtle">
            <span className="block break-words text-sm font-medium">{row.title}</span>
            <span className="flex flex-wrap justify-between gap-2 text-xs text-secondary"><span>{supportKindText(row.kind, zh)} · {supportStatusText(row.status, zh)}</span><time>{new Date(row.updated_at).toLocaleDateString(resolvedLocale)}</time></span>
          </button>
        </li>)}</ul>
        {!page.data.items.length ? <p className="py-4 text-sm text-secondary">{zh ? "没有符合条件的请求。" : "No requests match these filters."}</p> : null}
        <SupportPagination offset={offset} total={page.data.total} size={15} onChange={setOffset} loading={page.loading} zh={zh} />
        {readFeedback}
        <button type="button" className={`${supportButtonClass} inline-flex items-center gap-2`} aria-disabled={page.loading} onClick={() => { if (!page.loading) page.reload(); }}><RefreshCw size={14} className={page.loading ? "motion-safe:animate-spin" : ""} />{zh ? "刷新" : "Refresh"}</button>
      </>}
    </>}
  </section>;
}

function SupportRequestDetail({ id, admin, caps, onBack, onDirtyChange, buildDiagnostics, onOpenUser }: { id: string; admin: boolean; caps: AccountCapabilities | null; onBack: () => void; onDirtyChange?: (dirty: boolean) => void; buildDiagnostics?: () => string; onOpenUser?: (id: string) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [offset, setOffset] = useState(0), [editing, setEditing] = useState(false), [draftAvailable, setDraftAvailable] = useState(false), [notice, setNotice] = useState("");
  const [limitDirty, setLimitDirty] = useState(false), { confirm } = useInteractionDialog();
  const updateLimitDirty = useCallback((dirty: boolean) => { setLimitDirty(dirty); onDirtyChange?.(dirty); }, [onDirtyChange]);
  const navigate = async (action: () => void) => { if (limitDirty && !(await confirm({ title: zh ? "放弃未保存的限额调整？" : "Discard unsaved limit changes?", confirmLabel: zh ? "放弃调整" : "Discard changes", danger: true }))) return; setLimitDirty(false); onDirtyChange?.(false); action(); };
  const resource = useSupportResource<SupportDetail>(`${supportInbox(admin)}/${id}?offset=${offset}&limit=20`);
  const [retained, setRetained] = useState<{ value: SupportDetail; epoch: number } | null>(null);
  useEffect(() => {
    if (inaccessible(resource.error)) setRetained(null);
    else if (resource.data) setRetained({ value: resource.data, epoch: authenticationGeneration() });
  }, [resource.data, resource.error]);
  useEffect(() => { let active = true; void readSupportDraft(supportDraftKey(`reply:${id}`)).then(draft => { if (active) setDraftAvailable(Boolean(draft)); }).catch(() => undefined); return () => { active = false; }; }, [id, editing]);
  const request = inaccessible(resource.error) ? null : resource.data ?? (retained?.epoch === authenticationGeneration() ? retained.value : null);
  const active = request && ["OPEN", "WAITING"].includes(request.status);
  return <div className="space-y-4">
    {!editing ? <button type="button" className="btn-ghost inline-flex min-h-11 items-center gap-2 text-sm" onClick={() => void navigate(onBack)}><ArrowLeft size={16} />{zh ? "返回请求列表" : "Back to requests"}</button> : null}
    {resource.error ? <SupportLoadError error={resource.error} retry={resource.reload} zh={zh} /> : null}
    {resource.loading ? <p role="status" className="text-sm text-secondary">{zh ? "刷新请求…" : "Refreshing request…"}</p> : null}
    {request ? <>
      <header className="space-y-2"><h4 className="break-words text-base font-semibold">{request.title}</h4><p className="text-xs text-secondary">{supportKindText(request.kind, zh)} · {supportStatusText(request.status, zh)}</p>{request.owner ? onOpenUser ? <button type="button" className="min-h-11 break-all text-left text-sm text-accent" disabled={editing} onClick={() => void navigate(() => onOpenUser(request.owner!.id))}>{[request.owner.name, request.owner.email].filter(Boolean).join(" · ")}</button> : <p className="break-all text-sm text-secondary">{[request.owner.name, request.owner.email].filter(Boolean).join(" · ")}</p> : null}</header>
      {request.kind === "LIMIT" ? <dl className="space-y-2 border-y border-ui py-3 text-sm">{(["import_size_mb", "merge_message_count"] as const).filter(name => request.requested_limits[name] != null).map(name => <div key={name} className="flex flex-wrap justify-between gap-2"><dt className="text-secondary">{name === "import_size_mb" ? (zh ? "单文件导入（MiB）" : "Import per file (MiB)") : (zh ? "合并消息数" : "Merged messages")}</dt><dd>{zh ? "申请 " : "Requested "}{request.requested_limits[name]} · {zh ? "当前生效 " : "Effective "}{request.limits.effective[name]}</dd></div>)}</dl> : null}
      <ol className="divide-y divide-[var(--border)] border-y border-ui">{request.messages.map(message => <li key={message.id} className="space-y-3 py-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-secondary"><span>{message.author_role === "ADMIN" ? (zh ? "管理员" : "Administrator") : (zh ? "用户" : "User")}</span><time>{new Date(message.created_at).toLocaleString(resolvedLocale)}</time></div><SupportMessageContent text={message.body} /><SupportMailStatus message={message} admin={admin} id={id} onChanged={resource.reload} /></li>)}</ol>
      {resource.error && request.message_offset !== offset ? <p role="status" className="text-xs text-secondary">{zh ? "新一页尚未载入，当前仍显示上一页回复。" : "The new page did not load. The previous reply page remains visible."}</p> : null}
      <SupportPagination offset={request.message_offset} total={request.message_total} size={20} onChange={next => { if (next === offset) resource.reload(); else setOffset(next); }} loading={resource.loading} zh={zh} />
      {request.status === "IMPORTED" ? <p className="text-xs text-secondary">{zh ? "这是备份恢复的历史记录，不会重新发送邮件或批准限额。" : "This restored history does not resend email or grant limits again."}</p> : null}
      {notice ? <p role="status" className="text-sm text-accent">{notice}</p> : null}
      {editing ? <SupportRequestForm request={request} admin={admin} capabilities={caps} buildDiagnostics={buildDiagnostics} onRefresh={resource.reload} onSaved={result => { setEditing(false); setOffset(Math.floor((result.message_total - 1) / 20) * 20); resource.reload(); setNotice(zh ? "处理已保存。" : "Your response was saved."); }} onLeave={() => setEditing(false)} onDirtyChange={onDirtyChange} /> : <div className="flex flex-wrap gap-2">{active || draftAvailable ? <button type="button" className="btn-primary min-h-11 px-4 text-sm" disabled={resource.loading || Boolean(resource.error)} onClick={() => void navigate(() => { setEditing(true); setNotice(""); })}>{draftAvailable ? (zh ? "继续草稿" : "Continue draft") : admin ? (zh ? "回复或处理" : "Reply or decide") : (zh ? "回复或撤回" : "Reply or withdraw")}</button> : null}<button type="button" className={supportButtonClass} disabled={resource.loading} onClick={resource.reload}>{zh ? "刷新回复" : "Refresh replies"}</button></div>}
      {admin && request.owner && !editing ? <SupportLimitEditor userId={request.owner.id} onChanged={resource.reload} onDirtyChange={updateLimitDirty} /> : null}
    </> : null}
  </div>;
}

function SupportMailStatus({ message, id, admin, onChanged }: { message: SupportDetail["messages"][number]; id: string; admin: boolean; onChanged: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), retryKey = useRef<string | null>(null);
  const label: Record<string, [string, string]> = { UNAVAILABLE: ["邮件不可用，内容已保存在站内", "Email unavailable; saved in the inbox"], QUEUED: ["邮件排队中", "Email queued"], SENDING: ["邮件发送中", "Sending email"], ACCEPTED: ["邮件服务已接收", "Accepted by the mail server"], FAILED: ["邮件发送失败", "Email failed"], UNKNOWN: ["邮件结果不确定，请以站内记录为准", "Email delivery uncertain; use the inbox record"] };
  if (!label[message.mail_state]) return null;
  const retry = async () => { setBusy(true); setError(null); retryKey.current ??= crypto.randomUUID(); const path = `${supportInbox(admin)}/${id}/messages/${message.id}/retry-mail`; try { await supportFetch(path, { path, method: "POST", key: retryKey.current, payload: {} }); retryKey.current = null; onChanged(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <div className="text-xs text-secondary"><p>{label[message.mail_state][zh ? 0 : 1]}</p>{message.can_retry_mail ? <button type="button" disabled={busy} className="min-h-11 text-accent" onClick={() => void retry()}>{zh ? "重试邮件通知" : "Retry email notification"}</button> : null}{error ? <p role="alert">{supportErrorText(error, zh)}</p> : null}</div>;
}

export function SupportLoadError({ error, retry, zh }: { error: unknown; retry: () => void; zh: boolean }) {
  const message = inaccessible(error) ? (zh ? "当前账户无法读取此请求，请返回列表确认或重新登录。" : "This request is unavailable to this account. Return to the list or sign in again.")
    : (zh ? "读取失败，请重试。已载入的记录仍保留。" : "Could not load the records. Retry; previously loaded records are retained.");
  return <div role="alert" className="space-y-2 border-l-2 border-[var(--callout-warning-border)] pl-3"><p className="text-sm">{message}</p><button type="button" className={supportButtonClass} onClick={retry}>{zh ? "重试" : "Retry"}</button></div>;
}
function SupportPagination({ offset, total, size, onChange, zh, loading = false }: { offset: number; total: number; size: number; onChange: (offset: number) => void; zh: boolean; loading?: boolean }) { return total > size ? <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={zh ? "请求分页" : "Request pagination"}><button type="button" className={supportButtonClass} disabled={loading || !offset} onClick={() => onChange(Math.max(0, offset - size))}>{zh ? "上一页" : "Previous"}</button><span className="text-xs text-secondary">{Math.min(offset + 1, total)}–{Math.min(offset + size, total)} / {total}</span><button type="button" className={supportButtonClass} disabled={loading || offset + size >= total} onClick={() => onChange(offset + size)}>{zh ? "下一页" : "Next"}</button></nav> : null; }
