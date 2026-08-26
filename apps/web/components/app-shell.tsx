"use client";

import { ConversationList } from "../features/conversations/conversation-list";
import { ArchivedProjectList } from "../features/projects/archived-project-list";
import { useState } from "react";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { useTranslations } from "./preferences-provider";
import { useImportDialog } from "./import-dialog-provider";
import { RecentItems } from "../features/reading/recent-items";
import { MobilePageHeader } from "./mobile-page-header";
import { useWorkspaceShell } from "./workspace-shell";

export function AppShell({ mode = "active" }: { mode?: "active" | "archived" }) {
  const t = useTranslations();
  const { openImportDialog } = useImportDialog();
  const isArchivedMode = mode === "archived";
  const workspace = useWorkspaceShell();
  const [mobileSidebarOpenSignal, setMobileSidebarOpenSignal] = useState(0);
  const content = (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobilePageHeader
          title={isArchivedMode ? t("archived") : t("allConversations")}
          description={isArchivedMode ? t("restoreDescription") : t("readerDescription")}
          onOpenSidebar={() => workspace.embedded ? workspace.openMobileSidebar() : setMobileSidebarOpenSignal((value) => value + 1)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"><div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-[clamp(1rem,2vw,2rem)] py-8">{mode === "active" ? <div className="md:hidden"><RecentItems compact /></div> : null}{isArchivedMode ? <ArchivedProjectList /> : null}<ConversationList mode={mode} onImportClick={openImportDialog} /></div></div>
      </section>
  );
  if (workspace.embedded) return content;
  return <main className="flex h-screen w-screen overflow-hidden bg-page text-primary"><ProjectSidebar mobileOpenSignal={mobileSidebarOpenSignal} showMobileTrigger={false} />{content}</main>;
}
