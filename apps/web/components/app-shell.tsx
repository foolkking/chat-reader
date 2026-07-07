import { ConversationList } from "../features/conversations/conversation-list";
import { ImportPanel } from "../features/import/import-panel";

export function AppShell() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-normal text-slate-500">
            Stage 05: Basic Reader
          </p>
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950">chat-reader</h1>
          <p className="max-w-2xl text-base leading-7 text-slate-700">
            Import ChatGPT export files, commit canonical conversations, and open a basic reader view.
          </p>
        </header>

        <ImportPanel />
        <ConversationList />
      </div>
    </main>
  );
}
