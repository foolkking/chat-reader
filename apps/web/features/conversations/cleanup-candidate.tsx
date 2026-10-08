"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { CleanupOccurrenceRead } from "../../lib/types";

function contextExcerpt(text: string, before: boolean) {
  const characters = Array.from(text.replace(/\s+/g, " "));
  if (characters.length <= 64) return characters.join("");
  return before ? `…${characters.slice(-64).join("")}` : `${characters.slice(0, 64).join("")}…`;
}

export function CleanupCandidate({ item, zh, reason, selected, disabled, busy, showConversation, onDecision, onIntent, onLocate }: {
  item: CleanupOccurrenceRead; zh: boolean; reason: string; selected: boolean;
  showConversation: boolean;
  disabled: boolean; busy: boolean; onDecision: (selected: boolean) => void;
  onIntent: (kind: "ignore" | "learn") => void; onLocate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const protectedItem = item.decision === "PROTECTED" || item.evidence_codes?.includes("PROTECTED_RANGE");
  const canLearn = !item.stale && !["CONFLICT", "APPLIED"].includes(item.decision);
  const roles: Record<string, string> = { user: "用户", assistant: "助手", system: "系统", tool: "工具" };
  const role = zh ? (roles[item.role] ?? item.role) : item.role;
  return <article className="space-y-1 py-3">
    <label className="flex min-h-11 items-start gap-3">
      <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={selected} disabled={disabled}
        onChange={(event) => onDecision(event.target.checked)} aria-label={`${zh ? "处理" : "Process"} ${item.match_text}`} />
      <span className="min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
        <span className="text-secondary">{contextExcerpt(item.context_before, true)}</span>
        <mark data-testid="content-cleanup-match" className="whitespace-pre-wrap bg-[var(--mark-bg)] font-medium text-[var(--mark-text)]">{item.match_text}</mark>
        <span className="text-secondary">{contextExcerpt(item.context_after, false)}</span>
      </span>
    </label>
    <div className="pl-7">
      {showConversation ? <p className="break-words text-xs font-medium leading-5 text-primary">{item.conversation_title}</p> : null}
      <p className="break-words text-xs leading-5 text-secondary">{reason} · {role} · {zh ? "行" : "Line"} {item.line_start}</p>
      {protectedItem ? <p className="text-xs leading-5 text-[var(--color-semantic-warning)]">{zh ? "保护区：请返回源码编辑。" : "Protected content: edit the source instead."}</p> : null}
      {item.stale || item.decision === "CONFLICT" ? <p className="text-xs leading-5 text-[var(--danger)]">{zh ? "版本变化或无法安全处理；原文已保留，请重新扫描。" : "Version changed or removal is unsafe. Source retained; rescan to continue."}</p> : null}
      {item.decision === "APPLIED" ? <p className="text-xs leading-5 text-secondary">{zh ? "已完成，不会重复处理。" : "Completed; will not be applied again."}</p> : null}
      <button type="button" className="flex min-h-11 items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary"
        aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
        <ChevronDown className={`h-3.5 w-3.5 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        {zh ? "上下文与规则" : "Context and rules"}
      </button>
      {expanded ? <div id={detailsId} className="space-y-3 border-l-2 border-ui pl-3 pb-2">
        {!showConversation ? <p className="break-words text-xs font-medium text-primary">{item.conversation_title}</p> : null}
        <p data-testid="cleanup-context" className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]"><span className="text-secondary">{item.context_before}</span><mark className="bg-[var(--mark-bg)] font-medium text-[var(--mark-text)]">{item.match_text}</mark><span className="text-secondary">{item.context_after}</span></p>
        {selected ? <div className="rounded-md bg-subtle p-3 text-xs leading-5 text-secondary"><p className="mb-1 font-medium">{zh ? "删除后上下文" : "Context after removal"}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.context_before}{item.context_after}</p></div> : null}
        {canLearn ? <div className="flex flex-wrap gap-2">
          {item.detector_id !== "manual-selection-v1" && item.match_text.length <= 4096 ? <button type="button" disabled={busy} onClick={() => onIntent("ignore")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "以后忽略这种情况" : "Ignore this case in future"}</button> : null}
          {!protectedItem && item.match_text.length <= 500 ? <button type="button" disabled={busy} onClick={() => onIntent("learn")} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "记住此类噪声" : "Remember this noise"}</button> : null}
        </div> : null}
        {onLocate ? <button type="button" onClick={onLocate} className="min-h-11 text-xs font-medium text-accent underline">{zh ? "在正文中查看" : "Locate in reader"}</button> : null}
      </div> : null}
    </div>
  </article>;
}
