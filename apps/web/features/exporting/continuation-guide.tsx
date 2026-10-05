"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import { useGuidanceSetting } from "../../components/use-guidance-setting";
import { ExportPanel } from "./export-panel";
import { OfflineExportPanel } from "./offline-export-panel";
import type { MaintenanceDismissal } from "./maintenance-hint";

// Explanation stays beside the actual files; no tutorial overlay or new modal.
export function ContinuationGuide({ conversationId, offline, initiallyOpen = false }: { conversationId: string; offline: boolean; initiallyOpen?: boolean }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const seen = useGuidanceSetting<boolean>("continuation-intro-v1");
  const reminders = useGuidanceSetting<MaintenanceDismissal>(`maintenance:${conversationId}`);
  const [open, setOpen] = useState(initiallyOpen);
  const [preparing, setPreparing] = useState(false);
  const started = useRef(false), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!seen.ready || started.current) return;
    started.current = true;
    if (!seen.value) setOpen(true);
    void seen.save(true).catch(() => undefined);
  }, [seen]);
  return <div className="border-b border-ui py-3" data-testid="continuation-guide">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button ref={trigger} type="button" aria-expanded={open} className="min-h-11 shrink-0 text-left text-sm text-secondary hover:text-primary" onClick={() => setOpen(v => !v)}>{zh ? "如何使用 Current / Index" : "How to use Current / Index"}</button>
      <button type="button" className="ml-auto min-h-11 shrink-0 whitespace-nowrap text-sm text-accent" aria-expanded={preparing} onClick={() => { setPreparing(v => !v); setOpen(true); }}>{preparing ? (zh ? "收起维护步骤" : "Hide maintenance steps") : (zh ? "准备维护" : "Prepare maintenance")}</button>
    </div>
    {open ? <section aria-label={zh ? "接续使用指引" : "Continuation guide"} className="relative py-2 pr-11">
      <button type="button" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭使用指引" : "Close continuation guide"} onClick={() => { started.current = true; setOpen(false); setPreparing(false); void seen.save(true).catch(() => undefined); trigger.current?.focus(); }}><X className="h-4 w-4" /></button>
      <div className="space-y-2 text-sm leading-6 text-secondary">
        <p><strong className="font-medium text-primary">Current</strong>{zh ? " 保存目标、已确认的结论和下一步。" : " keeps your goals, confirmed conclusions and next steps."}</p>
        <p><strong className="font-medium text-primary">Index</strong>{zh ? " 标记重要历史的位置，方便你和 AI 回看原文。" : " points you and AI to important parts of the original history."}</p>
        <p>{zh ? "维护它们能帮助 AI 更快接上长对话；短对话可以直接导出。" : "Maintaining these files helps AI resume long conversations. Short conversations can be exported directly."}</p>
        <ol className="list-decimal space-y-1 pl-5 pt-2"><li>{zh ? "下载当前上下文包。" : "Download the current Context Package."}</li><li>{zh ? "将包和维护 Skill 交给 AI，更新接续文件。" : "Give the package and maintenance Skill to AI to update the files."}</li><li>{zh ? "把结果拖回这里，或分别更新 Current / Index。" : "Drop the result here, or update Current / Index separately."}</li></ol>
        {reminders.value?.muted ? <button type="button" className="min-h-11 text-xs text-accent" onClick={() => void reminders.save({ index: null, messages: 0, characters: 0, muted: false }).catch(() => undefined)}>{zh ? "恢复此对话的维护提示" : "Restore maintenance suggestions for this conversation"}</button> : null}
      </div>
    </section> : null}
    {open && preparing ? <div className="pt-3" data-testid="maintenance-preparation">
      {offline ? <OfflineExportPanel conversationId={conversationId} maintenance /> : <ExportPanel conversationId={conversationId} selectedMessageIds={[]} compact maintenance />}
      <p className="mt-3 text-xs leading-5 text-secondary">{offline ? (zh ? "更新文件需要联网；也可以直接使用 AI 输出的新包。" : "Reconnect to update the files here, or use the new package from AI directly.") : (zh ? "AI 处理完成后，将新包拖入下方 Current / Index。" : "When AI finishes, drop its new package into Current / Index below.")}</p>
    </div> : null}
  </div>;
}
