"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useLayoutEffect } from "react";
import { deleteCleanupRule, getCleanupRuleRevisions, getCleanupRules, getPendingCleanupScans, scanExistingConversations, updateCleanupRule } from "../lib/api";
import { cleanupRuleLabel } from "../lib/content-cleanup";
import type { CleanupRuleRead } from "../lib/types";
import { CleanupExceptionList } from "./cleanup-exceptions";
import { CleanupRuleEditor } from "./cleanup-rule-editor";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function ContentCleanupRuleSettings({ embedded = false, onBack, onDirtyChange }: {
  embedded?: boolean; onBack?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const rules = useQuery({ queryKey: ["content-cleanup-rules"], queryFn: getCleanupRules, staleTime: 30_000 });
  const pending = useQuery({ queryKey: ["content-cleanup-pending"], queryFn: getPendingCleanupScans, refetchInterval: 5_000 });
  const [editor, setEditor] = useState<CleanupRuleRead | "new" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const scan = useMutation({ mutationFn: scanExistingConversations, onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
    setFeedback(zh ? "扫描已排队，可在任务中心继续审查。" : "Scan queued. Continue review from the task center.");
  } });
  const startScan = async () => {
    if (await confirm({ title: zh ? "扫描现有对话？" : "Scan existing conversations?", description: zh ? "扫描本人的全部活动对话，归档除外。后台扫描只生成候选，正文不变。" : "Scan all your active conversations, excluding archives. The background scan creates candidates; content stays unchanged.", confirmLabel: zh ? "开始后台扫描" : "Start background scan" })) scan.mutate();
  };
  const back = async () => {
    if (dirty && !await confirm({ title: zh ? "放弃未保存的规则？" : "Discard unsaved rule?", confirmLabel: zh ? "放弃草稿" : "Discard draft" })) return;
    setDirty(false); onDirtyChange?.(false); onBack?.();
  };
  return <section aria-label={zh ? "噪声规则库" : "Noise rule library"} className={embedded ? "min-h-0 space-y-4" : "space-y-4 rounded-xl border border-ui bg-surface p-4"}>
    <header className="space-y-3 border-b border-ui pb-4">
      {!embedded ? <h3 className="text-base font-semibold">{zh ? "噪声规则库" : "Noise rule library"}</h3> : null}

      <div className="flex flex-wrap gap-2">{onBack ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void back()}>{zh ? "返回清理审查" : "Back to cleanup review"}</button> : null}{!editor ? <><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setEditor("new")}>{zh ? "学习文本规则" : "Learn a text rule"}</button><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={scan.isPending} onClick={() => void startScan()}>{scan.isPending ? (zh ? "正在排队…" : "Queuing…") : (zh ? "扫描现有对话" : "Scan existing conversations")}</button></> : null}</div>
    </header>
    {editor ? <CleanupRuleEditor key={editor === "new" ? "new" : editor.id} rule={editor === "new" ? undefined : editor} onDirtyChange={setDirty} onDone={() => { setEditor(null); setDirty(false); }} /> : <>
      {rules.isLoading ? <p role="status">{zh ? "正在读取规则…" : "Loading rules…"}</p> : null}
      {rules.error ? <div role="alert"><p className="text-xs text-[var(--danger)]">{rules.error.message}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void rules.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {[false, true].map((builtin) => <section key={String(builtin)} className="space-y-2"><h3 className="text-sm font-semibold">{builtin ? (zh ? "内置规则" : "Built-in rules") : (zh ? "我的规则" : "My rules")}</h3><div className="divide-y divide-[var(--border)] border-y border-ui">{rules.data?.filter((rule) => (rule.kind === "BUILTIN") === builtin).map((rule) => <RuleRow key={rule.id} rule={rule} onEdit={() => setEditor(rule)} />)}{!rules.isLoading && !rules.error && !rules.data?.some((rule) => (rule.kind === "BUILTIN") === builtin) ? <p className="py-4 text-xs text-secondary">{zh ? "尚无规则。" : "No rules yet."}</p> : null}</div></section>)}
      <CleanupExceptionList />
    </>}
    {pending.data?.some((item) => ["QUEUED", "SCANNING"].includes(item.status)) ? <p role="status" className="text-xs text-secondary">{zh ? "后台扫描进行中。" : "A scan is running in the background."}</p> : null}
    {feedback ? <p role="status" className="text-xs text-secondary">{feedback}</p> : null}
    {scan.error ? <p role="alert" className="text-xs text-[var(--danger)]">{scan.error.message}</p> : null}
  </section>;
}

