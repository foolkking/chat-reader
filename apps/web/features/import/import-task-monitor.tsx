"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getActiveTasks, getTask, retryTask } from "../../lib/api";
import type { BackgroundTaskRead } from "../../lib/types";

export function ImportTaskMonitor({ placement }: { placement: "sidebar" | "mobile" }) {
  const queryClient = useQueryClient();
  const previousTasks = useRef<BackgroundTaskRead[]>([]);
  const [completedTask, setCompletedTask] = useState<BackgroundTaskRead | null>(null);
  const tasksQuery = useQuery({
    queryKey: ["active-tasks"],
    queryFn: getActiveTasks,
    refetchInterval: (query) =>
      query.state.data?.some((task) => task.status === "queued" || task.status === "processing") ? 1500 : false,
  });
  const retryMutation = useMutation({
    mutationFn: retryTask,
    onSuccess: (task) => {
      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
        task,
        ...current.filter((item) => item.job_id !== task.job_id),
      ]);
    },
  });

  useEffect(() => {
    const current = tasksQuery.data ?? [];
    const currentIds = new Set(current.map((task) => task.job_id));
    const finished = previousTasks.current.filter(
      (task) => (task.status === "queued" || task.status === "processing") && !currentIds.has(task.job_id),
    );
    previousTasks.current = current;
    for (const task of finished) {
      void getTask(task.job_id).then((result) => {
        if (result.status !== "committed") return;
        setCompletedTask(result);
        void invalidateReaderQueries(queryClient);
        window.setTimeout(
          () => setCompletedTask((value) => (value?.job_id === result.job_id ? null : value)),
          10000,
        );
      });
    }
  }, [queryClient, tasksQuery.data]);

  const tasks = tasksQuery.data ?? [];
  const visibleTask = tasks.find((task) => task.status === "processing") ?? tasks[0] ?? completedTask;
  if (!visibleTask) return null;

  if (placement === "mobile") {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-[#d8dee9] bg-white p-3 shadow-xl md:hidden">
        <TaskContent task={visibleTask} compact />
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-2">
      {tasks.map((task) => (
        <div key={task.job_id} className="rounded-xl border border-[#d8dee9] bg-white p-3 shadow-sm">
          <TaskContent task={task} onRetry={() => retryMutation.mutate(task.job_id)} />
        </div>
      ))}
      {completedTask ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {completedTask.job_type === "conversation_merge" ? "合并完成" : "导入完成"}
          </p>
          {taskConversationId(completedTask) ? (
            <Link className="mt-1 inline-block underline" href={`/conversations/${taskConversationId(completedTask)}`}>
              打开会话
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskContent({ task, compact = false, onRetry }: { task: BackgroundTaskRead; compact?: boolean; onRetry?: () => void }) {
  const failed = task.status === "failed";
  const committed = task.status === "committed";
  const conversationId = taskConversationId(task);
  return (
    <div className="min-w-0 text-xs text-[#475569]" data-testid={`task-${task.job_type}-${task.status}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-[#111827]">{task.label || taskTypeLabel(task)}</p>
        <span className="shrink-0">{committed ? "100%" : `${task.progress}%`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
        <div
          className={`h-full rounded-full transition-[width] ${failed ? "bg-red-500" : "bg-[#10a37f]"}`}
          style={{ width: `${committed ? 100 : Math.max(task.progress, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span>{phaseLabel(task)}</span>
        {task.total_items > 0 ? <span>{task.processed_items} / {task.total_items}</span> : null}
      </div>
      {failed ? (
        <div className="mt-2">
          <p className="line-clamp-2 text-red-700">{task.error_message || "任务失败"}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1 font-medium text-red-800 underline">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {compact && committed && conversationId ? (
        <Link className="mt-1 inline-block font-medium text-[#0f766e] underline" href={`/conversations/${conversationId}`}>
          打开会话
        </Link>
      ) : null}
    </div>
  );
}

function phaseLabel(task: BackgroundTaskRead): string {
  if (task.status === "queued") return "等待处理";
  if (task.status === "failed") return "处理失败";
  if (task.status === "committed") return "处理完成";
  const labels: Record<string, string> = {
    parsing: "解析与对齐",
    persisting: "保存消息与 blocks",
    validating: "校验来源与顺序",
    creating: "创建目标会话",
    copying: "复制消息与 blocks",
    headings: "生成章节目录",
    search: "构建搜索索引",
    publishing: "发布会话",
  };
  return labels[task.phase] ?? "正在处理";
}

function taskTypeLabel(task: BackgroundTaskRead): string {
  return task.job_type === "conversation_merge" ? "合并会话" : "导入会话";
}

function taskConversationId(task: BackgroundTaskRead): string | null {
  return task.result.conversation_id ?? task.result.conversation_ids?.[0] ?? null;
}

async function invalidateReaderQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
  ]);
}
