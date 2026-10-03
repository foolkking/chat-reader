"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { usePreferences } from "./preferences-provider";
import { offlineLeaseExpiresAt } from "../lib/auth-client";
import { assertOfflineAccess, captureOfflineAccess } from "../lib/offline-access";
import { getInitialOfflineShellStatus, inspectOfflineShell, subscribeOfflineShellStatus, type OfflineShellStatus } from "../lib/offline-shell";
import { buildRevision, diagnosticReport, type HelpInfo } from "../lib/help-diagnostics";
import { readCachedHelpInfo, refreshHelpInfo } from "../lib/help-status";

export function HelpPanel() {
  const preferences = usePreferences(), zh = preferences.resolvedLocale === "zh-CN";
  const [connection, setConnection] = useState<"checking" | "online" | "offline" | "unavailable">("checking");
  const [info, setInfo] = useState<HelpInfo | null>(null), [cached, setCached] = useState(true), [cacheFailed, setCacheFailed] = useState(false);
  const [shell, setShell] = useState<OfflineShellStatus>(getInitialOfflineShellStatus);
  const [busy, setBusy] = useState(false), [report, setReport] = useState(""), [copyStatus, setCopyStatus] = useState<"" | "copied" | "failed">("");
  const [lease, setLease] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null), reportRef = useRef<HTMLTextAreaElement>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setConnection(navigator.onLine ? "checking" : "offline"); setCached(true); setReport(""); setCopyStatus("");
    try {
      const ticket = captureOfflineAccess();
      const offlineResults = await Promise.allSettled([readCachedHelpInfo(), inspectOfflineShell()]);
      assertOfflineAccess(ticket); controller.signal.throwIfAborted();
      if (offlineResults[0].status === "fulfilled") setInfo(offlineResults[0].value);
      if (offlineResults[1].status === "fulfilled") setShell(offlineResults[1].value);
      const expires = offlineLeaseExpiresAt(); setLease(Number.isFinite(expires) ? expires : null);
      if (navigator.onLine) {
        const result = await refreshHelpInfo(controller.signal);
        assertOfflineAccess(ticket); controller.signal.throwIfAborted();
        setInfo(result.info); setCached(false); setCacheFailed(!result.saved); setConnection("online");
      }
    } catch {
      if (!controller.signal.aborted) setConnection(navigator.onLine ? "unavailable" : "offline");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const reload = () => { void refresh(); };
    window.addEventListener("online", reload); window.addEventListener("offline", reload);
    const unsubscribe = subscribeOfflineShellStatus(() => { void inspectOfflineShell().then(setShell).catch(() => undefined); });
    return () => { request.current?.abort(); window.removeEventListener("online", reload); window.removeEventListener("offline", reload); unsubscribe(); };
  }, [refresh]);
  const copy = async () => {
    try {
      captureOfflineAccess();
      const text = diagnosticReport({ connection, info, shell, preferences, leaseExpiresAt: lease, webRevision: process.env.NEXT_PUBLIC_BUILD_REVISION, cached });
      setReport(text); setCopyStatus("");
      try { await navigator.clipboard.writeText(text); setCopyStatus("copied"); }
      catch { setCopyStatus("failed"); requestAnimationFrame(() => { reportRef.current?.focus(); reportRef.current?.select(); }); }
    } catch { setReport(""); setCopyStatus("failed"); }
  };
  const unknown = zh ? "未知" : "Unknown", permission = (value: boolean | null | undefined) => value == null ? unknown : value ? (zh ? "允许" : "Allowed") : (zh ? "已关闭" : "Disabled");
  const revision = buildRevision(process.env.NEXT_PUBLIC_BUILD_REVISION), caps = info?.capabilities;
  const connectionText = { checking: zh ? "检查中…" : "Checking…", online: zh ? "已连接服务器" : "Connected to server", offline: zh ? "当前离线" : "Currently offline", unavailable: zh ? "无法连接或验证服务器" : "Server unavailable or unverified" };
  const shellText = { ready: zh ? "启动资源完整" : "Startup resources complete", unknown: zh ? "尚未确认完整性" : "Completeness not verified", unavailable: zh ? "启动资源不完整" : "Startup resources incomplete", unsupported: zh ? "当前浏览器不支持" : "Unsupported in this browser" };
  return <section aria-label={zh ? "帮助与诊断" : "Help & diagnostics"} className="space-y-6">
    <div><h3 className="mb-2 text-sm font-semibold">{zh ? "当前功能限制" : "Current feature limits"}{cached && info ? <span className="ml-2 text-xs font-normal text-secondary">{zh ? "上次已知" : "Last known"}</span> : null}</h3><dl className="divide-y divide-[var(--border)] border-y border-ui"><HelpRow label={zh ? "导入" : "Import"}>{permission(caps?.allow_user_import)}{caps?.maximum_import_size_mb != null ? ` · ${caps.maximum_import_size_mb} MiB` : ""}</HelpRow><HelpRow label={zh ? "合并消息上限" : "Merge message limit"}>{caps?.maximum_merge_message_count ?? unknown}</HelpRow><HelpRow label={zh ? "创建分享" : "Create shares"}>{permission(caps?.allow_share_links)}</HelpRow><HelpRow label={zh ? "公开分享 / 密码保护" : "Public sharing / Password protection"}>{permission(caps?.allow_public_share)} / {permission(caps?.allow_share_password)}</HelpRow><HelpRow label={zh ? "个人 Skill / 上传" : "Personal skills / Upload"}>{permission(caps?.allow_user_skills)} / {permission(caps?.allow_skill_import)}</HelpRow></dl>{cacheFailed ? <p className="mt-2 text-xs text-secondary">{zh ? "本次信息未能存到本机；离线时可能没有最新限制。" : "Could not save this snapshot locally. Offline limits may be outdated."}</p> : null}</div>
    <div><h3 className="mb-2 text-sm font-semibold">{zh ? "常见问题" : "Common questions"}</h3><div className="divide-y divide-[var(--border)] border-y border-ui">{[
      [zh ? "离线打不开或附件缺失？" : "Offline page or attachments missing?", zh ? "联网后进入“离线与同步”，检查副本及附件档位并重试下载。更新失败时会保留上一份已完成副本；仅缓存过的附件可离线打开。" : "Open Offline & sync when connected. Check the copy and attachment tier, then retry downloading. Failed updates keep the last completed copy. Only cached attachments open offline."],
      [zh ? "修改未同步或发生冲突？" : "Edits pending or conflicting?", zh ? "在“离线与同步”查看失败原因，重新登录后重试，或比较双方内容再决定保留、合并。清理本机资料前先处理待同步修改。" : "Check Offline & sync for the failure reason. Sign in and retry, or compare both versions before choosing or merging. Resolve pending edits before clearing local data."],
      [zh ? "分享和备份有什么区别？" : "How do sharing and backup differ?", zh ? "分享提供可撤销的访问链接；个人备份保存自己的资料供新增恢复，不包含登录凭据或有效分享令牌。归档用于整理对话，可在数据备份中包含归档内容。" : "Sharing provides revocable access links. Personal backup preserves your data for additive restore without credentials or active share tokens. Archived conversations can be included in a backup."],
    ].map(([question, answer]) => <details key={question}><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-primary">{question}</summary><p className="pb-4 text-sm leading-6 text-secondary">{answer}</p></details>)}</div></div>
    <div className="border-t border-ui pt-5"><h3 className="text-sm font-semibold">{zh ? "手动诊断" : "Manual diagnostics"}</h3><p className="mb-3 mt-1 text-xs text-secondary">{zh ? "仅复制脱敏状态，不会自动上传。" : "Copies redacted status. Nothing is uploaded."}</p><button type="button" className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm" disabled={busy} onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden="true" />{zh ? "生成并复制诊断" : "Generate & copy diagnostics"}</button>{copyStatus ? <p className="mt-2 text-sm text-secondary" role={copyStatus === "failed" ? "alert" : "status"}>{copyStatus === "copied" ? (zh ? "诊断已复制，可在下方检查内容。" : "Diagnostics copied. Review the content below.") : (zh ? "复制失败，可从下方文本手动复制。" : "Copy failed. Select and copy the text below.")}</p> : null}{report ? <label className="mt-3 block text-xs text-secondary">{zh ? "诊断文本" : "Diagnostic text"}<textarea ref={reportRef} readOnly value={report} spellCheck={false} className="mt-2 min-h-48 w-full rounded-md border border-ui bg-surface p-3 font-mono text-xs text-primary" /></label> : null}</div>
    <footer className="space-y-2 border-t border-ui pt-4 text-xs text-secondary" aria-label={zh ? "版本与离线可用范围" : "Version & offline availability"}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span>{connectionText[connection]}</span><button type="button" className="btn-ghost inline-flex min-h-11 items-center gap-2 px-3 text-xs" disabled={busy} onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "重新检查" : "Check again"}</button></div>
      <p className="break-words">{zh ? "网页构建" : "Web build"} {revision?.slice(0, 12) ?? unknown} · API {info?.app.api_version ?? unknown}{info?.app.revision ? ` · ${info.app.revision.slice(0, 12)}` : ""}</p>
      <p>{zh ? "离线启动：" : "Offline startup: "}<span>{shellText[shell.availability]}</span></p>
      <p>{zh ? "离线授权至：" : "Offline access until: "}{lease ? new Date(lease).toLocaleString(preferences.resolvedLocale) : unknown}</p>
    </footer>
  </section>;
}

function HelpRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"><dt className="text-secondary">{label}</dt><dd className="min-w-0 text-right text-primary">{children}</dd></div>;
}
