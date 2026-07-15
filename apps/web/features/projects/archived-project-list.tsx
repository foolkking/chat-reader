"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderArchive, RotateCcw } from "lucide-react";
import { getProjects, updateProject } from "../../lib/api";

export function ArchivedProjectList() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects", "archived"],
    queryFn: () => getProjects({ includeArchived: true }),
  });
  const restoreMutation = useMutation({
    mutationFn: (projectId: string) => updateProject(projectId, { is_archived: false }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
    },
  });
  const archivedProjects = (projectsQuery.data ?? []).filter((project) => project.is_archived);

  if (projectsQuery.isLoading) {
    return <p className="text-sm text-[#6b7280]">Loading archived projects...</p>;
  }
  if (projectsQuery.isError) {
    return <p className="text-sm text-red-700">{projectsQuery.error.message}</p>;
  }
  if (archivedProjects.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="archived-projects-heading">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <h2 id="archived-projects-heading" className="text-lg font-semibold text-[#111827]">Archived projects</h2>
          <p className="text-sm text-[#6b7280]">Restore a project to return its conversations to the project.</p>
        </div>
      </div>
      <div className="divide-y divide-[#ececec] overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
        {archivedProjects.map((project) => (
          <div key={project.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
            <FolderArchive className="h-4 w-4 shrink-0 text-[#6b7280]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#111827]">{project.name}</p>
              <p className="text-xs text-[#6b7280]">{project.conversation_count} active conversations</p>
            </div>
            <button
              type="button"
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(project.id)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8] disabled:cursor-wait disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
