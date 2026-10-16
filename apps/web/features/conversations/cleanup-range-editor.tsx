"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, getCleanupOccurrence, saveCleanupRanges } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { CleanupOccurrenceRead, CleanupRemovalRange } from "../../lib/types";
import { candidateAfterText, candidateSelectionSource, fullCandidateRange, mergeCandidateRanges } from "./cleanup-range-selection";

const sameRanges = (left: CleanupRemovalRange[], right: CleanupRemovalRange[]) =>
  left.length === right.length && left.every((range, index) => range.start_offset === right[index].start_offset && range.end_offset === right[index].end_offset);
const editable = (item: CleanupOccurrenceRead) => Boolean(item.edit_token && !item.stale
  && ["KEEP", "DELETE"].includes(item.decision) && !item.evidence_codes?.includes("PROTECTED_RANGE"));

export function CleanupRangeEditor({ scanId, item, onDone, onDirtyChange }: {
  scanId: string; item: CleanupOccurrenceRead;
  onDone: (saved: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const client = useQueryClient();
  const [base, setBase] = useState(item);
  const [draft, setDraft] = useState(() => item.reviewed_ranges ?? fullCandidateRange(item));
  const [selection, setSelection] = useState<CleanupRemovalRange | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [current, setCurrent] = useState<CleanupOccurrenceRead | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), source = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const lease = useRef(false);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const signal = () => { request.current?.abort(); request.current = new AbortController(); return request.current.signal; };
  useEffect(() => {
    mounted.current = true;
    heading.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]')?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  const id = useId();
  const selectedSource = useMemo(() => candidateSelectionSource(base.match_text), [base.match_text]);
  const sourceCharacters = useMemo(() => Array.from(base.match_text), [base.match_text]);
  const after = useMemo(() => candidateAfterText(base, draft), [base, draft]);
  const dirty = needsCheck || !sameRanges(draft, base.reviewed_ranges ?? fullCandidateRange(base));
  const finish = (saved: boolean) => { if (active()) { onDirtyChange?.(false); onDone(saved); } };
  const save = useMutation({
    mutationFn: (value: { base_edit_token: string; ranges: CleanupRemovalRange[] | null }) => {
      if (!active()) throw new Error("Range editor closed");
      return saveCleanupRanges(scanId, item.id, value, signal());
    },
    onSuccess: saved => {
      if (!active()) return;
      client.setQueryData(["content-cleanup-scan", scanId], saved);
      finish(true);
    },
    onError: () => { if (active()) { setNeedsCheck(true); setCurrent(null); } },
    onSettled: () => { lease.current = false; },
  });
  const read = useMutation({
    mutationFn: () => {
      if (!active()) throw new Error("Range editor closed");
      return getCleanupOccurrence(scanId, item.id, signal());
    },
    onSuccess: saved => { if (active()) setCurrent(saved); },
    onSettled: () => { lease.current = false; },
  });
  const busy = save.isPending || read.isPending;
  useEffect(() => { onDirtyChange?.(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const cancel = async () => {
    if (lease.current || !active()) return;
    if (dirty && !await confirm({
      title: zh ? "放弃未保存的删除范围？" : "Discard unsaved deletion ranges?",
      description: needsCheck
        ? (zh ? "关闭不会撤销服务器可能已保存的选择；正文尚未应用清理。" : "Closing does not undo choices the server may have saved. Cleanup has not been applied to the text.")
        : (zh ? "已保存的选择和正文不会改变。" : "Saved choices and source content stay unchanged."),
      confirmLabel: zh ? "放弃草稿" : "Discard draft",
    })) return;
    if (active() && !lease.current) finish(false);
  };
  const currentMatches = Boolean(current && editable(current) && current.decision === "DELETE"
    && current.message_version_id === base.message_version_id && current.match_text === base.match_text
    && sameRanges(current.reviewed_ranges ?? fullCandidateRange(current), draft));
  const canAdopt = Boolean(current && editable(current) && current.message_version_id === base.message_version_id
    && current.start_offset === base.start_offset && current.end_offset === base.end_offset && current.match_text === base.match_text);
  const locked = busy || needsCheck || !editable(base);
  const failure = read.error ?? save.error;
  const updateSelection = (element: HTMLTextAreaElement) => {
    const left = selectedSource.boundaries[element.selectionStart], right = selectedSource.boundaries[element.selectionEnd];
    setSelection(left != null && right != null && left < right ? {
      start_offset: base.start_offset + left, end_offset: base.start_offset + right,
    } : null);
  };
  const replace = (ranges: CleanupRemovalRange[]) => { setDraft(ranges); save.reset(); read.reset(); setCurrent(null); };
  return <section aria-label={zh ? "调整删除范围" : "Adjust deletion ranges"} className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">{zh ? "调整删除范围" : "Adjust deletion ranges"}</h3>
      <button type="button" disabled={busy} onClick={() => void cancel()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "返回候选" : "Back to candidates"}</button>
    </div>
    <p className="break-words text-xs text-secondary">{base.conversation_title} · {zh ? `行 ${base.line_start}` : `Line ${base.line_start}`}</p>
    <p id={`${id}-help`} className="text-sm leading-6 text-secondary">{zh
      ? "在候选中选择真正要删的文字，再选择“只删除选区”。可以继续加入其他选区，最多 20 处。只影响本次清理，不修改长期规则。"
      : "Select the actual noise, then choose Only remove selection. You can add more ranges, up to 20. This changes this review only, not future rules."}</p>
    <label htmlFor={`${id}-source`} className="block text-xs font-medium">{zh ? "扫描到的候选（可选择文字，不可改写原文）" : "Scanned candidate (select text; source is read-only)"}</label>
    <textarea ref={source} id={`${id}-source`} readOnly value={selectedSource.text} rows={5} aria-describedby={`${id}-help`}
      onSelect={event => updateSelection(event.currentTarget)}
      className="w-full resize-y rounded-md border border-ui bg-surface p-3 text-sm leading-6 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={locked || !selection} onClick={() => { if (selection) replace([selection]); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "只删除选区" : "Only remove selection"}</button>
      <button type="button" disabled={locked || !selection || mergeCandidateRanges([...draft, ...(selection ? [selection] : [])]).length > 20} onClick={() => { if (selection) replace(mergeCandidateRanges([...draft, selection])); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "加入删除范围" : "Add selection to removals"}</button>
      <button type="button" disabled={locked} onClick={() => replace(fullCandidateRange(base))} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "恢复整个候选" : "Use entire candidate"}</button>
    </div>
    <p role="status" className="text-xs text-secondary">{zh ? `待删除 ${draft.length} 处 · ${draft.reduce((count, range) => count + range.end_offset - range.start_offset, 0)} 个字符` : `${draft.length} removal ranges · ${draft.reduce((count, range) => count + range.end_offset - range.start_offset, 0)} characters`}</p>
    <ol className="divide-y divide-[var(--border)]">
      {draft.map((range, index) => <li key={`${range.start_offset}:${range.end_offset}`} className="flex items-start justify-between gap-3 py-2">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]"><span className="mr-2 text-xs text-secondary">{index + 1}.</span><mark className="bg-[var(--mark-bg)] text-[var(--mark-text)] line-through">{sourceCharacters.slice(range.start_offset - base.start_offset, range.end_offset - base.start_offset).join("")}</mark></p>
        <button type="button" disabled={locked} aria-label={zh ? `保留第 ${index + 1} 处` : `Keep range ${index + 1}`} onClick={() => replace(draft.filter((_, position) => position !== index))} className="btn-secondary min-h-11 shrink-0 px-3 text-xs">{zh ? "保留此处" : "Keep this part"}</button>
      </li>)}
    </ol>
    {!draft.length ? <p className="text-xs text-secondary">{zh ? "没有待删除片段。可以返回候选取消勾选，保留全部。" : "No removal ranges. Return and uncheck the candidate to keep it all."}</p> : null}
    <section aria-label={zh ? "调整后上下文" : "Context after adjustment"} className="space-y-1 border-t border-ui pt-3">
      <h4 className="text-xs font-semibold text-secondary">{zh ? "调整后上下文" : "Context after adjustment"}</h4>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words bg-subtle p-3 font-sans text-sm leading-6 [overflow-wrap:anywhere]">{after === null ? (zh ? "范围无效，请重新选择。" : "Invalid ranges. Select them again.") : `${base.context_before}${after}${base.context_after}`}</pre>
    </section>
    {!editable(base) ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "此候选不能安全调整，请返回重新扫描。" : "This candidate cannot be adjusted safely. Return and rescan."}</p> : null}
    {failure ? <p role="alert" className="text-sm text-[var(--danger)]">{read.isError
      ? (zh ? "无法读取保存状态。草稿仍保留，请重试读取。" : "Saved state could not load. Your draft is kept; retry the read.")
      : failure instanceof ApiRequestError && [401, 403, 404].includes(failure.status)
        ? (zh ? "此候选已不可用。草稿仍保留，请关闭后重新打开。" : "This candidate is unavailable. Your draft is kept; close and reopen the review.")
        : (zh ? "未确认范围保存结果。请先重新读取，核对后再继续；不会自动重发。" : "Range saving was not confirmed. Reload and review before continuing; the write will not be retried automatically.")}</p> : null}
    {current ? <div className="space-y-2 border-t border-ui pt-3">
      <p role="status" className="text-xs text-secondary">{currentMatches
        ? (zh ? "服务器当前选择与草稿一致，可使用此结果返回；这不代表已清理正文。" : "The saved choice matches your draft. You can return using it; source content has not been cleaned.")
        : (zh ? "服务器选择与草稿不同，草稿未被覆盖。请核对下面的当前范围。" : "The saved choice differs; your draft is kept. Review the current ranges below.")}</p>
      <p className="text-xs text-secondary">{current.decision === "DELETE" ? (zh ? "当前已选" : "Currently selected") : (zh ? "当前未选或不可处理" : "Currently unselected or unavailable")}</p>
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-subtle p-3 font-sans text-xs leading-5 [overflow-wrap:anywhere]">{(current.reviewed_ranges ?? fullCandidateRange(current)).map(range => Array.from(current.match_text).slice(range.start_offset - current.start_offset, range.end_offset - current.start_offset).join("")).join("\n\n")}</pre>
      {currentMatches ? <button type="button" disabled={busy} onClick={() => finish(true)} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "使用此结果返回" : "Return using this result"}</button> : null}
      {canAdopt && !currentMatches ? <button type="button" disabled={busy} onClick={() => { setBase(current!); setNeedsCheck(false); setCurrent(null); save.reset(); read.reset(); }} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "保留草稿，以当前选择为基础" : "Keep draft and use the current choice as base"}</button> : null}
      {!canAdopt ? <p className="text-xs text-[var(--danger)]">{zh ? "源版本或候选已变化，不能沿用此草稿。请返回重新扫描。" : "The source or candidate changed. Return and rescan instead of reusing this draft."}</p> : null}
    </div> : null}
    <div className="flex flex-wrap gap-2 border-t border-ui pt-3">
      {needsCheck ? <button type="button" disabled={busy} onClick={() => { if (lease.current || !active()) return; lease.current = true; setCurrent(null); read.mutate(); }} className="btn-secondary min-h-11 px-3 text-sm">{read.isPending ? (zh ? "正在读取…" : "Loading…") : (zh ? "重新读取保存范围" : "Reload saved ranges")}</button> : null}
      <button type="button" disabled={locked || after === null || !draft.length || draft.length > 20} onClick={() => {
        if (lease.current || !active() || !base.edit_token) return;
        lease.current = true;
        save.mutate({ base_edit_token: base.edit_token, ranges: sameRanges(draft, fullCandidateRange(base)) ? null : draft });
      }} className="btn-primary min-h-11 px-3 text-sm font-semibold">{save.isPending ? (zh ? "正在保存范围…" : "Saving ranges…") : (zh ? "保存范围并选中" : "Save ranges and select")}</button>
    </div>
    <p className="text-xs text-secondary">{zh ? "保存后仍需预览并确认，正文才会改变。需要扩大范围或改写内容时，请使用 Markdown 源码编辑器。" : "Content changes only after preview and confirmation. Use the Markdown source editor to expand the range or rewrite content."}</p>
  </section>;
}
