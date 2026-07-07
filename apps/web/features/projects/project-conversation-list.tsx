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
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8] text-[#111827]">
        <ProjectSidebar currentProjectId={projectId} />
        <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-[#e5e5e5] bg-white/95 px-4 pl-16 backdrop-blur md:px-6 md:pl-6">
            <div>
              <h1 className="text-base font-semibold">{project?.name ?? "Project"}</h1>
              <p className="text-xs text-[#6b7280]">
                {project?.conversation_count ?? 0} conversations / {project?.pinned_count ?? 0} pinned
              </p>
            </div>
          </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-6">
              {conversationsQuery.isLoading ? <StateBlock label="Loading project conversations" /> : null}
              {conversationsQuery.isError ? <StateBlock label={conversationsQuery.error.message} /> : null}
              {conversationsQuery.isSuccess && conversationsQuery.data.length === 0 ? (
                <StateBlock label="No conversations in this project" />
              ) : null}

          {conversationsQuery.isSuccess && conversationsQuery.data.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
              {conversationsQuery.data.map((conversation) => (
                <article key={conversation.id} className="space-y-3 border-b border-[#f0f0f0] px-5 py-4 last:border-b-0 hover:bg-[#f7f7f8]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/conversations/${conversation.id}`}>
                        <h2 className="truncate text-base font-semibold text-[#111827]">
                          {conversation.project_relation.is_pinned ? "Pinned / " : ""}
                          {conversation.display_title || conversation.title}
                        </h2>
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#6b7280]">
                        {conversation.first_user_message ?? "No first user message."}
                      </p>
                    </div>
                    <p className="text-sm text-[#6b7280]">{conversation.message_count} messages</p>
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
                      className="rounded-lg border border-[#d1d5db] px-2.5 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
            </div>
          </div>
        </section>
    </main>
  );
}

function StateBlock({ label }: { label: string }) {
  return <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-sm text-[#6b7280] shadow-sm">{label}</div>;
}
