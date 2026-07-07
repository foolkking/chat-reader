import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { RecentItems } from "../../features/reading/recent-items";

export default function RecentPage() {
  return (
    <main className="flex min-h-screen bg-[#f7f7f8] text-[#111827]">
      <ProjectSidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-[#e5e5e5] bg-white/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-base font-semibold">Recent</h1>
            <p className="text-xs text-[#6b7280]">Recently opened conversations</p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-8">
            <RecentItems />
          </div>
        </div>
      </section>
    </main>
  );
}
