"use client";

import { useMemo, useState } from "react";
import { buildVersionDiff } from "./version-diff";

/** Compare saved source, not the draft's rendered preview. Never submits text. */
export function SourceDraftComparison({ current, draft, zh }: { current: string; draft: string; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => open ? buildVersionDiff(current, draft) : null, [current, draft, open]);
  return <details className="basis-full text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer py-3 text-accent">{zh ? "比较当前正文与本机草稿" : "Compare current source and local draft"}</summary>
    {diff ? <>
      <p className="mb-2 text-xs text-secondary">{zh ? "− 当前正文　+ 本机草稿；比较不会提交修改。" : "− Current source　+ Local draft. Comparing does not save changes."}</p>
      {diff.truncated ? <p role="status" className="mb-2 text-xs text-secondary">{zh ? "内容较长，仅展示有界比较；请在编辑器中继续核对。" : "Bounded comparison shown. Review the remaining content in the editor."}</p> : null}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-ui bg-surface p-3 text-xs">{diff.lines.map((line, index) =>
        <span key={index} className="block">{line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}{line.text || " "}</span>)}</pre>
    </> : null}
  </details>;
}
