"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, useId, useMemo, useState } from "react";
import type { CleanupOccurrenceRead } from "../../lib/types";
import { candidateAfterText, candidateRemovalParts, fullCandidateRange } from "./cleanup-range-selection";

function contextExcerpt(text: string, before: boolean) {
  const characters = Array.from(text.replace(/\s+/g, " "));
  if (characters.length <= 64) return characters.join("");
  return before ? `…${characters.slice(-64).join("")}` : `${characters.slice(0, 64).join("")}…`;
}

const BUILTIN_DETECTOR_DESCRIPTIONS: Record<string, { zh: string; en: string }> = {
  "openai-private-citation-v1": {
    zh: "只匹配 ChatGPT 私有引用包裹及其稳定的 turn 引用；破损形式也只作为待审阅候选。",
    en: "Matches ChatGPT private citation envelopes and stable turn references; damaged forms remain review-only candidates.",
  },
  "openai-private-marker-v1": {
    zh: "匹配 ChatGPT 私有标记包裹，不把包裹内未知内容自动当作可删除文本。",
    en: "Matches ChatGPT private marker envelopes without treating unknown enclosed text as automatically removable.",
  },
  "visible-turn-citation-v1": {
    zh: "匹配可见的 cite/turn 引用序列，仅在规则允许的角色和边界内产生候选。",
    en: "Matches visible cite/turn reference sequences within the rule's role and boundary limits.",
  },
  "chatgpt-exporter-footer-v1": {
    zh: "匹配消息末尾完整的 ChatGPT Exporter 页脚，不匹配正文中间的同名普通文本。",
    en: "Matches the complete ChatGPT Exporter footer at the end of a message, not ordinary text in the body.",
  },
  "thinking-summary-v1": {
    zh: "默认关闭；启用后只匹配正文开头由时长行明确结束的摘要，候选仍需审阅后才能删除。",
    en: "Off by default. When enabled, matches only an opening summary ending with a duration marker; removal still requires review.",
  },
};

