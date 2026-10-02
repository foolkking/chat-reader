"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { getCleanupRuleRevisions, learnCleanupRule, trialCleanupRule } from "../lib/api";
import type { CleanupRuleConfiguration, CleanupRuleRead, CleanupRuleTrialInput } from "../lib/types";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

export function CleanupRuleEditor({ rule, initialText = "", initialRole = null, conversationId, onDone, onDirtyChange }: {
  rule?: CleanupRuleRead; initialText?: string; initialRole?: string | null; conversationId?: string;
  onDone: (saved: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const client = useQueryClient();
  const [initial] = useState<CleanupRuleConfiguration>(() => ({ name: rule?.name ?? "", match_value: rule?.match_value ?? initialText,
    case_sensitive: rule?.case_sensitive ?? true, role_filter: rule?.role_filter ?? initialRole,
    matcher_mode: (rule?.matcher_mode as CleanupRuleConfiguration["matcher_mode"]) ?? "EXACT",
    boundary_mode: (rule?.boundary_mode as CleanupRuleConfiguration["boundary_mode"]) ?? "ANYWHERE" }));
  const [draft, setDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(rule?.revision);
  const [baseRevisionId, setBaseRevisionId] = useState(rule?.revision_id);
  const [compare, setCompare] = useState(false);
  const current = useQuery({ queryKey: ["cleanup-rule-revisions", rule?.id, "comparison"], queryFn: () => getCleanupRuleRevisions(rule!.id), enabled: Boolean(rule) && compare });
  const input: CleanupRuleTrialInput = { ...draft, rule_id: rule?.id, base_revision: baseRevision, base_revision_id: baseRevisionId, conversation_id: conversationId };
  const trial = useMutation({ mutationFn: trialCleanupRule });
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (trial.data) resultRef.current?.scrollIntoView({ block: "nearest" }); }, [trial.data]);
  const trialMatchesDraft = trial.data && JSON.stringify(trial.variables) === JSON.stringify(input);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || (!rule && Boolean(initialText));
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = useMutation({ mutationFn: () => learnCleanupRule(input, trial.data!.preview_token), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["content-cleanup-rules"] }), client.invalidateQueries({ queryKey: ["cleanup-rule-revisions"] })]);
    onDirtyChange?.(false); onDone(true);
  } });
  const cancel = async () => {
    if (dirty && !await confirm({ title: zh ? "放弃未保存的规则？" : "Discard this unsaved rule?", description: zh ? "当前正文和已保存规则保持不变。" : "Current content and saved rules stay unchanged.", confirmLabel: zh ? "放弃草稿" : "Discard draft" })) return;
    onDirtyChange?.(false); onDone(false);
  };
  const busy = trial.isPending || save.isPending;
  const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-ui bg-page px-3 py-2 text-sm text-primary";
  const update = <K extends keyof CleanupRuleConfiguration>(key: K, value: CleanupRuleConfiguration[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  return <section aria-label={zh ? "学习噪声规则" : "Learn noise rule"} className="space-y-4 rounded-lg border border-ui p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{rule ? (zh ? `编辑规则 · 基础版本 ${baseRevision}` : `Edit rule · base revision ${baseRevision}`) : (zh ? "记住此类噪声" : "Remember this noise")}</h3><button type="button" disabled={busy} onClick={() => void cancel()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消" : "Cancel"}</button></div>
    <p className="text-xs leading-5 text-secondary">{zh ? "先确认匹配文本、角色与边界，再试运行。保存后只会在扫描中生成候选，仍需逐次审查。" : "Review the text, role and boundary, then run a trial. Saved rules generate scan candidates that still require review."}</p>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-secondary">{zh ? "规则名称" : "Rule name"}<input autoFocus maxLength={200} className={fieldClass} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label className="text-xs font-medium text-secondary">{zh ? "匹配角色" : "Message role"}<select className={fieldClass} value={draft.role_filter ?? ""} onChange={(event) => update("role_filter", event.target.value || null)}><option value="">{zh ? "全部角色" : "All roles"}</option>{["user", "assistant", "system", "tool"].map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      <label className="text-xs font-medium text-secondary sm:col-span-2">{zh ? "匹配文本" : "Match text"}<textarea rows={3} maxLength={500} className={fieldClass} value={draft.match_value} onChange={(event) => update("match_value", event.target.value)} /></label>
      <label className="text-xs font-medium text-secondary">{zh ? "匹配方式" : "Match mode"}<select className={fieldClass} value={draft.matcher_mode} onChange={(event) => update("matcher_mode", event.target.value as CleanupRuleConfiguration["matcher_mode"])}><option value="EXACT">{zh ? "精确匹配" : "Exact"}</option><option value="NORMALIZED">{zh ? "规范化匹配" : "Normalized"}</option><option value="APPROXIMATE">{zh ? "受限近似建议" : "Bounded approximate"}</option></select></label>
      <label className="text-xs font-medium text-secondary">{zh ? "文本边界" : "Text boundary"}<select className={fieldClass} value={draft.boundary_mode} onChange={(event) => update("boundary_mode", event.target.value as CleanupRuleConfiguration["boundary_mode"])}><option value="ANYWHERE">{zh ? "任意位置" : "Anywhere"}</option><option value="WHOLE_LINE">{zh ? "独占一行" : "Whole line"}</option><option value="BLOCK_END">{zh ? "消息末尾" : "End of message"}</option></select></label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={draft.case_sensitive} onChange={(event) => update("case_sensitive", event.target.checked)} />{zh ? "区分大小写" : "Case-sensitive"}</label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !draft.name.trim() || !draft.match_value.trim()} onClick={() => trial.mutate(input)} className="btn-secondary min-h-11 px-3 text-sm">{trial.isPending ? (zh ? "正在试运行…" : "Running trial…") : (zh ? "预览并试运行" : "Preview and test")}</button>{rule ? <button type="button" disabled={busy} onClick={() => { setCompare(true); void current.refetch(); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "比较服务器版本" : "Compare saved version"}</button> : null}</div>
    {compare ? <div className="space-y-2 border-t border-ui pt-3"><p className="text-xs text-secondary">{zh ? "你的草稿保留在上方。以下是服务器当前版本。" : "Your draft remains above. The current saved version is below."}</p>{current.isLoading ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}{current.error ? <p role="alert">{current.error.message}</p> : null}{current.data?.[0] ? <><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 text-xs">{JSON.stringify({ revision: current.data[0].revision, text: current.data[0].match_value, role: current.data[0].role_filter, mode: current.data[0].matcher_mode, boundary: current.data[0].boundary_mode, case_sensitive: current.data[0].case_sensitive }, null, 2)}</pre><button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { setBaseRevision(current.data![0].revision); setBaseRevisionId(current.data![0].revision_id); trial.reset(); }}>{zh ? "保留草稿，以此版本重新试运行" : "Keep draft and use this base revision"}</button></> : null}</div> : null}
    {trialMatchesDraft && trial.data ? <div ref={resultRef} className="space-y-3 border-t border-ui pt-3" aria-label={zh ? "规则试运行结果" : "Rule trial results"}>
      <p role="status" className="text-sm font-medium">{zh ? `试运行 ${trial.data.scanned_messages} 条消息 · ${trial.data.matches} 项命中 · ${trial.data.protected_matches} 项受保护` : `${trial.data.scanned_messages} messages tested · ${trial.data.matches} matches · ${trial.data.protected_matches} protected`}</p>
      <p className="text-xs leading-5 text-secondary">{zh ? `范围：${conversationId ? "当前对话" : "本人的活动对话"}。最多 ${trial.data.message_limit} 条、合计 ${trial.data.character_limit} 字符；单条超过 ${trial.data.message_character_limit} 字符会跳过。展示最多 10 项上下文。` : `Scope: ${conversationId ? "this conversation" : "your active conversations"}. Up to ${trial.data.message_limit} messages and ${trial.data.character_limit} characters; messages over ${trial.data.message_character_limit} characters are skipped. Up to 10 contexts shown.`}</p>
      {trial.data.limited ? <p className="text-xs text-[var(--warning)]">{zh ? `试运行范围受限，跳过 ${trial.data.skipped_messages} 条消息；保存后可从规则库发起完整后台扫描。` : `Limited trial; ${trial.data.skipped_messages} messages skipped. Start a full background scan from the rule library after saving.`}</p> : null}
      {trial.data.samples.map((sample, index) => <p key={index} className="whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 text-xs leading-5"><span className="text-secondary">{sample.role}{sample.protected ? (zh ? " · 保护区" : " · protected") : ""} · {sample.context_before}</span><mark className="bg-[var(--warning-soft)] text-primary">{sample.match_text}</mark><span className="text-secondary">{sample.context_after}</span></p>)}
      <button type="button" disabled={busy} onClick={() => save.mutate()} className="btn-secondary min-h-11 px-4 text-sm font-semibold">{save.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "确认保存个人规则" : "Confirm personal rule")}</button>
    </div> : null}
    {trial.error || save.error ? <p role="alert" className="text-sm text-[var(--danger)]">{(trial.error ?? save.error)?.message}</p> : null}
  </section>;
}
