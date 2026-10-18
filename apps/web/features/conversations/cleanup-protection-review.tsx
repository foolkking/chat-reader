"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getCleanupProtectionPreview } from "../../lib/api";
import type { CleanupReviewFilter } from "../../lib/types";

export function CleanupProtectionReview({ scanId, scope, label, zh, busy, onCancel, onConfirm }: {
  scanId: string; scope: CleanupReviewFilter & { occurrence_ids?: string[] }; label: string; zh: boolean;
  busy: boolean; onCancel: () => void; onConfirm: (token: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [checked, setChecked] = useState(false);
  const preview = useQuery({ queryKey: ["cleanup-protection-preview", scanId, scope, offset],
    queryFn: ({ signal }) => getCleanupProtectionPreview(scanId, { ...scope, offset }, signal),
    staleTime: 0, retry: false });
  return <section className="space-y-3 rounded-lg border border-[var(--warning)]/50 p-3" aria-label={zh ? "确认受保护匹配" : "Review protected matches"}>
    <h3 className="font-semibold">{zh ? "确认受保护匹配" : "Review protected matches"}</h3>
    <p className="break-words text-sm">{label}</p>
    <p className="text-xs leading-5 text-secondary">{zh ? "此范围包含 Markdown 链接、代码或公式等受保护内容。删除可能破坏结构或移除有用内容。确认仅保存本扫描的待删除选择，不直接修改原文；随后仍需预览并应用。" : "This scope includes protected Markdown links, code or math. Removal may break structure or remove useful content. Confirmation only saves this scan's selection; preview and apply are still required."}</p>
    {preview.isLoading ? <p role="status">{zh ? "正在核对完整范围…" : "Checking the complete scope…"}</p> : null}
    {preview.isError ? <div role="alert"><p>{zh ? "无法核对范围，或原文已变化；没有保存选择。" : "The scope could not be checked or source changed. No choices were saved."}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void preview.refetch()}>{zh ? "重新核对" : "Retry preview"}</button></div> : null}
    {preview.data && !preview.isError ? <>
      <p className="text-sm font-medium">{zh ? `全部 ${preview.data.total} 处，其中 ${preview.data.protected} 处受保护（含其他分页）。` : `${preview.data.total} matches, ${preview.data.protected} protected (including other pages).`}</p>
      <ul className="max-h-72 divide-y divide-[var(--border)] overflow-auto rounded border border-ui px-3">
        {preview.data.items.map(item => <li key={item.id} className="py-3 text-xs"><p className="mb-1 text-secondary">{item.conversation_title}{item.protected ? (zh ? " · 受保护" : " · protected") : ""}</p><pre className="whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{item.match_text}</pre>{item.match_truncated ? <p>{zh ? "此处仅展示前 2000 字符；请返回候选详情检查完整匹配。" : "Only the first 2,000 characters are shown. Inspect the full candidate before confirming."}</p> : null}</li>)}
      </ul>
      <div className="flex items-center gap-3 text-xs">
        <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy || !offset} onClick={() => setOffset(value => Math.max(0, value - 20))}>{zh ? "上一页" : "Previous"}</button>
        <span>{preview.data.total ? offset + 1 : 0}–{Math.min(offset + 20, preview.data.total)} / {preview.data.total}</span>
        <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy || offset + 20 >= preview.data.total} onClick={() => setOffset(value => value + 20)}>{zh ? "下一页" : "Next"}</button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />{zh ? "我已检查此规则和完整操作范围，接受保护内容风险。" : "I checked this rule and the complete scope, and accept the protected-content risk."}</label>
      <button type="button" className="btn-primary min-h-11 px-3 text-sm" disabled={busy || preview.isFetching || !checked || !preview.data.total}
        onClick={() => onConfirm(preview.data!.preview_token)}>{busy ? (zh ? "正在保存选择…" : "Saving choices…") : (zh ? `选择这 ${preview.data.total} 处匹配（${preview.data.protected} 处受保护）` : `Select ${preview.data.total} matches (${preview.data.protected} protected)`)}</button>
    </> : null}
    <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={onCancel}>{zh ? "返回，不选择" : "Back without selecting"}</button>
  </section>;
}
