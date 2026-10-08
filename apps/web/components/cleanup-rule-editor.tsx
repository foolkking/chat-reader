"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { ApiRequestError, getCleanupRules, learnCleanupRule, trialCleanupRule } from "../lib/api";
import { authenticationGeneration } from "../lib/offline-access";
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
  const [baseEditToken, setBaseEditToken] = useState(rule?.edit_token ?? undefined);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [notice, setNotice] = useState(false);
  const [current, setCurrent] = useState<CleanupRuleRead | null>(null);
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const request = useRef<AbortController | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const trialButtonRef = useRef<HTMLButtonElement>(null);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const signal = () => { request.current?.abort(); request.current = new AbortController(); return request.current.signal; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const input: CleanupRuleTrialInput = { ...draft, rule_id: rule?.id, base_revision: baseRevision, base_revision_id: baseRevisionId, base_edit_token: baseEditToken, conversation_id: conversationId };
  const trial = useMutation({ mutationFn: (value: CleanupRuleTrialInput) => trialCleanupRule(value, signal()) });
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (trial.data) resultRef.current?.scrollIntoView({ block: "nearest" }); }, [trial.data]);
  const trialMatchesDraft = trial.data && JSON.stringify(trial.variables) === JSON.stringify(input);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || (!rule && Boolean(initialText)) || needsCheck;
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const finishSaved = async (saved: CleanupRuleRead) => {
    // Abort pre-save reads, acknowledge the committed response, then refresh
    // independently. A slow metadata read must not look like an unfinished save.
    await Promise.all([client.cancelQueries({ queryKey: ["content-cleanup-rules"] }), client.cancelQueries({ queryKey: ["cleanup-rule-revisions"] })]);
    if (!active()) return;
    client.setQueryData<CleanupRuleRead[]>(["content-cleanup-rules"], previous => previous
      ? (previous.some(item => item.id === saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]) : undefined);
    void client.invalidateQueries({ queryKey: ["content-cleanup-rules"] });
    void client.invalidateQueries({ queryKey: ["cleanup-rule-revisions"] });
    onDirtyChange?.(false); onDone(true);
  };
  const save = useMutation({ mutationFn: (value: CleanupRuleTrialInput) => learnCleanupRule(value, trial.data!.preview_token, signal()),
    onSuccess: saved => { if (active()) return finishSaved(saved); },
    onError: cause => { if (active() && !(cause instanceof ApiRequestError && [401, 403, 404, 409, 422].includes(cause.status))) setNeedsCheck(true); },
  });
  const read = useMutation({ mutationFn: () => getCleanupRules({ signal: signal() }), onSuccess: async rules => {
    if (!active()) return;
    const saved = rule ? rules.find(item => item.id === rule.id) : null;
    const matches = needsCheck && save.variables ? rules.find(item => (rule ? item.id === rule.id : item.revision_held)
      && sameConfiguration(item, save.variables!)) : null;
    if (matches) { await finishSaved(matches); return; }
    if (rule && !saved) throw new ApiRequestError("Rule unavailable", 404, "/api/content-cleanup/rules");
    setCurrent(saved ?? null); setNotice(needsCheck); setNeedsCheck(false); save.reset(); trial.reset();
  } });
  const readCurrent = () => { setCurrent(null); setNotice(false); trial.reset(); read.mutate(); };
  const cancel = async () => {
    if (dirty && !await confirm({ title: zh ? "放弃未保存的规则？" : "Discard this unsaved rule?", description: needsCheck ? (zh ? "保存结果尚未确认，关闭不会撤销服务器可能已保存的规则。" : "Save is unconfirmed. Closing does not undo a rule the server may already have saved.") : (zh ? "当前正文和已保存规则保持不变。" : "Current content and saved rules stay unchanged."), confirmLabel: zh ? "放弃草稿" : "Discard draft" })) return;
    onDirtyChange?.(false); onDone(false);
  };
  const busy = trial.isPending || save.isPending || read.isPending;
  const failure = read.error ?? trial.error ?? save.error;
  useLayoutEffect(() => { if (failure || current || notice || needsCheck) feedbackRef.current?.focus(); }, [failure, current, notice, needsCheck]);
  const unavailable = failure instanceof ApiRequestError && [401, 403, 404].includes(failure.status);
  const locked = busy || needsCheck || unavailable;
  const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-ui bg-page px-3 py-2 text-sm text-primary";
  const update = <K extends keyof CleanupRuleConfiguration>(key: K, value: CleanupRuleConfiguration[K]) => { setDraft(previous => ({ ...previous, [key]: value })); trial.reset(); setNotice(false); };
  return <section aria-label={zh ? "学习噪声规则" : "Learn noise rule"} className="space-y-4 rounded-lg border border-ui p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{rule ? (zh ? `编辑规则 · 基础版本 ${baseRevision}` : `Edit rule · base revision ${baseRevision}`) : (zh ? "记住此类噪声" : "Remember this noise")}</h3><button type="button" disabled={busy} onClick={() => void cancel()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "取消" : "Cancel"}</button></div>
    <p className="text-xs leading-5 text-secondary">{zh ? "先试运行，确认后保存为个人规则；后续扫描仍由你选择是否处理。" : "Test the rule, then confirm to save it for your account. You still choose what to remove in future scans."}</p>
    <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-secondary">{zh ? "规则名称" : "Rule name"}<input autoFocus maxLength={200} className={fieldClass} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label className="text-xs font-medium text-secondary">{zh ? "匹配角色" : "Message role"}<select className={fieldClass} value={draft.role_filter ?? ""} onChange={(event) => update("role_filter", event.target.value || null)}><option value="">{zh ? "全部角色" : "All roles"}</option>{Object.keys(roles).map((role) => <option key={role} value={role}>{zh ? roles[role] : role}</option>)}</select></label>
      <label className="text-xs font-medium text-secondary sm:col-span-2">{zh ? "匹配文本" : "Match text"}<textarea aria-label={zh ? "匹配文本" : "Match text"} rows={3} maxLength={500} className={fieldClass} value={draft.match_value} onChange={(event) => update("match_value", event.target.value)} /></label>
      <label className="text-xs font-medium text-secondary">{zh ? "匹配方式" : "Match mode"}<select className={fieldClass} value={draft.matcher_mode} onChange={(event) => update("matcher_mode", event.target.value as CleanupRuleConfiguration["matcher_mode"])}><option value="EXACT">{zh ? "精确匹配" : "Exact"}</option><option value="NORMALIZED">{zh ? "规范化匹配" : "Normalized"}</option><option value="APPROXIMATE">{zh ? "受限近似建议" : "Bounded approximate"}</option></select></label>
      <label className="text-xs font-medium text-secondary">{zh ? "文本边界" : "Text boundary"}<select className={fieldClass} value={draft.boundary_mode} onChange={(event) => update("boundary_mode", event.target.value as CleanupRuleConfiguration["boundary_mode"])}><option value="ANYWHERE">{zh ? "任意位置" : "Anywhere"}</option><option value="WHOLE_LINE">{zh ? "独占一行" : "Whole line"}</option><option value="BLOCK_END">{zh ? "消息末尾" : "End of message"}</option></select></label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={draft.case_sensitive} onChange={(event) => update("case_sensitive", event.target.checked)} />{zh ? "区分大小写" : "Case-sensitive"}</label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button ref={trialButtonRef} type="button" disabled={locked || !draft.name.trim() || !draft.match_value.trim()} onClick={() => { save.reset(); read.reset(); setNotice(false); trial.mutate(input); }} className="btn-secondary min-h-11 px-3 text-sm">{trial.isPending ? (zh ? "正在试运行…" : "Running trial…") : (zh ? "预览并试运行" : "Preview and test")}</button>{rule && !needsCheck ? <button type="button" disabled={busy} onClick={readCurrent} className="btn-secondary min-h-11 px-3 text-xs">{read.isPending ? (zh ? "正在读取…" : "Loading…") : (zh ? "比较服务器版本" : "Compare saved version")}</button> : null}</div>
    <div ref={feedbackRef} tabIndex={-1} className="space-y-3 outline-none">
      {failure ? <p role="alert" className="text-sm text-[var(--danger)]">{ruleError(failure, zh, read.isError ? "read" : save.isError ? "save" : "trial")}</p> : null}
      {needsCheck ? <button type="button" disabled={busy} onClick={readCurrent} className="btn-secondary min-h-11 px-3 text-sm">{read.isPending ? (zh ? "正在核对…" : "Checking…") : (zh ? "检查保存结果" : "Check save result")}</button> : null}
      {notice ? <p role="status" className="text-xs text-secondary">{zh ? "当前规则与本次提交不同。草稿已保留；请比较后重新试运行。" : "The current rule differs from your submission. Your draft is kept; review it and run another trial."}</p> : null}
      {current ? <section aria-label={zh ? "规则版本比较" : "Rule version comparison"} className="space-y-3 border-t border-ui pt-3">
        <p className="text-xs text-secondary">{zh ? `服务器当前使用版本 ${current.revision}；你的草稿尚未覆盖它。` : `Server currently uses revision ${current.revision}. Your draft has not replaced it.`}</p>
        <div className="divide-y divide-[var(--border)]">{fields.map(([key, cn, en]) => <div key={key} className="grid grid-cols-2 gap-2 py-3 text-xs sm:grid-cols-[7rem_1fr_1fr]">
          <h4 className="col-span-2 font-semibold text-primary sm:col-span-1">{zh ? cn : en}</h4>{[current, draft].map((value, index) => <div key={index} className="min-w-0"><p className="mb-1 text-secondary">{index ? (zh ? "你的草稿" : "Your draft") : (zh ? "服务器" : "Server")}</p><pre className={`max-h-36 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md bg-subtle p-2 font-sans leading-5 ${current[key] !== draft[key] ? "border-l-2 border-[var(--accent)]" : ""}`}>{displayField(key, value[key], zh)}</pre></div>)}
        </div>)}</div>
        <button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { setBaseRevision(current.revision); setBaseRevisionId(current.revision_id); setBaseEditToken(current.edit_token ?? undefined); setCurrent(null); setNotice(false); trial.reset(); save.reset(); read.reset(); requestAnimationFrame(() => trialButtonRef.current?.focus()); }}>{zh ? "保留草稿，以此版本重新试运行" : "Keep draft and use this base revision"}</button>
      </section> : null}
    </div>
    {trialMatchesDraft && trial.data ? <div ref={resultRef} className="space-y-3 border-t border-ui pt-3" aria-label={zh ? "规则试运行结果" : "Rule trial results"}>
      <p role="status" className="text-sm font-medium">{zh ? `试运行 ${trial.data.scanned_messages} 条消息 · ${trial.data.matches} 项命中 · ${trial.data.protected_matches} 项受保护` : `${trial.data.scanned_messages} messages tested · ${trial.data.matches} matches · ${trial.data.protected_matches} protected`}</p>
      <p className="text-xs leading-5 text-secondary">{zh ? `范围：${conversationId ? "当前对话" : "本人的活动对话"}。最多 ${trial.data.message_limit} 条、合计 ${trial.data.character_limit} 字符；单条超过 ${trial.data.message_character_limit} 字符会跳过。展示最多 10 项上下文。` : `Scope: ${conversationId ? "this conversation" : "your active conversations"}. Up to ${trial.data.message_limit} messages and ${trial.data.character_limit} characters; messages over ${trial.data.message_character_limit} characters are skipped. Up to 10 contexts shown.`}</p>
      {trial.data.limited ? <p className="text-xs text-[var(--warning)]">{zh ? `试运行范围受限，跳过 ${trial.data.skipped_messages} 条消息；保存后可从规则库发起完整后台扫描。` : `Limited trial; ${trial.data.skipped_messages} messages skipped. Start a full background scan from the rule library after saving.`}</p> : null}
      {trial.data.samples.map((sample, index) => <p key={index} className="whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 text-xs leading-5"><span className="text-secondary">{zh ? roles[sample.role] ?? sample.role : sample.role}{sample.protected ? (zh ? " · 保护区" : " · protected") : ""} · {sample.context_before}</span><mark className="bg-[var(--mark-bg)] text-[var(--mark-text)]">{sample.match_text}</mark><span className="text-secondary">{sample.context_after}</span></p>)}
      <button type="button" disabled={locked || save.isError} onClick={() => save.mutate(input)} className="btn-primary min-h-11 px-4 text-sm font-semibold">{save.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "确认保存个人规则" : "Confirm personal rule")}</button>
    </div> : null}
  </section>;
}

