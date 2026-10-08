"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { getImportCleanupScans } from "../../lib/api";
import { ContentCleanupDialog } from "../conversations/content-cleanup-panel";

export function ImportNoiseReview({ importId }: { importId: string }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [opened, setOpened] = useState<string | null>(null);
  const key = ["content-cleanup-pending", "import", importId];
  const scans = useQuery({ queryKey: key, queryFn: ({ signal }) => getImportCleanupScans(importId, signal), retry: false,
    refetchInterval: (query) => !query.state.error && query.state.data?.some((scan) => ["QUEUED", "SCANNING", "APPLYING"].includes(scan.status)) ? 2_000 : false });
  return <div className="border-t border-ui pt-3 text-xs" aria-label={zh ? "本次导入的噪声审查" : "Noise review for this import"}>
    {scans.isPending ? <p>{zh ? "正在读取本次导入的噪声扫描…" : "Loading the noise scan for this import…"}</p> : null}
    {scans.isError ? <div role="alert" className="flex flex-wrap items-center gap-2"><span>{zh ? "导入已完成，暂时无法读取噪声扫描。" : "Import complete. The noise scan could not load."}</span><button type="button" disabled={scans.isFetching} onClick={() => void scans.refetch()} className="btn-secondary min-h-11 px-3">{zh ? "重试读取" : "Retry loading"}</button></div> : null}
    {scans.isSuccess && !scans.data.length ? <p className="text-secondary">{zh ? "本次导入暂无待审查的扫描任务。" : "No pending scan for this import."}</p> : null}
    {/* The import endpoint returns its latest scan only. Keep the row mounted
        when a rescan replaces it so closing review restores the same control. */}
    {scans.data?.map((scan) => <div key={importId} className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-secondary">{scan.status === "READY"
        ? (scan.occurrence_count ? (zh ? `${scan.occurrence_count} 个噪声候选，确认前正文不变。` : `${scan.occurrence_count} noise candidates. Content stays unchanged until confirmed.`) : (zh ? "未发现噪声候选。" : "No noise candidates found."))
        : scan.status === "CANCELLED" ? (zh ? "噪声扫描已取消，导入内容已保留。" : "Noise scan cancelled. Imported content is saved.")
        : ["FAILED", "STALE"].includes(scan.status) ? (zh ? "噪声扫描需要重试，导入内容已保留。" : "Noise scan needs retry. Imported content is saved.")
        : (zh ? `噪声扫描 ${scan.progress}% · 可先打开对话` : `Noise scan ${scan.progress}% · You can open the conversation now`)}</span>
      <button type="button" onClick={() => setOpened(scan.id)} className="btn-secondary min-h-11 px-3 font-medium">{scan.status === "READY" ? (scan.occurrence_count > 0 ? (zh ? "审查噪声" : "Review noise") : (zh ? "查看结果" : "View result")) : (zh ? "查看扫描" : "View scan")}</button>
    </div>)}
    {opened ? <ContentCleanupDialog open initialScanId={opened} onClose={() => { setOpened(null); void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] }); }} /> : null}
  </div>;
}
