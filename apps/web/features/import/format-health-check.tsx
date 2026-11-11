"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, checkAdaptiveFamilyHealth } from "../../lib/api";
import type { AdaptiveImportFamily, AdaptiveImportSession, ImportFormatHealth } from "../../lib/types";
import { importErrorMessage, useImportCopy } from "./import-workspace-copy";

export function FormatHealthCheck({ session, family, disabled = false, onRepair, sessionAction }: {
  session: AdaptiveImportSession; family: AdaptiveImportFamily; disabled?: boolean; onRepair?: () => void;
  sessionAction?: { begin: () => number | null; finish: (token: number) => void; background?: (token: number) => void };
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const tr = useImportCopy();
  const queryClient = useQueryClient();
  const [failedOnly, setFailedOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const request = useRef<{ key: string; taskId?: string; controller: AbortController } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [stopped, setStopped] = useState(false);
  useEffect(() => () => { request.current?.controller.abort(); request.current = null; }, []);
  const queryKey = ["format-health", session.import_id, family.id];
  const saved = family.match_evidence.health_check as ImportFormatHealth | undefined;
  const result = useQuery<ImportFormatHealth>({ queryKey, enabled: false, initialData: saved });
  const check = useMutation({ mutationFn: () => {
    const token = sessionAction?.begin();
    if (token === null) return Promise.reject(new Error("Import session is busy"));
    const key = `${session.import_id}:${family.id}`;
    const previous = request.current?.key === key ? request.current.taskId : undefined;
    request.current?.controller.abort();
    const current = { key, taskId: previous, controller: new AbortController() };
    request.current = current;
    setWaiting(false);
    setStopped(false);
    return checkAdaptiveFamilyHealth(session.import_id, family.id, {
      taskId: previous, signal: current.controller.signal,
      onQueued: taskId => { current.taskId = taskId; if (token !== undefined) sessionAction?.background?.(token); },
      onTask: task => { if (request.current === current) {
        setWaiting(task.phase === "waiting_resources");
        setStopped(["failed", "cancelled"].includes(task.status));
      } },
    }).finally(() => { if (request.current === current && token !== undefined) sessionAction?.finish(token); });
  }, onSuccess: (data) => {
    request.current = null;
    queryClient.setQueryData(queryKey, data);
    setOffset(0);
  } });
  useEffect(() => { if (check.isSuccess) resultRef.current?.focus(); }, [check.isSuccess, check.submittedAt]);
  if (!family.matched_revision_id && !family.matched_profile_key) return null;
  const health = result.data;
  const failedCount = health?.groups.filter((group) => !group.valid).length ?? 0;
  const groups = (health?.groups ?? []).filter((group) => !failedOnly || !group.valid);
  const unconfirmed = stopped || (check.error instanceof ApiRequestError && check.error.code === "IMPORT_OPERATION_UNCONFIRMED");
  const canReadOriginal = request.current?.key === `${session.import_id}:${family.id}`
    && Boolean(request.current.taskId) && !stopped;
  const title = zh ? "格式健康检查" : "Format health check";
  return <section aria-label={title} className="mt-4 space-y-3 border-t border-ui pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium text-primary">{title}</p>
      <button type="button" onClick={() => check.mutate()} disabled={disabled || check.isPending || unconfirmed} className="btn-secondary min-h-11 px-3 text-xs">{check.isPending ? (zh ? "正在检查全部分组…" : "Checking every group…") : canReadOriginal ? (zh ? "继续查看检查结果" : "Continue reading check result") : (zh ? "检查已保存格式" : "Check saved format")}</button>
    </div>
    <p className="text-xs leading-5 text-secondary">{zh ? `使用已保存版本检查本次来源的全部 ${family.group_count} 组。结果只针对这批来源；检查不会保存新格式或导入对话。` : `Check all ${family.group_count} groups in this batch against the saved version. Results apply to these sources; checking does not save a format or import conversations.`}</p>
    {check.isPending ? <p role="status" className="text-xs text-secondary">{waiting
      ? (zh ? "等待服务器资源，系统会自动继续。原文件和旧结果保留，可以关闭窗口后在任务中心查看。" : "Waiting for server resources; processing will resume automatically. Sources and previous results are retained. You can close this window and check Tasks.")
      : (zh ? "检查中，旧结果保留。" : "Checking; previous results are retained.")}</p> : null}
    {check.isError ? <div role="alert" className="text-xs text-[var(--danger)]"><p>{importErrorMessage(check.error, tr, "read")}</p>{unconfirmed
      ? <button type="button" className="btn-secondary mt-2 min-h-11 px-3" onClick={() => window.dispatchEvent(new Event("chat-reader:open-task-center"))}>{zh ? "查看后台任务" : "View background tasks"}</button>
      : null}</div> : null}
    {health ? <div ref={resultRef} tabIndex={-1} className="space-y-3 outline-none" aria-label={zh ? "健康检查结果" : "Health check results"}>
      <p role="status" className={`text-sm font-medium ${health.valid ? "text-accent" : "text-[var(--warning)]"}`}>{health.valid ? (zh ? "全部分组通过" : "All groups passed") : (zh ? `${failedCount} 组需要处理` : `${failedCount} ${failedCount === 1 ? "group needs" : "groups need"} attention`)} · {health.revision ? `v${health.revision}` : (zh ? "内置" : "Built-in")}</p>
      <p className="text-xs text-secondary">{new Date(health.checked_at).toLocaleString(zh ? "zh-CN" : "en-US")} · {health.message_count} {zh ? "条消息已验证" : "messages validated"}</p>
      <label className="flex min-h-11 items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={failedOnly} onChange={(event) => { setFailedOnly(event.target.checked); setOffset(0); }} />{zh ? "只看失败组" : "Failed groups only"}</label>
      <div className="divide-y divide-[var(--border)]">{groups.slice(offset, offset + 20).map((group) => <div key={group.group_id} className="py-2 text-xs">
        <p className="break-words font-medium text-primary">{session.groups.find((item) => item.id === group.group_id)?.display_name ?? (zh ? "来源组" : "Source group")} · {group.valid ? (zh ? "通过" : "Passed") : (zh ? "失败" : "Failed")}</p>
        {group.issues.map((issue, index) => <p key={index} className="mt-1 break-words text-secondary">{issue.code}: {zh ? healthDiagnosticZh[issue.code] ?? issue.message : issue.message}{issue.pointer ? ` (${issue.pointer})` : ""}</p>)}
        {group.issues_truncated ? <p className="mt-1 text-secondary">{zh ? `共 ${group.issue_count} 项问题，仅展示前 100 项；完整分组已检查。` : `${group.issue_count} issues; only the first 100 are shown. The entire group was checked.`}</p> : null}
      </div>)}</div>
      {groups.length > 20 ? <nav aria-label={zh ? "检查结果分页" : "Health results pages"} className="flex items-center gap-3 text-xs"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))} className="btn-secondary min-h-11 px-3">{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + 20, groups.length)} / {groups.length}</span><button type="button" disabled={offset + 20 >= groups.length} onClick={() => setOffset(offset + 20)} className="btn-secondary min-h-11 px-3">{zh ? "下一页" : "Next"}</button></nav> : null}
      {!health.valid && onRepair ? <button type="button" disabled={disabled} onClick={onRepair} className="btn-secondary min-h-11 px-3 text-xs disabled:opacity-50">{zh ? "打开映射修复" : "Open mapping repair"}</button> : null}
    </div> : null}
  </section>;
}

const healthDiagnosticZh: Record<string, string> = {
  EMPTY_CONTENT: "有消息的正文为空，请选择正确的正文字段。",
  MINIMUM_MESSAGES: "对话中的消息数量不足，请检查消息列表映射。",
  ROLE_UNMAPPED: "有来源角色未映射，请补齐角色对应关系。",
  UNKNOWN_ROLE: "有消息的角色不符合导入要求。",
  SOURCE_MISSING: "来源文件已不可用，请重新选择文件。",
  SOURCE_UNAVAILABLE: "暂时无法读取来源，请重新选择文件后重试。",
  NORMALIZATION_FAILED: "这组来源无法使用当前映射解析，请检查映射。",
  MAPPING_SOURCE_MISMATCH: "来源文件类型与已保存的映射不一致。",
  RELATION_COUNT_MISMATCH: "JSON 和 Markdown 的消息数量不一致。",
};
