"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getConversationExportUrl, getTask, queueConversationArchiveExport } from "../../lib/api";

type ExportFormat = "cr" | "markdown" | "canonical_json";

export function ExportPanel({
  conversationId,
  selectedMessageIds,
}: {
  conversationId: string;
  selectedMessageIds: string[];
}) {
  const [format, setFormat] = useState<ExportFormat>("cr");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeVersions, setIncludeVersions] = useState(false);
  const [useSelection, setUseSelection] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const taskQuery = useQuery({
    queryKey: ["task", jobId],
    queryFn: () => getTask(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "committed" || status === "failed" ? false : 1500;
    },
  });
  const href = getConversationExportUrl(conversationId, {
    format: format === "cr" ? "markdown" : format,
    includeMetadata,
    includeToc,
    includeVersions,
    messageIds: useSelection ? selectedMessageIds : [],
  });
  const archiveUrl = taskQuery.data?.result.download_url;

  return (
    <section className="min-w-0">
      <div className="border-b border-[#e5e7eb] pb-4">
        <h2 className="text-base font-semibold text-[#111827]">导出对话</h2>
        <p className="mt-1 text-sm text-[#6b7280]">选择适合备份、迁移或阅读的格式。</p>
      </div>
      <div className="mt-5 grid gap-5 text-sm text-[#374151]">
        <div className="grid grid-cols-3 rounded-lg bg-[#f3f4f6] p-1" role="group" aria-label="导出格式">
          {(["cr", "markdown", "canonical_json"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFormat(value)}
              className={`min-h-9 rounded-md px-2 text-xs font-medium ${format === value ? "bg-white text-[#111827] shadow-sm" : "text-[#6b7280] hover:text-[#111827]"}`}
            >
              {value === "cr" ? ".cr 快速归档" : value === "markdown" ? "Markdown" : "Canonical JSON"}
            </button>
          ))}
        </div>

        {format === "cr" ? (
          <div className="border-l-2 border-[#10a37f] pl-3 text-sm leading-6 text-[#4b5563]">
            保留消息版本、渲染 blocks、章节和搜索数据，适合在 Chat Reader 之间快速迁移。归档下载保留 24 小时。
          </div>
        ) : (
          <div className="grid gap-3">
            <Toggle label="包含元数据" checked={includeMetadata} onChange={setIncludeMetadata} />
            <Toggle label="包含章节目录" checked={includeToc} onChange={setIncludeToc} />
            <Toggle label="包含版本历史" checked={includeVersions} onChange={setIncludeVersions} />
            <Toggle label={`仅导出所选消息（${selectedMessageIds.length}）`} checked={useSelection} disabled={selectedMessageIds.length === 0} onChange={setUseSelection} />
          </div>
        )}

        {format === "cr" ? (
          archiveUrl && taskQuery.data?.status === "committed" ? (
            <a href={String(archiveUrl)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#111827] px-4 font-medium text-white hover:bg-black">下载 .cr 归档</a>
          ) : (
            <button
              type="button"
              disabled={Boolean(jobId && taskQuery.data?.status !== "failed")}
              onClick={async () => {
                setQueueError(null);
                try {
                  const task = await queueConversationArchiveExport(conversationId);
                  setJobId(task.job_id);
                } catch (error) {
                  setQueueError(error instanceof Error ? error.message : "导出任务提交失败");
                }
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#111827] px-4 font-medium text-white hover:bg-black disabled:cursor-wait disabled:opacity-60"
            >
              {jobId ? `正在生成 ${taskQuery.data?.progress ?? 0}%` : "生成 .cr 归档"}
            </button>
          )
        ) : (
          <a href={href} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#111827] px-4 font-medium text-white hover:bg-black">下载文件</a>
        )}
        {taskQuery.data?.status === "failed" ? <p className="text-sm text-[#b91c1c]">{taskQuery.data.error_message || "导出失败，请重试。"}</p> : null}
        {queueError ? <p className="text-sm text-[#b91c1c]">{queueError}</p> : null}
      </div>
    </section>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`flex min-h-10 items-center justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#10a37f]" />
    </label>
  );
}
