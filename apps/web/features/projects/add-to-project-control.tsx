"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addConversationToProject, getProjects } from "../../lib/api";

export function AddToProjectControl({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
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
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
      >
        <option value="">Add to project</option>
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
        className="rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Add
      </button>
      {addMutation.isSuccess ? <span className="text-xs text-emerald-700">Added</span> : null}
      {addMutation.isError ? <span className="text-xs text-red-700">{addMutation.error.message}</span> : null}
    </div>
  );
}
