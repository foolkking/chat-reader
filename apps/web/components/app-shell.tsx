"use client";

import { useState } from "react";
import { ConversationList } from "../features/conversations/conversation-list";
import { ImportPanel } from "../features/import/import-panel";
import { ArchivedProjectList } from "../features/projects/archived-project-list";
import { ProjectSidebar } from "../features/projects/project-sidebar";

export function AppShell({ mode = "active" }: { mode?: "active" | "archived" }) {
  const [showImport, setShowImport] = useState(false);
  const isArchivedMode = mode === "archived";

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar onImportClick={() => setShowImport(true)} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {isArchivedMode ? "Archived Conversations" : "All Conversations"}
            </h1>
            <p className="text-xs text-[#6b7280]">
              {isArchivedMode ? "Restore or delete archived conversations" : "Canonical ChatGPT export reader"}
            </p>
          </div>
          {!isArchivedMode ? (
            <button
              type="button"
              data-testid="header-import-button"
              onClick={() => setShowImport(true)}
              className="hidden shrink-0 rounded-lg bg-[#111827] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30 sm:inline-flex"
            >
              + Import
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 md:px-6">
            {isArchivedMode ? <ArchivedProjectList /> : null}
            <ConversationList mode={mode} onImportClick={() => setShowImport(true)} />
          </div>
        </div>
      </section>

      {showImport ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 py-0 sm:items-center sm:px-4 sm:py-8">
          <button
            type="button"
            aria-label="Close import dialog"
            className="absolute inset-0"
            onClick={() => setShowImport(false)}
          />
          <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Import conversations</h2>
                <p className="text-xs text-[#6b7280]">Preview first, then commit to your local archive.</p>
              </div>
              <button
                type="button"
                data-testid="import-dialog-close"
                onClick={() => setShowImport(false)}
                className="rounded-md px-2 py-1 text-sm text-[#6b7280] hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30"
              >
                Close
              </button>
            </div>
            <div className="p-5">
              <ImportPanel />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
