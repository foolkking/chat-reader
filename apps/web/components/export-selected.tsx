"use client";
import { Download } from "lucide-react";

export function ExportSelected({count,zh,busy,disabled,onClick}:{count:number;zh:boolean;busy:boolean;disabled:boolean;onClick:()=>void}) {
  return <button type="button" disabled={busy || disabled || !count} onClick={onClick}
    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-ui bg-surface px-2.5 text-sm font-semibold text-accent hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50">
    <Download aria-hidden="true" className="h-4 w-4" />
    {busy ? (zh?"正在提交…":"Submitting…") : (zh?`导出所选 ${count} 条`:`Export ${count} selected`)}
  </button>;
}

export function ExportContents({zh}:{zh:boolean}) {
  return <details className="text-xs text-secondary"><summary className="inline-flex min-h-11 cursor-pointer items-center underline decoration-dotted underline-offset-4">{zh?"ZIP 包含什么？":"What’s in the ZIP?"}</summary>
    <p className="max-w-prose pb-2">{zh?"每个对话一个数据文件，含当前正文、来源信息和附件名称，不含附件原件、批注、笔记或项目结构。单条可解压后导入。":"One data file per conversation: current messages, source information and attachment names. No attachment files, annotations, notes or project structure. Extract a single file to import it."}</p></details>;
}
