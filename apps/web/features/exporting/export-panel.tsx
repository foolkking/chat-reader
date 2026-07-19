"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getConversationExportUrl, getTask, queueConversationArchiveExport } from "../../lib/api";
import { useTranslations } from "../../components/preferences-provider";

type ExportFormat = "cr" | "markdown" | "canonical_json";

export function ExportPanel({
  conversationId,
  selectedMessageIds,
}: {
  conversationId: string;
  selectedMessageIds: string[];
}) {
  const t = useTranslations();
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
      <div className="grid gap-5 text-sm text-secondary">
        <div className="grid grid-cols-3 rounded-lg bg-subtle p-1" role="group" aria-label={t("export")}>
          {(["cr", "markdown", "canonical_json"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFormat(value)}
              className={`min-h-9 rounded-md px-2 text-xs font-medium ${format === value ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
            >
              {value === "cr" ? ".cr 快速归档" : value === "markdown" ? "Markdown" : "Canonical JSON"}
            </button>
          ))}
        </div>

        {format === "cr" ? (
          <div className="border-l-2 border-[var(--accent)] pl-3 text-sm leading-6 text-secondary">
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
            <a href={String(archiveUrl)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--text)] px-4 font-medium text-[var(--surface)] hover:opacity-85">下载 .cr 归档</a>
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
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--text)] px-4 font-medium text-[var(--surface)] hover:opacity-85 disabled:cursor-wait disabled:opacity-60"
            >
              {jobId ? `正在生成 ${taskQuery.data?.progress ?? 0}%` : "生成 .cr 归档"}
            </button>
          )
        ) : (
          <a href={href} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--text)] px-4 font-medium text-[var(--surface)] hover:opacity-85">下载文件</a>
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
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </label>
  );
}
