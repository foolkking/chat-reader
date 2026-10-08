"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteCleanupRule, getCleanupRuleRevisions, getCleanupRules, updateCleanupRule } from "../lib/api";
import { authenticationGeneration } from "../lib/offline-access";
import { cleanupRuleLabel } from "../lib/content-cleanup";
import type { CleanupRuleRead } from "../lib/types";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

type Operation = { kind: "status"; status: "ACTIVE" | "DISABLED" } | { kind: "version"; revisionId: string } | { kind: "remove" };

export function CleanupRuleRow({ rule, onEdit, onRemoved, unavailable }: {
  rule: CleanupRuleRead; onEdit: () => void; onRemoved: (id: string, name: string, focus: boolean, removed: boolean) => void; unavailable: boolean;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient(), { confirm } = useInteractionDialog();
  const [expanded, setExpanded] = useState(false), [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState(""), [needsCheck, setNeedsCheck] = useState(false);
  const root = useRef<HTMLElement>(null), recovery = useRef<HTMLDivElement>(null);
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const request = useRef<AbortController | null>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const signal = () => { request.current?.abort(); request.current = new AbortController(); return request.current.signal; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const historyKey = ["cleanup-rule-revisions", rule.id];
  const history = useQuery({ queryKey: [...historyKey, offset], queryFn: ({ signal }) => getCleanupRuleRevisions(rule.id, offset, signal), enabled: expanded, staleTime: 0, retry: false });
  const patchRow = (saved: CleanupRuleRead) => client.setQueryData<CleanupRuleRead[]>(["content-cleanup-rules"], previous => previous?.map(item => item.id === saved.id ? saved : item));
  const removeRow = (removed: boolean) => {
    const shouldFocus = Boolean(root.current?.contains(document.activeElement)) || document.activeElement === document.body;
    onRemoved(rule.id, cleanupRuleLabel(rule.name, rule.detector_id, zh), shouldFocus, removed);
    client.setQueryData<CleanupRuleRead[]>(["content-cleanup-rules"], previous => previous?.filter(item => item.id !== rule.id));
  };
  const successText = (op: Operation, saved?: CleanupRuleRead) => op.kind === "version"
    ? (zh ? `后续扫描使用版本 ${saved?.revision}，已有审查保持原版本。` : `Future scans use version ${saved?.revision}. Existing reviews keep their pinned version.`)
    : (zh ? `已${saved?.status === "ACTIVE" ? "启用" : "停用"}个人规则。` : `Personal rule ${saved?.status === "ACTIVE" ? "enabled" : "disabled"}.`);
  const invalidate = () => { void client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }); void client.invalidateQueries({ queryKey: historyKey }); };
  const mutation = useMutation<CleanupRuleRead | void, Error, Operation>({
    mutationFn: (op: Operation) => op.kind === "remove" ? deleteCleanupRule(rule.id, signal())
      : updateCleanupRule(rule.id, op.kind === "status" ? { status: op.status } : { current_revision_id: op.revisionId }, signal()),
    onSuccess: async (saved, op) => {
      await Promise.all([client.cancelQueries({ queryKey: ["content-cleanup-rules"] }), client.cancelQueries({ queryKey: historyKey })]);
      if (!active()) return;
      setNeedsCheck(false);
      if (op.kind === "remove") removeRow(true);
      else if (saved) { patchRow(saved); setFeedback(successText(op, saved)); }
      invalidate();
    },
    onError: () => { if (active()) { setNeedsCheck(true); setFeedback(""); } },
  });
  const check = useMutation({
    mutationFn: async () => { await client.cancelQueries({ queryKey: ["content-cleanup-rules"] }); return getCleanupRules({ signal: signal() }); },
    onSuccess: async rows => {
      if (!active()) return;
      const saved = rows.find(item => item.id === rule.id), op = mutation.variables;
      setNeedsCheck(false); mutation.reset();
      if (!saved) removeRow(op?.kind === "remove");
      else {
        const matches = op?.kind === "status" ? saved.status === op.status : op?.kind === "version" ? saved.revision_id === op.revisionId : false;
        setFeedback(matches && op ? successText(op, saved) : (zh ? "已读取当前设置，尚未满足刚才的操作。请检查后重新选择。" : "Current settings loaded; they do not match the requested change. Review them and choose again."));
      }
      client.setQueryData(["content-cleanup-rules"], rows);
      void client.invalidateQueries({ queryKey: historyKey });
    },
  });
  const busy = mutation.isPending || check.isPending;
  const blocked = busy || needsCheck || unavailable;
  const availability = useRef({ blocked, historyUnavailable: history.isError || history.isFetching });
  availability.current = { blocked, historyUnavailable: history.isError || history.isFetching };
  useEffect(() => { if (needsCheck) recovery.current?.focus({ preventScroll: true }); }, [needsCheck]);
  const run = (op: Operation) => { if (!active() || availability.current.blocked || (op.kind === "version" && availability.current.historyUnavailable)) return; setFeedback(""); check.reset(); mutation.mutate(op); };
  const selectVersion = async (revision: CleanupRuleRead) => {
    if (blocked || history.isError || history.isFetching || !revision.revision_id) return;
    if (await confirm({ title: zh ? `使用版本 ${revision.revision}？` : `Use version ${revision.revision}?`, description: zh ? "后续扫描将使用此匹配配置；不会自动修改正文。" : "Future scans use this matching configuration. Content is not changed automatically.", confirmLabel: zh ? "使用此版本" : "Use this version" })) run({ kind: "version", revisionId: revision.revision_id });
  };
  const remove = async () => {
    if (await confirm({ title: zh ? "删除个人规则？" : "Delete personal rule?", description: zh ? "从你的列表移除并停止用于新扫描。已保存版本和进行中的审查保留；重新学习可恢复。" : "Remove it from your list and future scans. Saved versions and pending reviews remain; relearning restores the entry.", confirmLabel: zh ? "确认删除" : "Confirm delete", danger: true })) run({ kind: "remove" });
  };
  const role = (value: string | null) => value ? (zh ? ({ user: "用户", assistant: "助手", system: "系统", tool: "工具" }[value] ?? value) : value) : (zh ? "全部角色" : "All roles");
  const mode = (value: string) => ({ EXACT: zh ? "精确匹配" : "Exact", NORMALIZED: zh ? "归一化匹配" : "Normalized", APPROXIMATE: zh ? "近似匹配" : "Approximate" }[value] ?? value);
  const boundary = (value: string) => ({ ANYWHERE: zh ? "任意位置" : "Anywhere", WHOLE_LINE: zh ? "独占一行" : "Whole line", BLOCK_END: zh ? "段落末尾" : "Block end" }[value] ?? value);
  return <article ref={root} data-rule-id={rule.id} className="space-y-2 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="min-h-11 min-w-0 flex-1 rounded-lg text-left text-sm font-medium hover:bg-subtle">
        <span className="break-words">{cleanupRuleLabel(rule.name, rule.detector_id, zh)}</span>
        <span className="mt-1 block text-xs font-normal text-secondary">{rule.kind === "BUILTIN" ? (zh ? "内置" : "Built-in") : [rule.held ? (zh ? "已学习" : "Learned") : null, rule.system_provided ? (zh ? "系统提供" : "System provided") : null].filter(Boolean).join(" · ")} · v{rule.revision} · {rule.status === "ACTIVE" ? (zh ? "启用" : "Active") : (zh ? "停用" : "Disabled")}</span>
      </button>
      <button type="button" disabled={blocked} onClick={() => run({ kind: "status", status: rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} className="btn-secondary min-h-11 px-3 text-xs">{rule.status === "ACTIVE" ? (zh ? "个人停用" : "Disable for me") : (zh ? "个人启用" : "Enable for me")}</button>
    </div>
    {mutation.isPending ? <p role="status" className="text-xs text-secondary">{mutation.variables?.kind === "remove" ? (zh ? "正在移除规则…" : "Removing rule…") : (zh ? "正在保存个人设置…" : "Saving personal settings…")}</p> : null}
    {feedback ? <p role="status" className="text-xs leading-5 text-secondary">{feedback}</p> : null}
    {needsCheck ? <div ref={recovery} tabIndex={-1} className="space-y-2 text-xs leading-5 outline-none">
      <p role="alert" className="text-[var(--danger)]">{check.isError ? (zh ? "核对失败，尚未确认操作结果。请检查连接后重试核对。" : "Check failed; the result is still unconfirmed. Check your connection and retry.") : (zh ? "尚未确认操作结果。请先核对，避免重复或反向修改。" : "The result is unconfirmed. Check it before repeating or reversing the change.")}</p>
      <button type="button" disabled={busy} className="btn-secondary min-h-11 px-3" onClick={() => check.mutate()}>{check.isPending ? (zh ? "正在核对…" : "Checking…") : (zh ? "检查操作结果" : "Check action result")}</button>
    </div> : null}
    {expanded ? <div className="space-y-3 rounded-lg border border-ui p-3">
      {rule.kind !== "BUILTIN" ? <div className="flex flex-wrap gap-2"><button type="button" disabled={blocked} className="btn-secondary min-h-11 px-3 text-xs" onClick={onEdit}>{zh ? "编辑并试运行" : "Edit and test"}</button><button type="button" disabled={blocked} className="btn-secondary min-h-11 px-3 text-xs text-[var(--danger)]" onClick={() => void remove()}>{zh ? "删除规则" : "Delete rule"}</button></div> : null}
      {history.isFetching ? <p role="status" className="text-xs text-secondary">{zh ? "正在读取版本…" : "Loading versions…"}</p> : null}
      {history.isError ? <div role="alert" className="text-xs leading-5 text-[var(--danger)]"><p>{zh ? "版本读取失败；下方是上次结果，暂时不能切换版本。" : "Versions could not load. Any entries below are from the previous read and cannot be selected yet."}</p><button type="button" disabled={history.isFetching} className="btn-secondary mt-2 min-h-11 px-3" onClick={() => void history.refetch()}>{zh ? "重试读取版本" : "Retry loading versions"}</button></div> : null}
      {history.data?.map(revision => <div key={revision.revision_id ?? revision.revision} className="space-y-2 border-t border-ui pt-3 text-xs">
        <p className="font-medium">v{revision.revision} · {role(revision.role_filter)} · {mode(revision.matcher_mode)} · {boundary(revision.boundary_mode)}{revision.case_sensitive ? (zh ? " · 区分大小写" : " · Case-sensitive") : ""}</p>
        {revision.match_value ? <pre tabIndex={0} aria-label={zh ? `版本 ${revision.revision} 匹配文本` : `Version ${revision.revision} match text`} className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 font-sans leading-5 [overflow-wrap:anywhere]">{revision.match_value}</pre> : null}
        {rule.kind !== "BUILTIN" ? <button type="button" disabled={blocked || history.isError || history.isFetching || revision.revision_id === rule.revision_id} onClick={() => void selectVersion(revision)} className="btn-secondary min-h-11 px-3 text-xs">{revision.revision_id === rule.revision_id ? (zh ? "当前使用" : "Currently used") : (zh ? "使用此版本" : "Use this version")}</button> : null}
      </div>)}
      {offset > 0 || history.data?.length === 20 ? <div className="flex gap-2"><button type="button" disabled={!offset || busy || history.isFetching} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setOffset(Math.max(0, offset - 20))}>{zh ? "较新版本" : "Newer"}</button><button type="button" disabled={busy || history.isError || history.isFetching || history.data?.length !== 20} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setOffset(offset + 20)}>{zh ? "更早版本" : "Older"}</button></div> : null}
    </div> : null}
  </article>;
}
