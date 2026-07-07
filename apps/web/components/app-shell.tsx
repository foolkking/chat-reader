"use client";

import { useState } from "react";
import { ConversationList } from "../features/conversations/conversation-list";
import { ImportPanel } from "../features/import/import-panel";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { RecentItems } from "../features/reading/recent-items";

export function AppShell() {
  const [showImport, setShowImport] = useState(false);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar onImportClick={() => setShowImport(true)} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">All Conversations</h1>
            <p className="text-xs text-[#6b7280]">Canonical ChatGPT export reader</p>
          </div>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="hidden shrink-0 rounded-lg bg-[#111827] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#10a37f]/30 sm:inline-flex"
          >
            + Import
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
            <section className="rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-[#10a37f]">Local-first release candidate</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[#111827]">chat-reader</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#4b5563]">
                Import ChatGPT exports, organize them into projects, search, edit, share, and export from a canonical local archive.
              </p>
            </section>

            <RecentItems compact />
            <ConversationList onImportClick={() => setShowImport(true)} />
          </div>
        </div>
      </section>

      {showImport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Import conversations</h2>
                <p className="text-xs text-[#6b7280]">Preview first, then commit to your local archive.</p>
              </div>
              <button
                type="button"
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
