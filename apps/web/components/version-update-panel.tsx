"use client";

import { useEffect, useRef, useState } from "react";
import { usePreferences } from "./preferences-provider";
import { readAppInfo, type AppInfo } from "../lib/auth-client";
import { buildRevision } from "../lib/help-diagnostics";

type Job = { id: string; phase: string; action: string; reason?: string };
type Plan = { mode: "program" | "full"; roles?: ("api"|"web")[]; reason?: string; recovery_at?: string };
type State = { source: string; channel: string; current: string; revision: string; target?: string; target_id?: string; previous?: string; previous_id?: string; notes?: string; blocked?: string; job?: Job; archive_bytes?: number; prepared?: boolean; download_ms?: number; ready_ms?: number; preparation?: string; plan?: Plan; rollback_plan?: Plan; last_full_ms?: number };
type Action = "prepare" | "apply" | "rollback";
const finished = new Set(["prepared", "succeeded", "restored", "refused", "recovery_required"]);
const base = "/api/admin/updates";
const progress = "/__updates/";
async function request<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(base + path, { cache: "no-store", credentials: "same-origin", ...(data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
  if (!res.ok) throw new Error(String((await res.json().catch(() => ({}))).detail ?? res.status));
  return res.json();
}

export function VersionUpdatePanel() {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null), [monitor, setMonitor] = useState(false), [checked, setChecked] = useState(false);
  const locked = useRef(false);
  const [app, setApp] = useState<AppInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readAppInfo(controller.signal).then(info => { if (!controller.signal.aborted) setApp(info); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => { let live = true; request<State>("").then(v => { if (live) setState(v); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const preparing = !!state?.job && !finished.has(state.job.phase) && state.job.action === "prepare";
  useEffect(() => {
    if (!preparing) return;
    let live = true;
    const timer = window.setInterval(() => { request<State>("").then(v => {
      if (live) { setState(v); if (v.job && finished.has(v.job.phase)) setMonitor(false); }
    }).catch(() => { /* Progress remains independently available if the API goes away. */ }); }, 700);
    return () => { live = false; window.clearInterval(timer); };
  }, [preparing]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "UNCONFIRMED"); }
    finally { locked.current = false; setBusy(false); }
  };
  const copy = (cn: string, en: string) => zh ? cn : en;
  const check = () => run(async () => { setAction(null); setChecked(false); setState(await request<State>("/check", {})); setChecked(true); });
  const follow = async (id: string) => { await request("/ticket", { id }); setMonitor(true); };
  const start = (operation: Action) => run(async () => {
    if (!state) return;
    const target = operation === "rollback" ? state.previous_id : state.target_id;
    if (!target) return;
    const id = crypto.randomUUID().replaceAll("-", "");
    await follow(id); // Cookie receipt must reach the browser before the host may fence the application.
    let result: State;
    try { result = await request<State>("/" + operation, { id, expected: state.revision, target, ...(operation==="apply" && state.preparation ? {preparation:state.preparation} : {}) }); }
    catch (e) {
      if (e instanceof Error && (e.message === "UPDATE_STATE_CHANGED" || e.message === "FRESH_LOGIN_REQUIRED")) {
        setMonitor(false); setAction(null); setState(await request<State>(""));
      }
      throw e;
    }
    setAction(null); setState(result);
    if (operation !== "prepare") window.location.assign(progress);
    else if (result.job && finished.has(result.job.phase)) setMonitor(false);
  });
  const recovery = state?.job?.phase === "recovery_required";
  const ongoing = state?.job && !finished.has(state.job.phase);
  const cls = "btn-secondary min-h-11 px-3 text-sm";
  const webRevision = buildRevision(process.env.NEXT_PUBLIC_BUILD_REVISION)?.slice(0, 12);
  const apiRevision = buildRevision(app?.revision)?.slice(0, 12);
  const plan = action === "rollback" ? state?.rollback_plan : state?.plan;
  const reason = plan?.reason === "schema_change" ? copy("数据库结构需要迁移。","The database schema must be migrated.") :
    plan?.reason === "mutable_host" ? copy("实例尚未启用只读程序配置。","This instance has not enrolled its read-only program layout.") :
    plan?.reason === "different_baseline" ? copy("本实例不是兼容性测试的起始版本。","This is not the tested starting version.") :
    copy("此版本组合没有只改程序的验证记录。","There is no program-only proof for this version pair.");
  return <section aria-label={copy("版本更新", "Version updates")} className="grid min-w-0 gap-2 pb-4">
    <p className="break-words text-xs text-secondary">{copy("网页构建","Web build")} {webRevision ?? "—"} · API {app?.api_version ?? "—"}{apiRevision ? ` · ${apiRevision}` : ""}</p>
    {state && <p className="break-words text-xs text-secondary">{copy("当前", "Installed")}: {state.current === "legacy" ? state.revision.slice(0,12) : state.current} · {state.source} · {state.channel === "stable" ? copy("稳定版","Stable") : copy("含预览版","Includes previews")}</p>}
    {checked && !state?.target && <p role="status" className="text-sm">{copy("当前没有更高版本。","No newer release is available.")}</p>}
    {state?.target && <div className="text-sm"><p>{copy("可用版本","Available")}: <strong>{state.target}</strong>{!!state.archive_bytes && ` · ${(state.archive_bytes / 1048576).toFixed(1)} MiB`}</p>{state.notes && <details><summary className="cursor-pointer py-2 text-xs text-secondary">{copy("变更日志","Release notes")}</summary><p className="max-h-52 overflow-auto whitespace-pre-wrap break-words">{state.notes}</p></details>}</div>}
    {preparing && <p role="status" className="text-sm">{state?.job?.phase === "staging" ? copy("正在核验并预装镜像，当前服务在线。","Verifying and loading images. Your service stays online.") : copy("正在准备下载，当前服务在线。","Preparing the download. Your service stays online.")}</p>}
    {state?.prepared && !ongoing && <p role="status" className="text-sm">{copy("已就绪，可选择重启。","Ready. Restart when convenient.")} {copy("传输","Transfer")} {((state.download_ms ?? 0)/1000).toFixed(1)}s · {copy("含验证总计","Total with verification")} {((state.ready_ms ?? 0)/1000).toFixed(1)}s</p>}
    {state?.blocked && <p role="status" className="text-sm">{copy("此版本与当前数据库或扩展不兼容，不能升级。","This release is incompatible with the current database or extensions.")}</p>}
    {recovery && <p role="alert" className="text-sm">{copy("需人工恢复。保留现场和备份，不要降库或删除数据卷。","Manual recovery required. Preserve the instance and backups; do not downgrade or delete volumes.")}</p>}
    {error && <p role="alert" className="text-sm text-[var(--danger)]">{error === "FRESH_LOGIN_REQUIRED" ? copy("请重新登录根管理员账户，再确认此操作。","Sign in again as the root administrator before confirming.") : error === "UPDATER_UNAVAILABLE" ? copy("宿主机更新器未接入或暂不可用。现有部署不受影响。","The host updater is not connected or is unavailable. Your existing deployment is unaffected.") : monitor ? copy("操作结果未确认。先查看进度，不要再次提交。","Outcome unconfirmed. Check progress before submitting again.") : copy("无法确认更新状态，请重新检查。","Could not verify the update state. Check again.")}</p>}
    {monitor && <a href={progress} className="min-h-11 py-2 text-sm text-accent underline">{copy("查看独立更新进度","View independent update progress")}</a>}
    {action ? <div className="grid gap-2 rounded-md border border-ui p-3">
      <p className="text-sm">{action === "apply" ? copy("重启并切换到","Restart into") : copy("确认回滚到","Roll back to")} <strong>{action === "apply" ? state?.target : state?.previous}</strong>？</p>
      {plan?.mode === "program" ? <>
        <p className="text-sm"><strong>{copy("仅换程序","Program-only update")}</strong> · {plan.roles?.map(r => r === "api" ? "API" : "Web").join(" + ")}{copy("。不做本次全量备份，不停后台任务。进行中的请求可能延长切换时间。",". No new full backup and no worker restart. In-flight requests may extend the switch.")}</p>
        <p className="text-xs text-secondary">{copy("已验证的数据恢复点（不是此刻的副本）","Verified data recovery point (not a copy as of this click)")}: <time dateTime={plan.recovery_at}>{plan.recovery_at && new Date(plan.recovery_at).toLocaleString(zh ? "zh-CN":"en-US",{timeZoneName:"short"})}</time></p>
      </> : <p className="text-sm"><strong>{copy("完整维护","Full maintenance")}</strong> · {reason} {copy("将暂时停服并备份；不会还原旧数据库。","Service will pause for a backup. The database will not be restored to an older copy.")} {state?.last_full_ms ? copy(`上次完整操作约 ${Math.ceil(state.last_full_ms/60000)} 分钟，本次取决于数据量。`,`Last full operation: about ${Math.ceil(state.last_full_ms/60000)} min. This depends on data size.`) : copy("没有本机可比计时，请预留维护窗口。","No comparable host timing yet; allow a maintenance window.")}</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy || monitor} className="btn-primary min-h-11 px-3 text-sm" onClick={() => start(action)}>{copy("确认重启并查看进度","Confirm restart and view progress")}</button><button disabled={busy} className={cls} onClick={() => setAction(null)}>{copy("取消","Cancel")}</button></div>
    </div> : <div className="flex flex-wrap gap-2">
      <button className={cls} disabled={busy || !!ongoing || recovery} onClick={check}>{busy ? copy("正在核对…","Checking…") : copy("检查更新","Check for updates")}</button>
      {state?.target_id && !state.blocked && !ongoing && !recovery && !error && <button className={cls} onClick={() => state.prepared ? setAction("apply") : start("prepare")} disabled={busy}>{state.prepared ? copy("重启并升级…","Restart to upgrade…") : copy("下载并验证","Download and verify")}</button>}
      {state?.previous_id && !ongoing && !recovery && !error && <button className={cls} onClick={() => setAction("rollback")} disabled={busy}>{copy("回滚到","Roll back to")} {state.previous}…</button>}
      {state?.job && !monitor && <button className={cls} disabled={busy} onClick={() => run(async () => { await follow(state.job!.id); window.location.assign(progress); })}>{copy("查看最近更新进度","View last update progress")}</button>}
    </div>}
  </section>;
}
