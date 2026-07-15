"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addConversationToProject, getProjects } from "../../lib/api";

export function AddToProjectControl({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const addMutation = useMutation({
    mutationFn: () => addConversationToProject(projectId, conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-conversations"] });
    },
  });

  const projects = projectsQuery.data ?? [];

  return (
    <div className="inline-flex min-h-9 items-center overflow-hidden rounded-xl border border-[#d1d5db] bg-white shadow-sm">
      <select
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
        className="h-9 min-w-[124px] border-0 bg-transparent px-2 text-xs text-[#374151] outline-none"
      >
        <option value="">Project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!projectId || addMutation.isPending}
        onClick={() => addMutation.mutate()}
        className="h-9 border-l border-[#e5e5e5] bg-[#111827] px-2.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-[#d1d5db]"
      >
        +
      </button>
      {addMutation.isSuccess ? <span className="sr-only">Added</span> : null}
      {addMutation.isError ? <span className="sr-only">{addMutation.error.message}</span> : null}
    </div>
  );
}
