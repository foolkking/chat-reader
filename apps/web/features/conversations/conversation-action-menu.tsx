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
  MessageSquareText,
  StickyNote,
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
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

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
  const { resolvedLocale, projectSortMode, projectSortDirection } = usePreferences();
  const dialog = useInteractionDialog();
  const zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [targetProjectId, setTargetProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects", projectSortMode, projectSortDirection],
    queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }),
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
        className={`inline-flex items-center justify-center border text-sm font-semibold text-secondary transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${
          compact
            ? "h-7 w-7 rounded-md border-transparent bg-transparent shadow-none hover:border-ui hover:bg-surface"
            : "h-9 w-9 rounded-lg border-ui bg-surface shadow-sm"
        }`}
        aria-label={`${zh ? "管理" : "Manage"} ${conversation.display_title || conversation.title}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[220] max-h-[min(620px,calc(100vh-24px))] w-72 overflow-y-auto rounded-xl border border-ui bg-raised p-2 text-sm shadow-2xl"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <div className="grid gap-1 py-1">
            {compact ? <MenuButton
              icon={<StickyNote className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => run("description", async () => {
                const description = await dialog.prompt({
                  title: zh ? "编辑简介" : "Edit description",
                  label: zh ? "Markdown 简介（最多 500 字）" : "Markdown description (500 characters max)",
                  initialValue: conversation.description_markdown ?? "",
                  confirmLabel: zh ? "保存" : "Save",
                });
                if (description !== null) await updateConversation(conversation.id, { description_markdown: description.slice(0, 500) });
              })}
            >{zh ? "编辑简介" : "Edit description"}</MenuButton> : null}
            {compact ? <MenuButton
              icon={<MessageSquareText className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => { window.location.href = `/conversations/${conversation.id}?annotations=open`; }}
            >{zh ? "打开批注" : "Open annotations"}</MenuButton> : null}
            <MenuButton
              icon={<Pencil className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() =>
                run("rename", async () => {
                  const title = await dialog.prompt({
                    title: zh ? "重命名对话" : "Rename conversation",
                    label: zh ? "对话标题" : "Conversation title",
                    initialValue: conversation.display_title || conversation.title,
                    confirmLabel: zh ? "保存" : "Save",
                  });
                  if (title === null) {
                    return;
                  }
                  const trimmed = title.trim();
                  await updateConversation(conversation.id, { title: trimmed, display_title: trimmed });
                })
              }
            >
              {zh ? "重命名" : "Rename"}
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
              {conversation.is_global_pinned ? (zh ? "取消置顶" : "Unpin") : (zh ? "置顶" : "Pin")}
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
                {projectPinned ? (zh ? "取消项目内置顶" : "Unpin in project") : (zh ? "在项目内置顶" : "Pin in project")}
              </MenuButton>
            ) : null}
            {conversation.status !== "archived" ? <div className="my-1 border-t border-ui pt-1">
              <MenuButton icon={<FolderInput className="h-4 w-4" />} disabled={busy !== null} onClick={() => setShowProjectPicker((value) => !value)}>{zh ? "移动到项目" : "Move to project"}</MenuButton>
              {showProjectPicker ? <div className="mt-1 rounded-lg bg-subtle p-2">
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder={zh ? "搜索项目" : "Search projects"}
                className="min-h-9 w-full rounded-lg border border-ui bg-surface px-2 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]"
              />
              <div className="mt-1 max-h-32 overflow-y-auto rounded-lg bg-subtle p-1">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setTargetProjectId(project.id)}
                    className={`block min-h-8 w-full truncate rounded-md px-2 text-left text-sm ${targetProjectId === project.id ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:bg-surface"}`}
                  >
                    {project.name}
                  </button>
                ))}
                {projects.length === 0 ? <p className="px-2 py-1.5 text-xs text-secondary">{zh ? "没有匹配的项目" : "No matching projects"}</p> : null}
              </div>
              <MenuButton
                icon={<FolderInput className="h-4 w-4" />}
                disabled={!targetProjectId || busy !== null}
                onClick={() => run("move-project", async () => { await moveConversationToProject(conversation.id, targetProjectId); })}
              >
                {zh ? "移动到所选项目" : "Move to selected project"}
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
                {zh ? "移回对话记录" : "Move to conversation history"}
              </MenuButton>
            ) : null}
            {!compact ? <><MenuButton
              icon={<FileText className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "markdown" });
              }}
            >
              {zh ? "导出 Markdown" : "Export Markdown"}
            </MenuButton>
            <MenuButton
              icon={<FileJson className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() => {
                window.location.href = getConversationExportUrl(conversation.id, { format: "canonical_json" });
              }}
            >
              {zh ? "导出 Canonical JSON" : "Export Canonical JSON"}
            </MenuButton>
            </> : null}
            {!compact && (conversation.status === "archived" ? (
              <MenuButton
                icon={<RotateCcw className="h-4 w-4" />}
                disabled={busy !== null}
                onClick={() =>
                  run("restore", async () => {
                    await restoreConversation(conversation.id);
                    onUndo?.({
                      label: zh ? "已恢复会话" : "Conversation restored",
                      action: async () => {
                        await archiveConversation(conversation.id);
                        await finish();
                      },
                    });
                  })
                }
              >
                {zh ? "恢复" : "Restore"}
              </MenuButton>
            ) : (
              <MenuButton
                icon={<Archive className="h-4 w-4" />}
                disabled={busy !== null}
                onClick={() =>
                  run("archive", async () => {
                    await archiveConversation(conversation.id);
                    onUndo?.({
                      label: zh ? "已归档会话" : "Conversation archived",
                      action: async () => {
                        await restoreConversation(conversation.id);
                        await finish();
                      },
                    });
                  })
                }
              >
                {zh ? "归档" : "Archive"}
              </MenuButton>
            ))}
            {!compact ? <MenuButton
              icon={<Trash2 className="h-4 w-4" />}
              danger
              disabled={busy !== null}
              onClick={() => {
                void (async () => {
                  const confirmed = await dialog.confirm({
                    title: zh ? "删除这个对话？" : "Delete this conversation?",
                    description: zh ? "删除后可立即撤销。" : "You can undo immediately afterward.",
                    confirmLabel: zh ? "删除" : "Delete",
                    danger: true,
                  });
                  if (!confirmed) return;
                  await run("delete", async () => {
                  await deleteConversation(conversation.id);
                  onUndo?.({
                    label: zh ? "已删除会话" : "Conversation deleted",
                    action: async () => {
                      await restoreConversation(conversation.id);
                      await finish();
                    },
                  });
                  });
                })();
              }}
            >
              {zh ? "删除" : "Delete"}
            </MenuButton> : null}
          </div>
              {busy ? <p role="status" className="px-2 pb-1 text-xs text-secondary">{zh ? "正在处理…" : "Working…"}</p> : null}
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
        danger ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "text-primary hover:bg-subtle"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
