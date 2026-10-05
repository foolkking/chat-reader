"use client";

import { useQuery } from "@tanstack/react-query";
import { Clipboard, Download, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { resolveSkill } from "../../lib/api";

/** The same short handoff before upload and after a failed format analysis. */
export function FormatConversionGuide({ sourceName, resultAction }: { sourceName?: string; resultAction: ReactNode }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resolved = useQuery({ queryKey: ["resolved-skill", "CONVERSATION_RESCUE", zh ? "zh" : "en"], queryFn: () => resolveSkill("CONVERSATION_RESCUE", zh ? "zh-CN" : "en"), staleTime: 60_000 });
  const request = zh
    ? "请使用我提供的格式转换 Skill，将源对话整理为 ChatGPT Markdown Transcript Profile v1，输出可重新导入的 .md 文件。保留原有消息顺序和内容，不要总结、改写、补造或回答原对话。"
    : "Use the supplied format conversion Skill to produce a ChatGPT Markdown Transcript Profile v1 .md file for reimport. Preserve message order and content. Do not summarize, rewrite, invent, or answer the original conversation.";
  async function copy() {
    try {
      await navigator.clipboard.writeText(request);
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  }
  return <div className="space-y-4" data-testid="format-conversion-guide">
    {sourceName ? <p className="break-all text-xs text-secondary">{sourceName}</p> : null}
    <ol className="list-decimal space-y-5 pl-5 text-sm text-primary marker:text-secondary">
      <li className="pl-1">
        <p className="font-medium">{zh ? "下载格式转换 Skill" : "Download the format conversion Skill"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {resolved.data?.bundle_url ? <><a href={resolved.data.bundle_url} download className="btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm"><Download className="h-4 w-4" aria-hidden="true" />{zh ? "下载 Skill" : "Download skill"}</a><span className="min-w-0 break-all text-xs text-secondary">{resolved.data.name}</span></>
            : resolved.isError || (resolved.isSuccess && !resolved.data.bundle_url) ? <div role="alert" className="text-sm text-[var(--danger)]"><p>{zh ? "暂时无法获取首选 Skill。" : "Your preferred Skill could not be loaded."}</p><button type="button" className="min-h-11 underline" onClick={() => void resolved.refetch()}>{zh ? "重试" : "Retry"}</button></div>
              : <p role="status" className="text-sm text-secondary">{zh ? "正在获取 Skill…" : "Loading Skill…"}</p>}
        </div>
      </li>
      <li className="pl-1">
        <p className="font-medium">{zh ? "把源文件和 Skill 交给你使用的 AI" : "Give the source and Skill to your AI"}</p>
        <p className="mt-1 text-xs leading-5 text-secondary">{zh ? "请它整理为可导入的 Markdown，保留原文，不作总结。" : "Ask for importable Markdown that preserves the transcript without summarizing it."}</p>
        <button type="button" onClick={() => void copy()} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-accent"><Clipboard className="h-4 w-4" aria-hidden="true" />{zh ? "复制模板" : "Copy template"}</button>
        {copyState === "copied" ? <p role="status" className="text-xs text-secondary">{zh ? "已复制。" : "Copied."}</p> : null}
        {copyState === "failed" ? <div className="space-y-2"><p role="alert" className="text-xs text-[var(--danger)]">{zh ? "无法复制，请选中下方模板手动复制。" : "Could not copy. Select the template below and copy it manually."}</p><textarea readOnly aria-label={zh ? "转换请求模板" : "Conversion request template"} value={request} onFocus={event => event.currentTarget.select()} rows={5} className="w-full resize-y rounded-md border border-ui bg-surface p-3 text-sm leading-6 text-primary" /></div> : null}
      </li>
      <li className="pl-1"><p className="mb-2 font-medium">{zh ? "回来选择转换后的文件，再分析导入" : "Choose the converted file, then analyze and import"}</p>{resultAction}</li>
    </ol>
    <p className="text-xs leading-5 text-secondary">{zh ? "文件由你交给外部 AI，Chat Reader 不会自动发送或执行 Skill。" : "You provide files to your AI. Chat Reader does not send them or run the Skill."}</p>
  </div>;
}

export function FormatConversionDialog({ filename, onClose, onReplace }: { filename: string; onClose: () => void; onReplace: (file: File) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useDialogFocus({ open: true, rootRef, initialFocusRef: titleRef, onClose });
  return <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-4">
    <section className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl sm:rounded-xl">
      <header className="flex items-center justify-between gap-3 border-b border-ui px-5 py-3"><h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-base font-semibold text-primary outline-none">{zh ? "使用格式转换 Skill" : "Use format conversion Skill"}</h2><button type="button" onClick={onClose} aria-label={zh ? "关闭" : "Close"} className="btn-ghost flex h-11 w-11 shrink-0 items-center justify-center"><X className="h-4 w-4" aria-hidden="true" /></button></header>
      <div className="min-h-0 overflow-y-auto p-5"><FormatConversionGuide sourceName={filename} resultAction={<label className="btn-primary inline-flex min-h-11 cursor-pointer items-center px-3 focus-within:ring-2 focus-within:ring-[var(--focus)]">{zh ? "替换当前文件" : "Replace current file"}<input type="file" accept=".md,.markdown" className="sr-only" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onReplace(file); }} /></label>} /></div>
      <footer className="flex justify-end border-t border-ui px-5 py-3"><button type="button" className="btn-secondary min-h-11 px-4 text-sm" onClick={onClose}>{zh ? "稍后处理" : "Do this later"}</button></footer>
    </section>
  </div>;
}
