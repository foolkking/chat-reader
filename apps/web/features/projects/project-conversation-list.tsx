"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  getProjectConversations,
  getProjects,
  removeConversationFromProject,
} from "../../lib/api";
import { PinButton } from "../reading/pin-button";
import { ProjectSidebar } from "./project-sidebar";

export function ProjectConversationList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", projectId],
    queryFn: () => getProjectConversations(projectId),
  });
  const removeMutation = useMutation({
    mutationFn: (conversationId: string) => removeConversationFromProject(projectId, conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const project = projectsQuery.data?.find((item) => item.id === projectId);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ProjectSidebar currentProjectId={projectId} />
        <section className="min-w-0 space-y-5">
          <header>
            <p className="text-sm font-medium uppercase tracking-normal text-slate-500">Project</p>
            <h1 className="mt-1 text-3xl font-semibold">{project?.name ?? "Project"}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {project?.conversation_count ?? 0} conversations / {project?.pinned_count ?? 0} pinned
            </p>
          </header>

          {conversationsQuery.isLoading ? <StateBlock label="Loading project conversations" /> : null}
          {conversationsQuery.isError ? <StateBlock label={conversationsQuery.error.message} /> : null}
          {conversationsQuery.isSuccess && conversationsQuery.data.length === 0 ? (
            <StateBlock label="No conversations in this project" />
          ) : null}

          {conversationsQuery.isSuccess && conversationsQuery.data.length > 0 ? (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {conversationsQuery.data.map((conversation) => (
                <article key={conversation.id} className="space-y-3 px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/conversations/${conversation.id}`}>
                        <h2 className="truncate text-base font-semibold text-slate-950">
                          {conversation.project_relation.is_pinned ? "Pinned / " : ""}
                          {conversation.display_title || conversation.title}
                        </h2>
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                        {conversation.first_user_message ?? "No first user message."}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600">{conversation.message_count} messages</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PinButton
                      scope="project"
                      projectId={projectId}
                      conversationId={conversation.id}
                      isPinned={conversation.project_relation.is_pinned}
                    />
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(conversation.id)}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">{label}</div>;
}
