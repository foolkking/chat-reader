"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getCleanupComparison } from "../../lib/api";

export function CleanupScanComparison({ scanId, zh }: { scanId: string; zh: boolean }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["cleanup-review", scanId, "comparison", offset],
    queryFn: ({ signal }) => getCleanupComparison(scanId, offset, signal), retry: false, staleTime: 0 });
  return <details className="rounded-lg border border-ui p-3">
    <summary className="min-h-11 cursor-pointer text-sm font-medium">{zh ? "比较前后扫描：新结果默认全部保留" : "Compare scans: new matches are kept by default"}</summary>
    <p className="text-xs leading-5 text-secondary">{zh ? "只比较有关联的原范围，按消息版本、源哈希和原始范围识别；不复制旧扫描的勾选、精调或保护确认。原文已变化的候选单独统计。" : "Only the related original scope is compared, using message versions, source hashes and original ranges. Choices, refinements and protection consent are never copied. Changed-source candidates are counted separately."}</p>
    {query.isLoading ? <p role="status">{zh ? "正在比较…" : "Comparing…"}</p> : null}
    {query.isError ? <div><p role="alert" className="text-xs">{zh ? "暂时无法比较；旧扫描可能已不可访问。当前结果仍可独立审阅。" : "Comparison unavailable; the old scan may no longer be accessible. You can review these results independently."}</p><button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void query.refetch()}>{zh ? "重新读取" : "Reload"}</button></div> : null}
    {query.data ? <div className="space-y-3">
      {query.data.excluded_targets ? <p className="text-xs text-[var(--warning)]">{zh ? `原范围有 ${query.data.excluded_targets} 个对话已排除（删除、归档或权限变化），没有扩大范围。` : `${query.data.excluded_targets} original conversations were excluded (deleted, archived or access changed). Scope was not expanded.`}</p> : null}
      {query.data.items.map(item => <div key={item.rule_id} className="border-t border-ui pt-3 text-xs leading-6">
        <p className="font-medium">{item.rule_name} · {item.before_revisions.join(", ") || "—"} → {item.after_revisions.join(", ") || "—"}</p>
        <p>{zh ? `原命中 ${item.before} → 新命中 ${item.after}；新增 ${item.added}，不再命中 ${item.removed}。` : `${item.before} → ${item.after} matches; ${item.added} added, ${item.removed} removed.`}</p>
        <p className="text-secondary">{zh ? `原文已变化、不可直接比较：旧 ${item.source_changed_before}，新 ${item.source_changed_after}。` : `Changed source, not directly comparable: ${item.source_changed_before} old, ${item.source_changed_after} new.`}</p>
      </div>)}
      <div className="flex items-center gap-3 text-xs"><button type="button" disabled={!offset || query.isFetching} className="btn-secondary min-h-11 px-3" onClick={() => setOffset(value => Math.max(0, value - 20))}>{zh ? "上一页" : "Previous"}</button><span>{offset + 1}–{Math.min(offset + 20, query.data.total)} / {query.data.total}</span><button type="button" disabled={offset + 20 >= query.data.total || query.isFetching} className="btn-secondary min-h-11 px-3" onClick={() => setOffset(value => value + 20)}>{zh ? "下一页" : "Next"}</button></div>
    </div> : null}
  </details>;
}
