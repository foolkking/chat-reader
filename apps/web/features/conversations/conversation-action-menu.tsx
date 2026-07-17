"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  FileJson,
  FileText,
  FolderInput,
  History,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  archiveConversation,
  deleteConversation,
  getConversationExportUrl,
  getProjects,
  moveConversationToProject,
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
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
    enabled: open,
  });
  const projects = (projectsQuery.data ?? []).filter(
    (project) => !project.is_default && project.name.toLowerCase().includes(projectSearch.trim().toLowerCase()),
  );

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
      const top = rect.bottom > window.innerHeight * 0.58 ? Math.max(12, rect.top - 430) : rect.bottom + 8;
      setMenuPosition({ top, left });
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
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[220] max-h-[min(620px,calc(100vh-24px))] w-72 overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white p-2 text-sm shadow-2xl"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <div className="grid gap-1 py-1">
            <MenuButton
              icon={<Pencil className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() =>
                run("rename", async () => {
                  const title = window.prompt("重命名对话", conversation.display_title || conversation.title);
                  if (title === null) {
                    return;
                  }
                  const trimmed = title.trim();
                  if (!trimmed) {
                    window.alert("标题不能为空。");
                    return;
                  }
                  await updateConversation(conversation.id, { title: trimmed, display_title: trimmed });
                })
              }
            >
              重命名
            </MenuButton>
            <MenuButton
              icon={conversation.is_global_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() =>
                run("pin", async () => {
                  await setConversationGlobalPin(conversation.id, !conversation.is_global_pinned);
                })
              }
            >
              {conversation.is_global_pinned ? "取消置顶" : "置顶"}
            </MenuButton>
            {projectId ? (
              <MenuButton
                icon={projectPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                disabled={busy !== null}
                onClick={() =>
                  run("project-pin", async () => {
                    await setProjectConversationPin(projectId, conversation.id, !projectPinned);
                  })
                }
              >
                {projectPinned ? "取消项目内置顶" : "在项目内置顶"}
              </MenuButton>
            ) : null}
            {conversation.status !== "archived" ? <div className="my-1 border-t border-[#f0f0f0] pt-1">
              <MenuButton icon={<FolderInput className="h-4 w-4" />} disabled={busy !== null} onClick={() => setShowProjectPicker((value) => !value)}>移动到项目</MenuButton>
              {showProjectPicker ? <div className="mt-1 rounded-lg bg-[#f7f7f8] p-2">
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="搜索项目"
                className="min-h-9 w-full rounded-lg border border-[#d1d5db] bg-white px-2 text-sm text-[#111827] outline-none focus:border-[#10a37f] focus:ring-2 focus:ring-[#10a37f]/10"
              />
              <div className="mt-1 max-h-32 overflow-y-auto rounded-lg bg-[#f7f7f8] p-1">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setTargetProjectId(project.id)}
                    className={`block min-h-8 w-full truncate rounded-md px-2 text-left text-sm ${targetProjectId === project.id ? "bg-white font-medium text-[#111827] shadow-sm" : "text-[#4b5563] hover:bg-white"}`}
                  >
                    {project.name}
                  </button>
                ))}
                {projects.length === 0 ? <p className="px-2 py-1.5 text-xs text-[#9ca3af]">没有匹配的项目</p> : null}
              </div>
              <MenuButton
                icon={<FolderInput className="h-4 w-4" />}
                disabled={!targetProjectId || busy !== null}
                onClick={() => run("move-project", async () => { await moveConversationToProject(conversation.id, targetProjectId); })}
              >
                移动到所选项目
              </MenuButton>
              </div> : null}
            </div> : null}
            {projectId && conversation.status !== "archived" ? (
              <MenuButton
                icon={<History className="h-4 w-4" />}
                disabled={busy !== null}
                onClick={() =>
                  run("remove-project", async () => {
                    await moveConversationToProject(conversation.id, null);
                  })
                }
              >
                移回对话记录
              </MenuButton>
            ) : null}
            <MenuButton
              icon={<FileText className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "markdown" });
              }}
            >
              导出 Markdown
            </MenuButton>
            <MenuButton
              icon={<FileJson className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "canonical_json" });
              }}
            >
              导出 Canonical JSON
            </MenuButton>
            {conversation.status === "archived" ? (
              <MenuButton
                icon={<RotateCcw className="h-4 w-4" />}
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
                恢复
              </MenuButton>
            ) : (
              <MenuButton
                icon={<Archive className="h-4 w-4" />}
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
                归档
              </MenuButton>
            )}
            <MenuButton
              icon={<Trash2 className="h-4 w-4" />}
              danger
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm("删除这个对话？此操作完成后可立即撤销。")) {
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
              删除
            </MenuButton>
          </div>
              {busy ? <p role="status" className="px-2 pb-1 text-xs text-[#6b7280]">正在处理…</p> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuButton({
  children,
  icon,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-left text-sm transition disabled:cursor-wait disabled:opacity-45 ${
        danger ? "text-red-700 hover:bg-red-50" : "text-[#374151] hover:bg-[#f7f7f8]"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
