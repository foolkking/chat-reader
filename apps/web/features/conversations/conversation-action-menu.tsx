"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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
  compact = false,
  closeSignal = 0,
  onChanged,
  onUndo,
}: {
  conversation: ConversationListItem | ProjectConversationRead;
  projectId?: string;
  projectPinned?: boolean;
  compact?: boolean;
  closeSignal?: number;
  onChanged?: () => Promise<void> | void;
  onUndo?: (undo: UndoAction) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [targetProjectId, setTargetProjectId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
    enabled: open,
  });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const syncPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const width = 288;
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
      setMenuPosition({ top: rect.bottom + 8, left });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center justify-center border text-sm font-semibold text-[#374151] transition hover:bg-[#f7f7f8] focus:outline-none focus:ring-2 focus:ring-[#10a37f] ${
          compact
            ? "h-7 w-7 rounded-md border-transparent bg-transparent shadow-none hover:border-[#d1d5db] hover:bg-white"
            : "h-9 w-9 rounded-lg border-[#d1d5db] bg-white shadow-sm"
        }`}
        aria-label={`Manage ${conversation.display_title || conversation.title}`}
      >
        ...
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[220] max-h-[min(620px,calc(100vh-24px))] w-72 overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-2xl"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <div className="border-b border-[#f0f0f0] px-2 py-2">
            <p className="truncate font-medium text-[#111827]">{conversation.display_title || conversation.title}</p>
            <p className="text-xs text-[#6b7280]">{conversation.message_count} messages</p>
          </div>
              <div className="grid gap-1 py-1">
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
                <div className="my-1 border-t border-[#f0f0f0] pt-2">
              <select
                value={targetProjectId}
                onChange={(event) => setTargetProjectId(event.target.value)}
                    className="min-h-9 w-full rounded-lg border border-[#d1d5db] bg-white px-2 text-sm text-[#111827] outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/10"
              >
                <option value="">Choose project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
                  <div className="mt-1 grid grid-cols-2 gap-1">
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
            {conversation.status === "archived" ? (
              <MenuButton
                disabled={busy !== null}
                onClick={() =>
                  run("restore", async () => {
                    await restoreConversation(conversation.id);
                    onUndo?.({
                      label: "已恢复会话",
                      action: async () => {
                        await archiveConversation(conversation.id);
                        await finish();
                      },
                    });
                  })
                }
              >
                Restore
              </MenuButton>
            ) : (
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
            )}
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
              {busy ? <p className="px-2 pb-1 text-xs text-[#6b7280]">Working...</p> : null}
            </div>,
            document.body,
          )
        : null}
    </>
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
      className={`min-h-9 rounded-lg px-3 text-left text-sm transition disabled:cursor-wait disabled:opacity-45 ${
        danger ? "text-red-700 hover:bg-red-50" : "text-[#374151] hover:bg-[#f7f7f8]"
      }`}
    >
      {children}
    </button>
  );
}
