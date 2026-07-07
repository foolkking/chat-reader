import { ConversationList } from "../features/conversations/conversation-list";
import { ImportPanel } from "../features/import/import-panel";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { RecentItems } from "../features/reading/recent-items";

export function AppShell() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProjectSidebar />

        <div className="flex min-w-0 flex-col gap-6">
          <header className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-normal text-slate-500">
              Stage 06: Projects / Pins / Reading Position
            </p>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-950">chat-reader</h1>
            <p className="max-w-2xl text-base leading-7 text-slate-700">
              Import, organize, pin, and continue reading canonical conversations.
            </p>
          </header>

          <ImportPanel />
          <RecentItems compact />
          <ConversationList />
        </div>
      </div>
    </main>
  );
}
