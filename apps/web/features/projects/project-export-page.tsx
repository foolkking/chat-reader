"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";
import { useScopedSort } from "../../components/use-scoped-sort";
import { previewProjectExport, type ProjectExportScope } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import { useBatchExport } from "../conversations/use-batch-export";

export function ProjectExportPage({projectId}:{projectId:string}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const {conversationSortMode,conversationSortDirection,ready} = useScopedSort(`project:${projectId}`);
  const scope:ProjectExportScope={project_id:projectId,mode:"whole",sort:conversationSortMode,direction:conversationSortDirection};
  const queue=useBatchExport(zh,`whole:${projectId}`);
  const preview=useQuery({queryKey:["project-export-preview",projectId,scope.sort,scope.direction,authenticationGeneration()],
    enabled:ready,queryFn:({signal})=>previewProjectExport(scope,signal),retry:false,refetchOnWindowFocus:false});
  const r=preview.data, back=`/projects/${projectId}`;
  return <main className="h-full overflow-y-auto bg-page text-primary"><section className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
    <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-secondary hover:text-accent"><ArrowLeft aria-hidden="true" className="h-4 w-4"/>{zh?"返回项目":"Back to project"}</Link>
    <h1 className="my-3 text-xl font-semibold">{zh?"导出项目对话":"Export project conversations"}</h1>
    {preview.isError ? <div role="alert" className="text-sm">{zh?"未能核对项目，请重试或返回项目列表。":"Could not verify this project. Retry or return to the list."} <button className="min-h-11 text-accent underline" onClick={()=>void preview.refetch()}>{zh?"重试":"Retry"}</button></div>
      : !r ? <p role="status" className="text-sm text-secondary">{zh?"正在核对项目成员…":"Checking project membership…"}</p>
      : <div className="my-4 divide-y border-y border-ui">
        <div className="flex items-start justify-between gap-4 py-4">
          <div className="min-w-0"><h2 className="break-words font-semibold">{r.name}</h2><p className="mt-1 text-sm text-secondary">{zh?"仅活动对话，按项目当前排序；不含已归档对话。":"Active conversations in current project order. Archived conversations are excluded."}</p>
          {r.archived ? <p className="text-sm text-secondary">{zh?"项目本身已归档。":"The project itself is archived."}</p>:null}</div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{zh?`${r.count} 条`:`${r.count} chats`}</span>
        </div>
        <div className="py-4 text-sm text-secondary">{zh?"每条对话一个文件：包含当前正文、来源信息和附件名称；不包含附件原件、笔记、批注或项目结构。这不是可恢复的项目备份。":"One file per conversation: current text, source information and attachment names. No attachment files, notes, annotations or project structure. This is not a restorable project backup."}</div>
        <div className="py-4">{!r.count ? <p role="status">{zh?"项目里没有可导出的活动对话。":"There are no active conversations to export."}</p> :
          r.count>r.limit ? <p role="status">{zh?`单次最多 ${r.limit} 条。请返回项目，分批勾选导出。`:`Choose up to ${r.limit} at a time from the project list.`}</p> :
          <button type="button" disabled={queue.busy || preview.isFetching || queue.needsReview} onClick={()=>void queue.submit(r.active_ids,{...scope,reviewed:r.reviewed})}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-[var(--text)] px-4 py-2 text-left text-sm font-semibold text-[var(--surface)] disabled:opacity-50">
            <Download className="h-4 w-4 shrink-0" aria-hidden="true"/><span className="break-words">{zh?`导出《${r.name}》的 ${r.count} 条活动对话`:`Export ${r.count} active conversations from “${r.name}”`}</span>
          </button>}</div>
      </div>}
    {queue.feedback}
  </section></main>;
}
