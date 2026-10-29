"use client";

import { useRef, useState } from "react";
import type { ProjectRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

export function BulkMoveReview({
  selectedIds,
  projects,
  busy,
  onMove,
  label = "move",
}: {
  selectedIds: string[];
  projects: ProjectRead[];
  busy: boolean;
  onMove: (ids: string[], projectId: string | null) => Promise<void>;
  label?: string;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [target, setTarget] = useState("");
  const submitting = useRef(false);
  const targetProject = target && target !== "__none" ? projects.find((project) => project.id === target) : undefined;
  const destination = target === "__none" ? (zh ? "未分类" : "Unclassified")
    : targetProject?.name ?? (zh ? "目标项目已不可用" : "Destination unavailable");
  async function confirmMove() {
    if (busy || submitting.current || !selectedIds.length || !target || (target !== "__none" && !targetProject)) return;
    submitting.current = true;
    // Freeze the explicitly confirmed set; later list/selection refreshes are
    // not permission to append more conversations to this operation.
    const ids = [...selectedIds];
    const projectId = target === "__none" ? null : target;
    try { await onMove(ids, projectId); }
    finally { submitting.current = false; }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`${label}-bulk-move-target`}>{zh ? "移动到项目" : "Move to project"}</label>
      <select
        id={`${label}-bulk-move-target`}
        value={target}
        disabled={busy || selectedIds.length === 0}
        onChange={(event) => setTarget(event.target.value)}
        className="min-h-11 max-w-full rounded-lg border border-ui bg-surface px-2 text-sm text-primary"
      >
        <option value="">{zh ? "选择移动目标…" : "Choose move target…"}</option>
        <option value="__none">{zh ? "未分类" : "Unclassified"}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      {target ? (
        <>
          <span className="text-xs text-secondary" role="status">
            {zh ? `将移动 ${selectedIds.length} 项至「${destination}」` : `Move ${selectedIds.length} ${selectedIds.length === 1 ? "item" : "items"} to “${destination}”`}
          </span>
          <button
            type="button"
            disabled={busy || selectedIds.length === 0 || (target !== "__none" && !targetProject)}
            onClick={() => void confirmMove()}
            className="min-h-11 rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-50"
          >
            {zh ? "确认移动" : "Confirm move"}
          </button>
          <button type="button" disabled={busy} onClick={() => setTarget("")} className="min-h-11 rounded-lg border border-ui px-3 text-sm text-secondary disabled:opacity-50">
            {zh ? "取消" : "Cancel"}
          </button>
        </>
      ) : null}
    </div>
  );
}
