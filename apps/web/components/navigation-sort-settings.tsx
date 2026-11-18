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
  return <details className="nav-sort-settings border-y border-ui" onToggle={event => {
    const details = event.currentTarget, scroll = details.closest<HTMLElement>("[data-sidebar-settings-scroll]");
    if (details.open && scroll && scroll.getBoundingClientRect().bottom - details.getBoundingClientRect().top < 224)
      scroll.scrollTop += details.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
  }}>
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">{zh ? "排序与导航" : "Sorting & navigation"}</summary>
    <div className="pb-2">
      <div className="space-y-1 pb-2">
        <p className="text-xs font-medium text-secondary">{zh ? "侧栏顺序" : "Sidebar order"}</p>
        <div role="group" aria-label={zh ? "侧栏顺序" : "Sidebar order"} className="grid grid-cols-2 rounded-lg bg-subtle p-1">
          {(["projects_first", "unclassified_first"] as const).map((value, index) => <button type="button" key={value} aria-pressed={p.navigationSort.blocks === value}
            className={`min-h-9 min-w-0 rounded-md px-1.5 text-xs leading-4 [@media(pointer:coarse)]:min-h-11 ${p.navigationSort.blocks === value ? "bg-surface font-semibold text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
            onClick={() => { setError(false); void p.setNavigationSort({ ...p.navigationSort, blocks: value }).catch(() => setError(true)); }}>
            {(zh ? ["项目在前", "未归类在前"] : ["Projects first", "Unclassified first"])[index]}
          </button>)}
        </div>
      </div>
      <div className="divide-y divide-ui border-y border-ui">
        <ProjectSortMenu sidebar settingLabel={zh ? "项目之间" : "Project order"} />
        {(["project_default", "all", "unclassified"] as const).map((scope, index) => <ConversationSortMenu key={scope} sidebar scope={scope}
          settingLabel={(zh ? ["项目内对话 · 默认", "全部对话", "未归类"] : ["In projects · default", "All conversations", "Unclassified"])[index]} />)}
      </div>
      <p className="py-2 text-xs leading-5 text-secondary">{zh ? "已单独设置的项目、最近阅读和搜索保留各自的排序。" : "Project overrides, recent reading and search keep their own order."}</p>
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
