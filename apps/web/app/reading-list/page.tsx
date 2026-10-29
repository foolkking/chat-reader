"use client";

import { useState } from "react";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { ReadingListPage } from "../../features/reading/reading-list-page";
import { usePreferences } from "../../components/preferences-provider";
import { useWorkspaceShell } from "../../components/workspace-shell";

export default function ReadingListRoute() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const content = (
    <section className="flex min-w-0 flex-1 flex-col">
      <MobilePageHeader
        title={zh ? "待读清单" : "Reading list"}
        description={zh ? "稍后处理的对话和手动阅读状态" : "Conversations you want to revisit"}
        onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)}
        className="md:px-6"
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
          <ReadingListPage />
        </div>
      </div>
    </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]"><ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}
