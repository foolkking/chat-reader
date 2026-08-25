"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  FileJson,
  FileText,
  FolderInput,
  History,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  StickyNote,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import {
  archiveConversation,
  getConversationExportUrl,
  getProjects,
  placeConversation,
  queueConversationBatchDelete,
  setConversationGlobalPin,
  setProjectConversationPin,
  unarchiveConversation,
  updateConversation,
} from "../../lib/api";
import type { BackgroundTaskRead, ConversationListItem, ProjectConversationRead } from "../../lib/types";

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
  onOpenChange,
}: {
  conversation: ConversationListItem | ProjectConversationRead;
  projectId?: string;
  projectPinned?: boolean;
  compact?: boolean;
  closeSignal?: number;
  onChanged?: () => Promise<void> | void;
  onUndo?: (undo: UndoAction) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const dialog = useInteractionDialog();
  const { resolvedLocale, projectSortMode, projectSortDirection } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 288, maxHeight: 620 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const title = conversation.display_title || conversation.title;

  const projectsQuery = useQuery({
    queryKey: ["projects", projectSortMode, projectSortDirection],
    queryFn: () => getProjects({ sort: projectSortMode, direction: projectSortDirection }),
    enabled: open,
  });
  const projects = (projectsQuery.data ?? []).filter(
    (project) => !project.is_default && project.name.toLowerCase().includes(projectSearch.trim().toLowerCase()),
  );

  useEffect(() => setOpen(false), [closeSignal]);

  useEffect(() => {
    onOpenChange?.(open);
    if (wasOpenRef.current && !open) buttonRef.current?.focus({ preventScroll: true });
    wasOpenRef.current = open;
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;

    const syncPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const width = Math.min(288, Math.max(0, window.innerWidth - viewportPadding * 2));
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      );
      const estimatedHeight = Math.min(620, window.innerHeight - viewportPadding * 2);
      const preferredTop = rect.bottom > window.innerHeight * 0.58
        ? rect.top - estimatedHeight - 8
        : rect.bottom + 8;
      const top = Math.min(
        Math.max(viewportPadding, preferredTop),
        Math.max(viewportPadding, window.innerHeight - 160),
      );
      setMenuPosition({
        top,
        left,
        width,
        maxHeight: Math.max(120, window.innerHeight - top - viewportPadding),
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
    // Always refresh the detail that was edited. The owning list already knows
    // its smallest safe refresh scope and handles it through onChanged; avoid
    // invalidating the same list queries twice after every menu action.
    await queryClient.invalidateQueries({ queryKey: ["conversation", conversation.id] });
    if (onChanged) {
      await onChanged();
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      projectId
        ? queryClient.invalidateQueries({ queryKey: ["project-conversations", projectId] })
        : Promise.resolve(),
    ]);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
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
        data-no-dnd
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={`inline-flex items-center justify-center border text-sm font-semibold text-secondary transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${
          compact
            ? "h-7 w-7 rounded-md border-transparent bg-transparent shadow-none hover:border-ui hover:bg-surface"
            : "h-9 w-9 rounded-lg border-ui bg-surface shadow-sm"
        }`}
        aria-label={`${zh ? "管理" : "Manage"} ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${zh ? "对话操作" : "Conversation actions"} ${title}`}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                const items = Array.from(
                  menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
                );
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  items[(current + delta + items.length) % items.length]?.focus();
                } else if (event.key === "Home") {
                  event.preventDefault();
                  items[0]?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  items.at(-1)?.focus();
                }
              }}
              className="fixed z-[220] overflow-y-auto rounded-xl border border-ui bg-raised p-2 text-sm shadow-2xl"
              style={menuPosition}
            >
              <div className="grid gap-1 py-1">
                <MenuButton
                  icon={<Pencil className="h-4 w-4" />}
                  disabled={busy !== null}
                  onClick={() => void run("rename", async () => {
                    const nextTitle = await dialog.prompt({
                      title: zh ? "重命名对话" : "Rename conversation",
                      label: zh ? "对话标题" : "Conversation title",
                      initialValue: title,
                      confirmLabel: zh ? "保存" : "Save",
                    });
                    if (nextTitle === null) return;
                    const trimmed = nextTitle.trim();
                    if (trimmed) await updateConversation(conversation.id, { title: trimmed, display_title: trimmed });
                  })}
                >
                  {zh ? "重命名对话" : "Rename conversation"}
                </MenuButton>

                <MenuButton
                  icon={<StickyNote className="h-4 w-4" />}
                  disabled={busy !== null}
                  onClick={() => void run("description", async () => {
                    const description = await dialog.prompt({
                      title: zh ? "编辑简介" : "Edit description",
                      label: zh ? "Markdown 简介（最多 500 字）" : "Markdown description (500 characters max)",
                      initialValue: conversation.description_markdown ?? "",
                      confirmLabel: zh ? "保存" : "Save",
                    });
                    if (description !== null) {
                      await updateConversation(conversation.id, { description_markdown: description.slice(0, 500) });
                    }
                  })}
                >
                  {zh ? "编辑简介" : "Edit description"}
                </MenuButton>

                <MenuButton
                  icon={<MessageSquareText className="h-4 w-4" />}
                  disabled={busy !== null}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/conversations/${conversation.id}?annotations=open`);
                  }}
                >
                  {zh ? "打开批注" : "Open annotations"}
                </MenuButton>

                <MenuButton
                  icon={conversation.is_global_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  disabled={busy !== null}
                  onClick={() => void run("pin", async () => {
                    await setConversationGlobalPin(conversation.id, !conversation.is_global_pinned);
                  })}
                >
                  {conversation.is_global_pinned ? (zh ? "取消置顶" : "Unpin") : (zh ? "置顶" : "Pin")}
                </MenuButton>

                {projectId ? (
                  <MenuButton
                    icon={projectPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => void run("project-pin", async () => {
                      await setProjectConversationPin(projectId, conversation.id, !projectPinned);
                    })}
                  >
                    {projectPinned
                      ? (zh ? "取消项目内置顶" : "Unpin in project")
                      : (zh ? "在项目内置顶" : "Pin in project")}
                  </MenuButton>
                ) : null}

                {conversation.status !== "archived" ? (
                  <div className="my-1 border-t border-ui pt-1">
                    <MenuButton
                      icon={<FolderInput className="h-4 w-4" />}
                      disabled={busy !== null}
                      onClick={() => setShowProjectPicker((value) => !value)}
                    >
                      {zh ? "移动到项目" : "Move to project"}
                    </MenuButton>
                    {showProjectPicker ? (
                      <div className="mt-1 rounded-lg bg-subtle p-2">
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
                              className={`block min-h-8 w-full truncate rounded-md px-2 text-left text-sm ${
                                targetProjectId === project.id
                                  ? "bg-surface font-medium text-primary shadow-sm"
                                  : "text-secondary hover:bg-surface"
                              }`}
                            >
                              {project.name}
                            </button>
                          ))}
                          {projects.length === 0 ? (
                            <p className="px-2 py-1.5 text-xs text-secondary">
                              {zh ? "没有匹配的项目" : "No matching projects"}
                            </p>
                          ) : null}
                        </div>
                        <MenuButton
                          icon={<FolderInput className="h-4 w-4" />}
                          disabled={!targetProjectId || busy !== null}
                          onClick={() => void run("move-project", async () => {
                            await placeConversation(conversation.id, {
                              target_project_id: targetProjectId,
                              target_section: "normal",
                              expected_offline_revision: conversation.offline_revision,
                            });
                          })}
                        >
                          {zh ? "移动到所选项目" : "Move to selected project"}
                        </MenuButton>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {projectId && conversation.status !== "archived" ? (
                  <MenuButton
                    icon={<History className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => void run("remove-project", async () => {
                      await placeConversation(conversation.id, {
                        target_project_id: null,
                        target_section: "normal",
                        expected_offline_revision: conversation.offline_revision,
                      });
                    })}
                  >
                    {zh ? "移到未分类" : "Move to unclassified"}
                  </MenuButton>
                ) : null}

                <div className="my-1 border-t border-ui pt-1">
                  <MenuButton
                    icon={<FileText className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => {
                      triggerConversationDownload(getConversationExportUrl(conversation.id, {
                        format: "markdown_v2",
                        tocMode: "none",
                      }));
                      setOpen(false);
                    }}
                  >
                    {zh ? "导出 Markdown" : "Export Markdown"}
                  </MenuButton>
                  <MenuButton
                    icon={<FileJson className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => {
                      triggerConversationDownload(getConversationExportUrl(conversation.id, { format: "canjson_v2" }));
                      setOpen(false);
                    }}
                  >
                    {zh ? "导出 CanJSON" : "Export CanJSON"}
                  </MenuButton>
                </div>

                {conversation.status === "archived" ? (
                  <MenuButton
                    icon={<RotateCcw className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => void run("unarchive", async () => {
                      await unarchiveConversation(conversation.id);
                      onUndo?.({
                        label: zh ? "对话已取消归档" : "Conversation unarchived",
                        action: async () => {
                          await archiveConversation(conversation.id);
                          await finish();
                        },
                      });
                    })}
                  >
                    {zh ? "取消归档" : "Unarchive"}
                  </MenuButton>
                ) : (
                  <MenuButton
                    icon={<Archive className="h-4 w-4" />}
                    disabled={busy !== null}
                    onClick={() => void (async () => {
                      const confirmed = await dialog.confirm({
                        title: zh ? `归档“${title}”？` : `Archive “${title}”?`,
                        description: zh
                          ? "归档后会从常规列表隐藏，可以从归档列表恢复。"
                          : "It will be hidden from regular lists and can be restored from the archive.",
                        confirmLabel: zh ? "归档" : "Archive",
                      });
                      if (!confirmed) return;
                      await run("archive", async () => {
                        await archiveConversation(conversation.id);
                        onUndo?.({
                          label: zh ? "对话已归档" : "Conversation archived",
                          action: async () => {
                            await unarchiveConversation(conversation.id);
                            await finish();
                          },
                        });
                      });
                      if (pathname === `/conversations/${conversation.id}`) router.replace("/archived");
                    })()}
                  >
                    {zh ? "归档对话" : "Archive conversation"}
                  </MenuButton>
                )}

                <MenuButton
                  icon={<Trash2 className="h-4 w-4" />}
                  danger
                  disabled={busy !== null}
                  onClick={() => void (async () => {
                    const confirmed = await dialog.confirm({
                      title: zh ? `永久删除“${title}”？` : `Permanently delete “${title}”?`,
                      description: zh
                        ? "对话会在后台删除，无法在系统内恢复；可在任务区域查看进度。"
                        : "The conversation and its version history will be deleted in the background. It cannot be restored in the app.",
                      confirmLabel: zh ? "永久删除" : "Delete permanently",
                      danger: true,
                    });
                    if (!confirmed) return;
                    setBusy("delete");
                    try {
                      const task = await queueConversationBatchDelete([conversation.id]);
                      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (current = []) => [
                        task,
                        ...current.filter((item) => item.job_id !== task.job_id),
                      ]);
                    } finally {
                      setBusy(null);
                      setOpen(false);
                    }
                    if (pathname === `/conversations/${conversation.id}`) router.replace("/");
                  })()}
                >
                  {zh ? "永久删除对话" : "Delete permanently"}
                </MenuButton>
              </div>
              {busy ? (
                <p role="status" className="px-2 pb-1 text-xs text-secondary">
                  {zh ? "正在处理…" : "Working…"}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function triggerConversationDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
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
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition disabled:cursor-wait disabled:opacity-45 ${
        danger ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "text-primary hover:bg-subtle"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