function RuleRow({ rule, onEdit }: { rule: CleanupRuleRead; onEdit: () => void }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const { confirm } = useInteractionDialog();
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState("");
  const history = useQuery({ queryKey: ["cleanup-rule-revisions", rule.id, offset], queryFn: () => getCleanupRuleRevisions(rule.id, offset), enabled: expanded });
  const update = useMutation({ mutationFn: () => updateCleanupRule(rule.id, { status: rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }); setFeedback(zh ? "个人设置已保存。" : "Personal setting saved."); } });
  const remove = useMutation({ mutationFn: () => deleteCleanupRule(rule.id), onSuccess: () => client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }) });
  const choose = useMutation({ mutationFn: (id: string) => updateCleanupRule(rule.id, { current_revision_id: id }), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }), client.invalidateQueries({ queryKey: ["cleanup-rule-revisions", rule.id] })]);
    setFeedback(zh ? "后续扫描使用所选版本，已有审查保持原版本。" : "Future scans use this version. Existing reviews keep their pinned version.");
  } });
  const selectVersion = async (revision: CleanupRuleRead) => {
    if (revision.revision_id && await confirm({ title: zh ? `使用版本 ${revision.revision}？` : `Use version ${revision.revision}?`, description: zh ? "后续扫描将使用此匹配配置；不会自动修改正文。" : "Future scans use this matching configuration. Content is not changed automatically.", confirmLabel: zh ? "使用此版本" : "Use this version" })) choose.mutate(revision.revision_id);
  };
  const deleteRule = async () => {
    if (await confirm({ title: zh ? "删除个人规则？" : "Delete personal rule?", description: zh ? "从你的列表移除并停止用于新扫描。已保存版本和进行中的审查保留；重新学习可恢复。" : "Remove it from your list and future scans. Saved versions and pending reviews remain; relearning restores the entry.", confirmLabel: zh ? "确认删除" : "Confirm delete", danger: true })) remove.mutate();
  };
  const busy = update.isPending || remove.isPending || choose.isPending;
  return <article className="space-y-2 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="min-h-11 min-w-0 flex-1 rounded-lg text-left text-sm font-medium hover:bg-subtle"><span className="break-words">{cleanupRuleLabel(rule.name, rule.detector_id, zh)}</span><span className="mt-1 block text-xs font-normal text-secondary">{rule.kind === "BUILTIN" ? (zh ? "内置" : "Built-in") : [rule.held ? (zh ? "已学习" : "Learned") : null, rule.system_provided ? (zh ? "系统提供" : "System provided") : null].filter(Boolean).join(" · ")} · v{rule.revision} · {rule.status === "ACTIVE" ? (zh ? "启用" : "Active") : (zh ? "停用" : "Disabled")}</span></button><button type="button" disabled={busy} onClick={() => update.mutate()} className="btn-secondary min-h-11 px-3 text-xs">{rule.status === "ACTIVE" ? (zh ? "个人停用" : "Disable for me") : (zh ? "个人启用" : "Enable for me")}</button></div>
    {expanded ? <div className="space-y-3 rounded-lg border border-ui p-3">{rule.kind !== "BUILTIN" ? <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={onEdit}>{zh ? "编辑并试运行" : "Edit and test"}</button><button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs text-[var(--danger)]" onClick={() => void deleteRule()}>{zh ? "删除规则" : "Delete rule"}</button></div> : null}
      {history.isLoading ? <p role="status">{zh ? "正在读取版本…" : "Loading versions…"}</p> : null}{history.data?.map((revision) => <div key={revision.revision_id ?? revision.revision} className="space-y-1 border-t border-ui pt-2 text-xs"><p className="font-medium">v{revision.revision} · {revision.role_filter ?? (zh ? "全部角色" : "All roles")} · {revision.matcher_mode} · {revision.boundary_mode}</p>{revision.match_value ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-subtle p-2">{revision.match_value}</pre> : null}{rule.kind !== "BUILTIN" ? <button type="button" disabled={busy || revision.revision_id === rule.revision_id} onClick={() => void selectVersion(revision)} className="btn-secondary min-h-11 px-3 text-xs">{revision.revision_id === rule.revision_id ? (zh ? "当前使用" : "Currently used") : (zh ? "使用此版本" : "Use this version")}</button> : null}</div>)}{offset > 0 || history.data?.length === 20 ? <div className="flex gap-2"><button type="button" disabled={!offset} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setOffset(offset - 20)}>{zh ? "较新版本" : "Newer"}</button><button type="button" disabled={history.data?.length !== 20} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => setOffset(offset + 20)}>{zh ? "更早版本" : "Older"}</button></div> : null}{history.error ? <div role="alert"><p>{history.error.message}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void history.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
    </div> : null}{feedback ? <p role="status" className="text-xs text-secondary">{feedback}</p> : null}{update.error || remove.error || choose.error ? <p role="alert" className="text-xs text-[var(--danger)]">{(update.error ?? remove.error ?? choose.error)?.message}</p> : null}</article>;
}
