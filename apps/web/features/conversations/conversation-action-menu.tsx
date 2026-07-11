"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  addConversationToProjectMembership,
  archiveConversation,
  deleteConversation,
  getConversationExportUrl,
  getProjects,
  removeConversationFromProjectMembership,
  restoreConversation,
  setConversationGlobalPin,
  setProjectConversationPin,
  updateConversation,
} from "../../lib/api";
import type { ConversationListItem, ProjectConversationRead } from "../../lib/types";

export type UndoAction = {
  label: string;
  action: () => Promise<void>;
};

export function ConversationActionMenu({
  conversation,
  projectId,
  projectPinned,
  onChanged,
  onUndo,
}: {
  conversation: ConversationListItem | ProjectConversationRead;
  projectId?: string;
  projectPinned?: boolean;
  onChanged?: () => Promise<void> | void;
  onUndo?: (undo: UndoAction) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
    enabled: open,
  });
  const projects = projectsQuery.data ?? [];

  async function finish() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      projectId ? queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["conversation", conversation.id] }),
    ]);
    await onChanged?.();
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      await finish();
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[#d1d5db] bg-white px-2 text-sm font-semibold text-[#374151] hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f]"
        aria-label={`Manage ${conversation.display_title || conversation.title}`}
      >
        ...
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-30 w-72 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm shadow-xl">
          <div className="mb-2 border-b border-[#f0f0f0] pb-2">
            <p className="truncate font-medium text-[#111827]">{conversation.display_title || conversation.title}</p>
            <p className="text-xs text-[#6b7280]">{conversation.message_count} messages</p>
          </div>
          <div className="grid gap-1">
            <MenuButton
              disabled={busy !== null}
              onClick={() =>
                run("rename", async () => {
                  const title = window.prompt("Rename conversation", conversation.display_title || conversation.title);
                  if (title === null) {
                    return;
                  }
                  const trimmed = title.trim();
                  if (!trimmed) {
                    window.alert("Title cannot be empty.");
                    return;
                  }
                  await updateConversation(conversation.id, { title: trimmed, display_title: trimmed });
                })
              }
            >
              Rename
            </MenuButton>
            <MenuButton
              disabled={busy !== null}
              onClick={() =>
                run("pin", async () => {
                  await setConversationGlobalPin(conversation.id, !conversation.is_global_pinned);
                })
              }
            >
              {conversation.is_global_pinned ? "Unpin globally" : "Pin globally"}
            </MenuButton>
            {projectId ? (
              <MenuButton
                disabled={busy !== null}
                onClick={() =>
                  run("project-pin", async () => {
                    await setProjectConversationPin(projectId, conversation.id, !projectPinned);
                  })
                }
              >
                {projectPinned ? "Unpin in project" : "Pin in project"}
              </MenuButton>
            ) : null}
            <div className="mt-1 grid gap-2 rounded-xl bg-[#f7f7f8] p-2">
              <select
                value={targetProjectId}
                onChange={(event) => setTargetProjectId(event.target.value)}
                className="min-h-10 rounded-lg border border-[#d1d5db] bg-white px-2 text-sm text-[#111827]"
              >
                <option value="">Choose project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <MenuButton
                  disabled={!targetProjectId || busy !== null}
                  onClick={() =>
                    run("add-project", async () => {
                      await addConversationToProjectMembership(conversation.id, targetProjectId);
                    })
                  }
                >
                  Add
                </MenuButton>
                <MenuButton
                  disabled={!targetProjectId || busy !== null}
                  onClick={() =>
                    run("move-project", async () => {
                      if (projectId && projectId !== targetProjectId) {
                        await removeConversationFromProjectMembership(conversation.id, projectId);
                      }
                      await addConversationToProjectMembership(conversation.id, targetProjectId);
                    })
                  }
                >
                  Move
                </MenuButton>
              </div>
            </div>
            {projectId ? (
              <MenuButton
                disabled={busy !== null}
                onClick={() =>
                  run("remove-project", async () => {
                    await removeConversationFromProjectMembership(conversation.id, projectId);
                  })
                }
              >
                Remove from project
              </MenuButton>
            ) : null}
            <MenuButton
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "markdown" });
              }}
            >
              Export Markdown
            </MenuButton>
            <MenuButton
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "canonical_json" });
              }}
            >
              Export JSON
            </MenuButton>
            <MenuButton
              disabled={busy !== null}
              onClick={() =>
                run("archive", async () => {
                  await archiveConversation(conversation.id);
                  onUndo?.({
                    label: "已归档会话",
                    action: async () => {
                      await restoreConversation(conversation.id);
                      await finish();
                    },
                  });
                })
              }
            >
              Archive
            </MenuButton>
            <MenuButton
              danger
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm("Delete this conversation? You can undo immediately.")) {
                  return;
                }
                void run("delete", async () => {
                  await deleteConversation(conversation.id);
                  onUndo?.({
                    label: "已删除会话",
                    action: async () => {
                      await restoreConversation(conversation.id);
                      await finish();
                    },
                  });
                });
              }}
            >
              Delete
            </MenuButton>
          </div>
          {busy ? <p className="mt-2 text-xs text-[#6b7280]">Working...</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-lg px-3 text-left text-sm disabled:cursor-wait disabled:opacity-60 ${
        danger ? "text-red-700 hover:bg-red-50" : "text-[#374151] hover:bg-[#f7f7f8]"
      }`}
    >
      {children}
    </button>
  );
}
