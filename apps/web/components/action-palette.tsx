"use client";

import { Archive, BookmarkPlus, Clock3, Command, CopyCheck, Files, Highlighter, Library, Search, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImportDialog } from "./import-dialog-provider";
import { usePreferences } from "./preferences-provider";
import { useDialogFocus } from "./use-dialog-focus";

type Action = {
  id: string;
  label: string;
  keywords: string;
  icon: typeof Search;
  run: () => void;
};

export function ActionPalette() {
  const router = useRouter();
  const { openImportDialog } = useImportDialog();
  const { resolvedLocale, t } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  useDialogFocus({ open, rootRef, initialFocusRef: inputRef, onClose: () => setOpen(false) });

  useEffect(() => {
    const show = () => {
      setQuery("");
      setSelectedIndex(0);
      setOpen(true);
    };
    const close = () => setOpen(false);
    window.addEventListener("chat-reader:open-action-palette", show);
    window.addEventListener("chat-reader:close-action-palette", close);
    return () => {
      window.removeEventListener("chat-reader:open-action-palette", show);
      window.removeEventListener("chat-reader:close-action-palette", close);
    };
  }, []);

  const actions = useMemo<Action[]>(() => {
    const navigate = (href: string) => {
      setOpen(false);
      router.push(href);
    };
    return [
      { id: "search", label: t("search"), keywords: "search 搜索", icon: Search, run: () => navigate("/search") },
      { id: "import", label: t("importData"), keywords: "import 导入", icon: Upload, run: () => { setOpen(false); openImportDialog(); } },
      { id: "library", label: t("offlineLibrary"), keywords: "offline library 离线 资料库", icon: Library, run: () => navigate("/library") },
      { id: "recent", label: t("recent"), keywords: "recent 最近", icon: Clock3, run: () => navigate("/recent") },
      { id: "reading-list", label: zh ? "待读清单" : "Reading list", keywords: "reading list unread read 待读 已读", icon: BookmarkPlus, run: () => navigate("/reading-list") },
      { id: "annotation-inbox", label: zh ? "批注收件箱" : "Annotation inbox", keywords: "annotations highlights notes 批注 高亮 笔记", icon: Highlighter, run: () => navigate("/annotations") },
      { id: "file-directory", label: zh ? "文件目录" : "File directory", keywords: "files attachments directory 文件 附件 目录", icon: Files, run: () => navigate("/files") },
      { id: "duplicate-review", label: zh ? "重复项审查" : "Duplicate review", keywords: "duplicates exact review 重复 相同 审查", icon: CopyCheck, run: () => navigate("/duplicates") },
      { id: "archived", label: t("archived"), keywords: "archived archive 归档", icon: Archive, run: () => navigate("/archived") },
    ];
  }, [openImportDialog, router, t, zh]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleActions = actions.filter((action) => !normalizedQuery || `${action.label} ${action.keywords}`.toLocaleLowerCase().includes(normalizedQuery));
  const activeIndex = Math.min(selectedIndex, Math.max(0, visibleActions.length - 1));
  useEffect(() => {
    if (open) rootRef.current?.querySelector(`[data-action-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh] sm:pt-[16vh]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={rootRef} tabIndex={-1} className="w-full max-w-xl overflow-hidden rounded-xl border border-ui bg-raised shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="action-palette-title">
        <header className="flex items-center gap-3 border-b border-ui px-4 py-3">
          <Command className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="action-palette-title" className="sr-only">{zh ? "快捷操作" : "Quick actions"}</h2>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
              placeholder={zh ? "搜索操作…" : "Search actions…"}
              aria-label={zh ? "搜索快捷操作" : "Search quick actions"}
              role="combobox"
              aria-expanded="true"
              aria-controls="action-palette-options"
              aria-activedescendant={visibleActions[activeIndex] ? `action-palette-option-${visibleActions[activeIndex].id}` : undefined}
              className="w-full bg-transparent text-sm text-primary outline-none placeholder:text-secondary"
              data-testid="action-palette-input"
              onKeyDown={(event) => {
                if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex(Math.max(0, Math.min(visibleActions.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
                } else if (event.key === "Enter" && visibleActions[activeIndex]) {
                  event.preventDefault();
                  visibleActions[activeIndex].run();
                }
              }}
            />
          </div>
          <kbd className="hidden rounded border border-ui px-1.5 py-0.5 text-[11px] text-secondary sm:inline">Alt⇧P</kbd>
          <button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={t("close")}><X className="h-4 w-4" /></button>
        </header>
        <div id="action-palette-options" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2" role="listbox" aria-label={zh ? "快捷操作列表" : "Quick action list"}>
          {visibleActions.length ? visibleActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="option"
                id={`action-palette-option-${action.id}`}
                data-action-index={index}
                aria-selected={index === activeIndex}
                onClick={action.run}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-primary hover:bg-subtle focus:bg-subtle focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--focus)]"
                data-testid={`action-palette-${action.id}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {index === activeIndex ? <span className="text-xs text-secondary">↵</span> : null}
              </button>
            );
          }) : <p className="px-3 py-8 text-center text-sm text-secondary">{zh ? "没有匹配的操作。" : "No matching actions."}</p>}
        </div>
      </section>
    </div>
  );
}