export function CleanupCandidate({ item, zh, reason, selected, disabled, busy, showConversation, selectionSaving = false, onDecision, onIntent, onLocate }: {
  item: CleanupOccurrenceRead; zh: boolean; reason: string; selected: boolean;
  showConversation: boolean; selectionSaving?: boolean;
  disabled: boolean; busy: boolean; onDecision: (selected: boolean) => void;
  onIntent: (kind: "ignore" | "learn" | "range") => void; onLocate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const stateId = `${detailsId}-state`;
  const protectedItem = item.decision === "PROTECTED" || Boolean(item.protection_types?.length)
    || item.evidence_codes?.some(code => code === "PROTECTED_RANGE" || code === "UNCERTAIN_CONTEXT");
  const actionable = (!protectedItem || item.protection_confirmed) && !item.stale && ["KEEP", "DELETE"].includes(item.decision);
  const canSelect = !item.stale && ["KEEP", "DELETE", "PROTECTED"].includes(item.decision);
  const marked = selected && actionable;
  const saving = selectionSaving && actionable;
  const refined = item.reviewed_ranges != null;
  const parts = useMemo(() => marked && refined ? candidateRemovalParts(item, item.reviewed_ranges!) : null, [marked, refined, item]);
  const invalidRefinement = marked && refined && !parts?.removed.length;
  const canLearn = !item.stale && !["CONFLICT", "APPLIED"].includes(item.decision);
  const roles: Record<string, string> = { user: "用户", assistant: "助手", system: "系统", tool: "工具" };
  const role = zh ? (roles[item.role] ?? item.role) : item.role;
  const kept = useMemo(() => marked && expanded
    ? (refined ? (invalidRefinement ? null : parts!.gaps.join("")) : candidateAfterText(item, fullCandidateRange(item)))
    : null, [marked, expanded, refined, invalidRefinement, parts, item]);
  const stateLabel = protectedItem && !item.protection_confirmed
    ? (zh ? "受保护，待确认" : "Protected; confirmation required")
    : item.decision === "APPLIED"
      ? (zh ? "已完成，不会重复处理" : "Completed; will not be applied again")
      : item.stale || item.decision === "CONFLICT"
        ? (zh ? "需重新扫描，原文已保留" : "Rescan required; source retained")
        : saving
          ? (zh ? "正在保存选择…" : "Saving choice…")
          : invalidRefinement
            ? (zh ? "范围无法预览，请调整或重新扫描" : "Ranges cannot be previewed; adjust or rescan")
            : marked
              ? (refined ? (zh ? `将删除 · 已调整为 ${parts!.removed.length} 处` : `Marked for deletion · ${parts!.removed.length} adjusted ranges`) : (protectedItem ? (zh ? "受保护 · 已确认待删除" : "Protected · confirmed for deletion") : (zh ? "将删除" : "Marked for deletion")))
              : (zh ? "保留" : "Kept");
  const match = (testId?: string) => marked && refined
    ? <span data-testid={testId} className="whitespace-pre-wrap">{parts?.removed.length ? <>{parts.removed.map((text, index) => <Fragment key={index}>{parts.gaps[index]}<mark data-cleanup-candidate-removal={index} className="bg-[var(--mark-bg)] font-medium text-[var(--mark-text)] line-through decoration-1">{text}</mark></Fragment>)}{parts.gaps[parts.removed.length]}</> : item.match_text}</span>
    : <mark data-testid={testId} data-cleanup-candidate-removal={marked ? 0 : undefined} className={`whitespace-pre-wrap bg-[var(--mark-bg)] font-medium text-[var(--mark-text)] ${marked ? "line-through decoration-1" : ""}`}>{item.match_text}</mark>;
  return <article className={`space-y-1 py-3 px-2 ${marked ? "bg-[var(--accent-soft)]" : ""}`}>
    <label className="flex min-h-11 items-start gap-3">
      <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={marked} disabled={disabled || !canSelect}
        onChange={(event) => onDecision(event.target.checked)} aria-label={`${zh ? "处理" : "Process"} ${item.match_text}`} aria-describedby={stateId} aria-busy={saving} />
      <span className="min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
        <span className="text-secondary">{contextExcerpt(item.context_before, true)}</span>
        {match("content-cleanup-match")}
        <span className="text-secondary">{contextExcerpt(item.context_after, false)}</span>
      </span>
    </label>
    <div className="pl-7">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p id={stateId} className={`text-xs font-medium ${marked ? "text-accent" : "text-secondary"}`}>{stateLabel}</p>
        {item.edit_token && actionable ? <button type="button" disabled={disabled} onClick={() => onIntent("range")} className="min-h-11 text-xs font-medium text-accent underline">{zh ? "调整删除范围" : "Adjust deletion ranges"}</button> : null}
      </div>
      {showConversation ? <p className="break-words text-xs font-medium leading-5 text-primary">{item.conversation_title}</p> : null}
      <p className="break-words text-xs leading-5 text-secondary">{reason} · {role} · {zh ? "行" : "Line"} {item.line_start}</p>
      <p className="break-words text-xs leading-5 text-secondary">{item.rule_name} · {zh ? "规则版本" : "Rule version"} {item.rule_revision ?? "—"} · {item.match_mode}</p>
      {protectedItem ? <p className="text-xs leading-5 text-[var(--color-semantic-warning)]">{item.protection_confirmed ? (zh ? "此扫描的匹配范围已确认；修改原文或重扫后需重新核对。" : "This scan's match was reviewed. Source edits or rescanning require a new review.") : (zh ? "涉及受保护结构、示例或不确定匹配。勾选后先确认；也可按规则组批量确认。" : "Protected structure, example or uncertain match. Select to review, or confirm a rule group together.")}</p> : null}
      {item.decision !== "APPLIED" && (item.stale || item.decision === "CONFLICT") ? <p className="text-xs leading-5 text-[var(--danger)]">{zh ? "版本变化或无法安全处理；原文已保留，请重新扫描。" : "Version changed or removal is unsafe. Source retained; rescan to continue."}</p> : null}
      {item.decision === "APPLIED" ? <p className="text-xs leading-5 text-secondary">{zh ? "已完成，不会重复处理。" : "Completed; will not be applied again."}</p> : null}
      <button type="button" className="flex min-h-11 items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary"
        aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
        <ChevronDown className={`h-3.5 w-3.5 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        {zh ? "上下文与规则" : "Context and rules"}
      </button>
      {expanded ? <div id={detailsId} className="space-y-3 border-l-2 border-ui pl-3 pb-2">
        {item.rule_settings ? <dl className="space-y-1 text-xs text-secondary">
          {item.detector_id && BUILTIN_DETECTOR_DESCRIPTIONS[item.detector_id] ? <div><dt className="inline font-medium">{zh ? "检测逻辑：" : "Detection logic: "}</dt><dd className="inline">{zh ? BUILTIN_DETECTOR_DESCRIPTIONS[item.detector_id].zh : BUILTIN_DETECTOR_DESCRIPTIONS[item.detector_id].en}</dd></div> : null}
          <div><dt className="inline font-medium">{zh ? "实际匹配文本：" : "Actual match text: "}</dt><dd className="inline whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.rule_settings.match_value ?? (zh ? "内置结构检测器（不是字面规则）" : "Built-in structural detector, not a literal rule")}</dd></div>
          <div><dt className="inline">{zh ? "设置：" : "Settings: "}</dt><dd className="inline">{item.rule_settings.matcher_mode} · {item.rule_settings.boundary_mode} · {item.rule_settings.role_filter ?? item.rule_settings.scope} · {item.rule_settings.case_sensitive ? (zh ? "区分大小写" : "case-sensitive") : (zh ? "忽略大小写" : "case-insensitive")}</dd></div>
          <div><dt className="inline">{zh ? "固定检测版本：" : "Pinned detector: "}</dt><dd className="inline">{item.rule_settings.matcher_version} · {item.rule_settings.normalization_profile}</dd></div>
        </dl> : null}
        {!showConversation ? <p className="break-words text-xs font-medium text-primary">{item.conversation_title}</p> : null}
        <p data-testid="cleanup-context" className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]"><span className="text-secondary">{item.context_before}</span>{match()}<span className="text-secondary">{item.context_after}</span></p>
        {marked ? <div className="rounded-md bg-subtle p-3 text-xs leading-5 text-secondary"><p className="mb-1 font-medium">{zh ? "删除后上下文" : "Context after removal"}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{kept === null ? (zh ? "范围无法预览，请调整或重新扫描。" : "Ranges cannot be previewed; adjust or rescan.") : `${item.context_before}${kept}${item.context_after}`}</p></div> : null}
        {canLearn ? <div className="flex flex-wrap gap-2">
          {item.detector_id !== "manual-selection-v1" && item.match_text.length <= 4096 ? <button type="button" disabled={busy} onClick={() => onIntent("ignore")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "以后忽略这种情况" : "Ignore this case in future"}</button> : null}
          {(item.rule_id && item.detector_id == null) || item.match_text.length <= 500 ? <button type="button" disabled={busy} onClick={() => onIntent("learn")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "查看／修改匹配规则" : "View / edit matching rule"}</button> : null}
        </div> : null}
        {onLocate ? <button type="button" onClick={onLocate} className="min-h-11 text-xs font-medium text-accent underline">{zh ? "在正文中查看" : "Locate in reader"}</button> : null}
      </div> : null}
    </div>
  </article>;
}
