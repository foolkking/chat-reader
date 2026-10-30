"use client";
import { useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { usePreferences } from "./preferences-provider";

// Calm reading-desk layout: one flat list, existing ink/accent tokens, 4px scale.
export function QuickStartGuide({ onImport }: { onImport?: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="w-full text-left">
    <button ref={trigger} type="button" aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 text-sm text-accent" onClick={() => setOpen(v => !v)}>{zh ? "快速入门 · 3 步" : "Quick start · 3 steps"}<ArrowRight className="h-3.5 w-3.5" /></button>
    {open ? <section aria-label={zh ? "快速入门" : "Quick start"} className="relative border-y border-ui py-3 pr-11">
      <button type="button" aria-label={zh ? "关闭入门引导" : "Close quick start"} className="absolute right-0 top-1 flex h-11 w-11 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X className="h-4 w-4" /></button>
      <ol className="space-y-4 text-sm leading-6">
        {[
          [zh ? "导入对话" : "Import a conversation", zh ? "放入聊天记录；不支持的格式可借助转换 Skill。" : "Add a transcript. A conversion Skill can help with unsupported formats."],
          [zh ? "阅读与整理" : "Read and organize", zh ? "打开对话，搜索、批注，保留需要继续处理的内容。" : "Open a conversation, search and annotate what matters."],
          [zh ? "交给 AI 继续" : "Continue with AI", zh ? "从对话导出上下文包。历史较长时，可先维护 Current / Index。" : "Export a Context Package from the conversation. For long histories, maintain Current / Index first if helpful."],
        ].map(([title, body], index) => <li key={index} className="flex gap-3"><span className="mt-0.5 text-xs tabular-nums text-secondary">0{index + 1}</span><div><p className="font-medium text-primary">{title}</p><p className="text-secondary">{body}</p></div></li>)}
      </ol>
      {onImport ? <button type="button" className="btn-secondary mt-4 min-h-11 px-3 text-sm" onClick={() => { setOpen(false); onImport(); }}>{zh ? "开始导入" : "Start importing"}</button> : null}
    </section> : null}
  </div>;
}
