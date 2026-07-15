"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { commitImport, getActiveImports, getImportStatus } from "../../lib/api";
import type { ImportStatusResponse } from "../../lib/types";

export function ImportTaskMonitor({ placement }: { placement: "sidebar" | "mobile" }) {
  const queryClient = useQueryClient();
  const previousTasks = useRef<ImportStatusResponse[]>([]);
  const [completedTask, setCompletedTask] = useState<ImportStatusResponse | null>(null);
  const tasksQuery = useQuery({
    queryKey: ["active-imports"],
    queryFn: getActiveImports,
    refetchInterval: (query) =>
      query.state.data?.some((task) => task.status === "queued" || task.status === "processing") ? 1500 : false,
  });
  const retryMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: (task) => {
      queryClient.setQueryData<ImportStatusResponse[]>(["active-imports"], (current = []) => [
        task,
        ...current.filter((item) => item.import_id !== task.import_id),
      ]);
    },
  });

  useEffect(() => {
    const current = tasksQuery.data ?? [];
    const currentIds = new Set(current.map((task) => task.import_id));
    const finished = previousTasks.current.filter(
      (task) => (task.status === "queued" || task.status === "processing") && !currentIds.has(task.import_id),
    );
    previousTasks.current = current;
    for (const task of finished) {
      void getImportStatus(task.import_id).then((result) => {
        if (result.status !== "committed") {
          return;
        }
        setCompletedTask(result);
        void invalidateReaderQueries(queryClient);
        window.setTimeout(() => setCompletedTask((value) => (value?.import_id === result.import_id ? null : value)), 8000);
      });
    }
  }, [queryClient, tasksQuery.data]);

  const tasks = tasksQuery.data ?? [];
  const visibleTask = tasks.find((task) => task.status === "processing") ?? tasks[0] ?? completedTask;
  if (!visibleTask) {
    return null;
  }

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
        <div key={task.import_id} className="rounded-xl border border-[#d8dee9] bg-white p-3 shadow-sm">
          <TaskContent task={task} onRetry={() => retryMutation.mutate(task.import_id)} />
        </div>
      ))}
      {completedTask ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="font-medium">导入完成</p>
          {completedTask.conversation_ids[0] ? (
            <Link className="mt-1 inline-block underline" href={`/conversations/${completedTask.conversation_ids[0]}`}>
              打开会话
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskContent({
  task,
  compact = false,
  onRetry,
}: {
  task: ImportStatusResponse;
  compact?: boolean;
  onRetry?: () => void;
}) {
  const isFailed = task.status === "failed";
  const isCommitted = task.status === "committed";
  return (
    <div className="min-w-0 text-xs text-[#475569]" data-testid={`import-task-${task.status}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-medium text-[#111827]">{task.filename || "Import"}</p>
        <span className="shrink-0">{isCommitted ? "100%" : `${task.progress}%`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
        <div
          className={`h-full rounded-full transition-[width] ${isFailed ? "bg-red-500" : "bg-[#10a37f]"}`}
          style={{ width: `${isCommitted ? 100 : Math.max(task.progress, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span>{phaseLabel(task)}</span>
        {task.total_messages > 0 ? <span>{task.processed_messages} / {task.total_messages}</span> : null}
      </div>
      {isFailed ? (
        <div className="mt-2">
          <p className="line-clamp-2 text-red-700">{task.error_message || "导入失败"}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mt-1 font-medium text-red-800 underline">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {compact && isCommitted && task.conversation_ids[0] ? (
        <Link className="mt-1 inline-block font-medium text-[#0f766e] underline" href={`/conversations/${task.conversation_ids[0]}`}>
          打开会话
        </Link>
      ) : null}
    </div>
  );
}

function phaseLabel(task: ImportStatusResponse): string {
  if (task.status === "queued") return "等待导入";
  if (task.status === "failed") return "导入失败";
  if (task.status === "committed") return "导入完成";
  const labels: Record<string, string> = {
    parsing: "解析与对齐",
    persisting: "保存消息与 blocks",
    headings: "生成章节目录",
    search: "构建搜索索引",
  };
  return labels[task.phase] ?? "正在导入";
}

async function invalidateReaderQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["project-conversations"] }),
  ]);
}