const roles: Record<string, string> = { user: "用户", assistant: "助手", system: "系统", tool: "工具" };
const fields = [["name", "规则名称", "Rule name"], ["match_value", "匹配文本", "Match text"],
  ["role_filter", "匹配角色", "Message role"], ["matcher_mode", "匹配方式", "Match mode"],
  ["boundary_mode", "文本边界", "Text boundary"], ["case_sensitive", "区分大小写", "Case-sensitive"]] as const;
function sameConfiguration(rule: CleanupRuleRead, input: CleanupRuleConfiguration) {
  return fields.every(([key]) => rule[key] === (key === "name" || key === "match_value" ? input[key].trim() : input[key]));
}
function displayField(key: keyof CleanupRuleConfiguration, value: unknown, zh: boolean) {
  if (key === "case_sensitive") return value ? (zh ? "是" : "Yes") : (zh ? "否" : "No");
  if (key === "role_filter") return value ? (zh ? roles[String(value)] ?? String(value) : String(value)) : (zh ? "全部角色" : "All roles");
  const labels: Record<string, string[]> = { EXACT: ["精确匹配", "Exact"], NORMALIZED: ["规范化匹配", "Normalized"], APPROXIMATE: ["受限近似建议", "Bounded approximate"], ANYWHERE: ["任意位置", "Anywhere"], WHOLE_LINE: ["独占一行", "Whole line"], BLOCK_END: ["消息末尾", "End of message"] };
  return ["matcher_mode", "boundary_mode"].includes(key) ? (labels[String(value)]?.[zh ? 0 : 1] ?? String(value)) : String(value ?? "");
}
function ruleError(error: Error, zh: boolean, phase: "read" | "save" | "trial") {
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return zh ? "此规则已不可用。草稿仍保留，请关闭后重新打开规则库。" : "This rule is unavailable. Your draft is kept; close and reopen the rule library.";
  if (phase === "read") return zh ? "读取失败，草稿已保留。请重试，尚未再次提交。" : "Read failed. Your draft is preserved. Retry; nothing was resubmitted.";
  if (error instanceof ApiRequestError && error.status === 409) return error.message.startsWith("Preview")
    ? (zh ? "试运行结果已过期，请重新试运行后确认。" : "Trial expired. Run another trial before confirming.")
    : (zh ? "规则已在其他窗口更改。草稿已保留，请比较服务器版本。" : "Rule changed on another device. Your draft is preserved; compare the saved version.");
  if (error instanceof ApiRequestError && error.status === 422) return zh ? "规则未被接受，请检查匹配文本和配置后重新试运行。" : "Rule was not accepted. Check its text and configuration, then run another trial.";
  return phase === "save" ? (zh ? "尚未确认保存结果。草稿已保留，请先检查保存结果。" : "Save is unconfirmed. Your draft is preserved; check the save result first.")
    : (zh ? "试运行失败，输入已保留，请重试。" : "Trial failed. Your input is preserved; retry.");
}
