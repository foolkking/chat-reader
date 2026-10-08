"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import type { CleanupPreviewItem } from "../../lib/types";

// Offsets use the canonical Python/Unicode code-point contract, not JS UTF-16.
// Only render markers if their exact removal reproduces the supplied after text.
function previewParts(item: CleanupPreviewItem) {
  const ranges = item.removed_ranges;
  if (item.conflict || !Array.isArray(ranges) || !ranges.length || ranges.length !== item.fragments) return null;
  const characters = Array.from(item.before);
  const gaps: string[] = [], removed: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (!range || typeof range !== "object") return null;
    const { start_offset: start, end_offset: end } = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end <= start || end > characters.length) return null;
    gaps.push(characters.slice(cursor, start).join(""));
    removed.push(characters.slice(start, end).join(""));
    cursor = end;
  }
  gaps.push(characters.slice(cursor).join(""));
  return gaps.join("") === item.after ? { gaps, removed } : null;
}

function revealWithin(box: HTMLElement | null, target: HTMLElement | null) {
  if (!box || !target) return;
  box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top
    - box.clientHeight / 2 + Math.min(target.getBoundingClientRect().height, box.clientHeight) / 2;
}

export function CleanupChangePreview({ item, zh }: { item: CleanupPreviewItem; zh: boolean }) {
  const parts = useMemo(() => previewParts(item), [item]);
  const [active, setActive] = useState(-1);
  const beforeRef = useRef<HTMLPreElement>(null), afterRef = useRef<HTMLPreElement>(null);
  const removedRefs = useRef<(HTMLElement | null)[]>([]), afterRefs = useRef<(HTMLElement | null)[]>([]);
  const roles: Record<string, string> = { user: "用户", assistant: "助手", system: "系统", tool: "工具" };
  const count = parts?.removed.length ?? 0;
  const locate = (index: number) => {
    setActive(index);
    revealWithin(beforeRef.current, removedRefs.current[index]);
    revealWithin(afterRef.current, afterRefs.current[index]);
  };
  const beforeLabel = zh ? "修改前（完整正文）" : "Before (complete text)";
  const afterLabel = zh ? "修改后（完整正文）" : "After (complete text)";
  const textClass = "max-h-40 md:max-h-72 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg border border-ui bg-subtle p-3 text-xs leading-5";
  return <article className="space-y-2 border-t border-ui py-3">
    <h3 className="break-words text-sm font-medium text-primary">{item.conversation_title} · {zh ? (roles[item.role] ?? item.role) : item.role}</h3>
    {item.conflict ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "源版本变化或删除不安全；此消息会保留原文，请重新扫描。" : "Source changed or removal is unsafe. This message stays unchanged; rescan it."}</p> : null}
    {parts ? <div className="flex flex-wrap items-center justify-between gap-2">
      <span role="status" className="text-xs text-secondary">{active < 0 ? (zh ? `将删除 ${count} 处，已在原文标出` : `${count} removals marked in the original`) : (zh ? `第 ${active + 1} / ${count} 处删除` : `Removal ${active + 1} / ${count}`)}</span>
      <div className="flex gap-2">{count > 1 ? <button type="button" disabled={active <= 0} onClick={() => locate(active - 1)} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "上一处删除" : "Previous removal"}</button> : null}<button type="button" disabled={count > 1 && active >= count - 1} onClick={() => locate(count === 1 ? 0 : active + 1)} className="btn-secondary min-h-11 px-3 text-xs">{count === 1 ? (zh ? "定位删除片段" : "Locate removal") : (zh ? "下一处删除" : "Next removal")}</button></div>
    </div> : null}
    <div className="grid gap-3 md:grid-cols-2">
      <div className="min-w-0"><h4 className="mb-1 text-xs font-semibold text-secondary">{beforeLabel}</h4>
        <pre ref={beforeRef} tabIndex={0} aria-label={beforeLabel} data-testid="cleanup-diff-before" className={textClass}>{parts ? <>{parts.removed.map((text, index) => <Fragment key={index}>{parts.gaps[index]}<mark ref={(element) => { removedRefs.current[index] = element; }} data-cleanup-removal={index} data-active={active === index} className="bg-[var(--mark-bg)] text-[var(--mark-text)] line-through decoration-1 data-[active=true]:outline data-[active=true]:outline-1 data-[active=true]:outline-[var(--accent)]">{text}</mark></Fragment>)}{parts.gaps[count]}</> : item.before}</pre>
      </div>
      <div className="min-w-0"><h4 className="mb-1 text-xs font-semibold text-secondary">{afterLabel}</h4>
        <pre ref={afterRef} tabIndex={0} aria-label={afterLabel} data-testid="cleanup-diff-after" className={textClass}>{parts ? <>{parts.removed.map((_text, index) => <Fragment key={index}>{parts.gaps[index]}<span ref={(element) => { afterRefs.current[index] = element; }} aria-hidden="true" className={`inline-block h-[1em] w-0 align-text-bottom ${active === index ? "outline outline-1 outline-[var(--accent)]" : ""}`} /></Fragment>)}{parts.gaps[count]}</> : item.after}</pre>
      </div>
    </div>
  </article>;
}
