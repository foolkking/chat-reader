"use client";

import { useState } from "react";
import { MobilePageHeader } from "../../components/mobile-page-header";
import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { AttachmentDirectoryPage } from "../../features/attachments/attachment-directory-page";
import { usePreferences } from "../../components/preferences-provider";
import { useWorkspaceShell } from "../../components/workspace-shell";

export default function AttachmentDirectoryRoute() {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const content = (
    <section className="flex min-w-0 flex-1 flex-col">
      <MobilePageHeader
        title={zh ? "文件目录" : "File directory"}
        description={zh ? "跨对话查找、筛选和打开附件" : "Find, filter, and open attachments across conversations"}
        onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)}
        className="md:px-6"
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
          <AttachmentDirectoryPage />
        </div>
      </div>
    </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]"><ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}
