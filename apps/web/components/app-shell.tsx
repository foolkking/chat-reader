"use client";

import { useState } from "react";
import { ConversationList } from "../features/conversations/conversation-list";
import { ImportPanel } from "../features/import/import-panel";
import { ArchivedProjectList } from "../features/projects/archived-project-list";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { useTranslations } from "./preferences-provider";

export function AppShell({ mode = "active" }: { mode?: "active" | "archived" }) {
  const t = useTranslations();
  const [showImport, setShowImport] = useState(false);
  const isArchivedMode = mode === "archived";
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
      <ProjectSidebar onImportClick={() => setShowImport(true)} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-ui bg-surface/95 px-4 pl-16 backdrop-blur md:px-[2vw] md:pl-[2vw]">
          <div className="min-w-0"><h1 className="truncate text-base font-semibold">{isArchivedMode ? t("archived") : t("allConversations")}</h1><p className="text-xs text-secondary">{isArchivedMode ? t("restoreDescription") : t("readerDescription")}</p></div>
          {!isArchivedMode ? <button type="button" data-testid="header-import-button" onClick={() => setShowImport(true)} className="hidden shrink-0 rounded-lg bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--surface)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)] sm:inline-flex">{t("importData")}</button> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"><div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-[clamp(1rem,2vw,2rem)] py-8">{isArchivedMode ? <ArchivedProjectList /> : null}<ConversationList mode={mode} onImportClick={() => setShowImport(true)} /></div></div>
      </section>
      {showImport ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:px-4 sm:py-8"><button type="button" aria-label={t("close")} className="absolute inset-0" onClick={() => setShowImport(false)} /><div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-raised shadow-2xl sm:rounded-2xl"><div className="flex items-center justify-between border-b border-ui px-5 py-4"><span className="text-sm text-secondary">{t("serverFileNotice")}</span><button type="button" data-testid="import-dialog-close" onClick={() => setShowImport(false)} className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">{t("close")}</button></div><div className="p-5"><ImportPanel /></div></div></div> : null}
    </main>
  );
}
