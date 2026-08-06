"use client";

import { useState } from "react";
import { MobilePageHeader } from "../../../components/mobile-page-header";
import { ProjectSidebar } from "../../../features/projects/project-sidebar";
import { usePreferences } from "../../../components/preferences-provider";

export default function ConversationLoading() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8]">
      <ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} readerMode />
      <section className="flex min-w-0 flex-1 flex-col">
        <MobilePageHeader
          title="Chat Reader"
          description={zh ? "正在恢复阅读位置…" : "Restoring your reading position…"}
          onOpenSidebar={() => setMobileSidebarOpenSignal((value) => value + 1)}
        />
        <div className="h-0.5 w-1/4 bg-[#10a37f]" />
        <div className="mx-auto w-full max-w-3xl animate-pulse space-y-10 px-4 py-20 md:px-8">
          <div className="h-5 w-48 rounded bg-[#e5e7eb]" />
          <div className="ml-auto h-28 w-full rounded-2xl bg-[#ececeb] sm:w-2/3" />
          <div className="space-y-3"><div className="h-4 w-full rounded bg-[#e5e7eb]" /><div className="h-4 w-5/6 rounded bg-[#e5e7eb]" /><div className="h-4 w-3/4 rounded bg-[#e5e7eb]" /></div>
        </div>
      </section>
    </main>
  );
}
