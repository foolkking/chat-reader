"use client";

import { ConversationList } from "../features/conversations/conversation-list";
import { ArchivedProjectList } from "../features/projects/archived-project-list";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { useTranslations } from "./preferences-provider";
import { useImportDialog } from "./import-dialog-provider";

export function AppShell({ mode = "active" }: { mode?: "active" | "archived" }) {
  const t = useTranslations();
  const { openImportDialog } = useImportDialog();
  const isArchivedMode = mode === "archived";
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-ui bg-surface/95 px-4 pl-16 backdrop-blur md:px-[2vw] md:pl-[2vw]">
          <div className="min-w-0"><h1 className="truncate text-base font-semibold">{isArchivedMode ? t("archived") : t("allConversations")}</h1><p className="text-xs text-secondary">{isArchivedMode ? t("restoreDescription") : t("readerDescription")}</p></div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"><div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-[clamp(1rem,2vw,2rem)] py-8">{isArchivedMode ? <ArchivedProjectList /> : null}<ConversationList mode={mode} onImportClick={openImportDialog} /></div></div>
      </section>
    </main>
  );
}
