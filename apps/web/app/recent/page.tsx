"use client";

import { useState } from "react";
import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { RecentItems } from "../../features/reading/recent-items";
import { usePreferences } from "../../components/preferences-provider";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { useWorkspaceShell } from "../../components/workspace-shell";

export default function RecentPage() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const content = (
      <section className="flex min-w-0 flex-1 flex-col">
        <MobilePageHeader title={zh ? "最近" : "Recent"} description={zh ? "继续上次阅读的位置" : "Continue from where you left off"} onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)} className="md:px-6" />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
            <RecentItems showHeading={false} />
          </div>
        </div>
      </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]"><ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}
