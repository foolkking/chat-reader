import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("task center reacts to retained terminal rows instead of waiting for disappearance", () => {
  const monitor = source("features/import/import-task-monitor.tsx");

  expect(monitor).toContain("handledTerminalTaskIds");
  expect(monitor).toContain("!isTerminalTask(previous) && isTerminalTask(task)");
  expect(monitor).toContain('result.job_type === "content_noise_scan"');
  expect(monitor).toContain('new CustomEvent("chat-reader:conversation-merge-complete"');
  expect(monitor).toContain('queryKey: ["sidebar-conversations"]');
  expect(monitor).toContain('queryKey: ["reader-turn-window"]');
  expect(monitor).toContain("function TaskSection");
  expect(monitor).toContain('zh ? "处理中" : "In progress"');
  expect(monitor).toContain('zh ? "需要处理" : "Needs attention"');
  expect(monitor).toContain('zh ? "已完成" : "Completed"');
  expect(monitor).toContain('zh ? "失败" : "Failed"');
  expect(monitor).toContain("!tasks.some((task) => task.job_id === completedTask.job_id)");
});

test("reader preserves an absorbed source conversation and offers the merge target", () => {
  const reader = source("features/conversations/conversation-reader.tsx");

  expect(reader).toContain("mergedIntoConversationId");
  expect(reader).toContain('window.addEventListener("chat-reader:conversation-merge-complete"');
  expect(reader).toContain("detail.sourceConversationIds?.includes(conversationId)");
  expect(reader).toContain("Open merged conversation");
  expect(reader).toContain("Open target");
});
