"use client";

import { useState } from "react";
import { ConversationSortMenu, ProjectSortMenu } from "./sort-menu";
import { recommendedNavigation, usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

export function NavigationSortSettings() {
  const p = usePreferences();
  const zh = p.resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const previous = p.navigationSort.recommendation_backup;
  const [error, setError] = useState(false);
  const apply = async () => {
    if (!await confirm({ title: zh ? "应用推荐排序？" : "Apply recommended sorting?", description: zh ? "全部对话按内容更新；项目内和未归类按导入时间；项目手动排序。独立项目设置与已保存手动位置保留。" : "All conversations by content update; project/default inbox by import time; projects manually. Overrides and saved positions remain." })) return;
    const { all, project_default, unclassified, blocks } = p.navigationSort;
    try { setError(false); await p.setNavigationSort({ ...recommendedNavigation, recommendation_backup: previous ?? {
      all, project_default, unclassified, blocks, project_mode: p.projectSortMode, project_direction: p.projectSortDirection,
    } }, { mode: "custom", direction: "asc" }); } catch { setError(true); }
  };
  return <details className="border-y border-ui py-2">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">{zh ? "排序与导航" : "Sorting & navigation"}</summary>
    <div className="py-2">
      <div className="space-y-2 pb-3">
        <p className="text-sm">{zh ? "侧栏顺序" : "Sidebar order"}</p>
        <div role="group" aria-label={zh ? "侧栏顺序" : "Sidebar order"} className="flex flex-wrap gap-2">
          {(["projects_first", "unclassified_first"] as const).map((value, index) => <button type="button" key={value} aria-pressed={p.navigationSort.blocks === value}
            className={`min-h-11 rounded-lg border px-3 text-sm ${p.navigationSort.blocks === value ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-ui bg-surface text-secondary hover:bg-subtle"}`}
            onClick={() => { setError(false); void p.setNavigationSort({ ...p.navigationSort, blocks: value }).catch(() => setError(true)); }}>
            {(zh ? ["项目 → 未归类", "未归类 → 项目"] : ["Projects → Unclassified", "Unclassified → Projects"])[index]}
          </button>)}
        </div>
      </div>
      <div className="divide-y divide-ui border-y border-ui">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3"><p className="text-sm">{zh ? "项目之间" : "Project order"}</p><ProjectSortMenu /></div>
        {(["project_default", "all", "unclassified"] as const).map((scope, index) => <div key={scope} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div><p className="text-sm">{(zh ? ["项目内对话 · 默认", "全部对话", "未归类"] : ["In projects · default", "All conversations", "Unclassified"])[index]}</p>
            {scope === "project_default" ? <p className="mt-1 text-xs text-secondary">{zh ? "独立设置的项目不受影响" : "Project overrides are unchanged"}</p> : null}</div>
          <ConversationSortMenu scope={scope} />
        </div>)}
      </div>
      <p className="py-3 text-xs text-secondary">{zh ? "最近阅读和搜索独立排序。" : "Recent reading and search keep their own order."}</p>
      <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => void apply()}>{zh ? "应用推荐规则" : "Apply recommended rules"}</button>
      {previous ? <button type="button" className="min-h-11 px-3 text-sm text-accent" onClick={() => {
        setError(false);
        const { all, project_default, unclassified, blocks, project_mode, project_direction } = previous;
        void p.setNavigationSort({ all, project_default, unclassified, blocks, recommendation_backup: null },
          { mode: project_mode, direction: project_direction }).catch(() => setError(true));
      }}>{zh ? "恢复应用前设置" : "Restore previous settings"}</button> : null}
      </div>
      {error ? <p role="alert">{zh ? "设置未确认，请查看偏好同步状态。" : "Settings unconfirmed; check preference sync."}</p> : null}
    </div>
  </details>;
}
