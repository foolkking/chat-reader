"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queueConversationBatchExport } from "../../lib/api";
import { batchExportError } from "../../lib/batch-export-errors";
import { authenticationGeneration, OFFLINE_ACCESS_LOCKED_EVENT } from "../../lib/offline-access";
import type { BackgroundTaskRead } from "../../lib/types";

function openTasks() { window.dispatchEvent(new Event("chat-reader:open-task-center")); }

export function useBatchExport(zh: boolean) {
  const queryClient = useQueryClient();
  const pending = useRef<{ selection: string; key: string; generation: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<{ error?: string; generation: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    const lock = () => { request.current?.abort(); pending.current = null; setNotice(null); };
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock);
    return () => { mounted.current = false; request.current?.abort(); window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock); };
  }, []);

  async function submit(selected: Array<{ id: string }>) {
    if (request.current || selected.length === 0) return;
    const generation = authenticationGeneration();
    const ids = selected.map((item) => item.id);
    const selection = JSON.stringify(ids);
    if (pending.current?.selection !== selection || pending.current.generation !== generation) {
      pending.current = { selection, generation, key: `batch-export-${crypto.randomUUID()}` };
    }
    const controller = new AbortController();
    request.current = controller;
    setNotice(null);
    // A lost response can be retried with the same key without another worker job.
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const task = await queueConversationBatchExport(ids, pending.current.key, controller.signal);
      if (!mounted.current || generation !== authenticationGeneration()) return;
      pending.current = null;
      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [task, ...current.filter((item) => item.job_id !== task.job_id)]);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      setNotice({ generation });
      openTasks();
    } catch (error) {
      if (mounted.current && generation === authenticationGeneration()) {
        setNotice({ generation, error: error instanceof Error ? error.message : "CONNECTION_FAILED" });
      }
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
    }
  }

  const visible = notice?.generation === authenticationGeneration() ? notice : null;
  const feedback = visible ? <div role={visible.error ? "alert" : "status"} className="flex flex-wrap items-center gap-x-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm">
    <span className={visible.error ? "text-[var(--danger)]" : "text-secondary"}>{visible.error
      ? visible.error.startsWith("BATCH_EXPORT_") ? batchExportError(visible.error, zh) : (zh ? "未确认提交结果。所选对话已保留，再次点击导出可安全重试。" : "Submission was not confirmed. Your selection is retained; click Export to retry safely.")
      : (zh ? "导出已加入任务，离开页面后仍会继续。" : "Export queued. It continues after you leave this page.")}</span>
    <button type="button" onClick={openTasks} className="min-h-11 text-accent underline underline-offset-2">{zh ? "查看任务" : "View tasks"}</button>
    <button type="button" onClick={() => setNotice(null)} className="min-h-11 text-secondary">{zh ? "关闭" : "Dismiss"}</button>
  </div> : null;
  return { submit, feedback };
}
