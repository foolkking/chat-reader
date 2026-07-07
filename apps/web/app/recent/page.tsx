import { ProjectSidebar } from "../../features/projects/project-sidebar";
import { RecentItems } from "../../features/reading/recent-items";

export default function RecentPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProjectSidebar />
        <RecentItems />
      </div>
    </main>
  );
}
