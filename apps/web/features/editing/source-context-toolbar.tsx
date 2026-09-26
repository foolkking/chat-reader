"use client";

import {
  AlignLeft,
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MoreHorizontal,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type SourceEditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "underline"
  | "code"
  | "heading"
  | "quote"
  | "rule"
  | "code-block"
  | "bullets"
  | "numbered"
  | "tasks"
  | "link"
  | "table"
  | "attachment"
  | "undo"
  | "redo"
  | "format";

export type SourceContextToolbarPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

type CommandItem = {
  command: SourceEditorCommand;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  compactHidden?: boolean;
  compactOnly?: boolean;
};

export function SourceContextToolbar({
  open,
  position,
  zh,
  overflowOpen,
  activeCommands,
  onOverflowChange,
  onCommand,
  onClose,
  onMeasure,
}: {
  open: boolean;
  position: SourceContextToolbarPosition | null;
  zh: boolean;
  overflowOpen: boolean;
  activeCommands: ReadonlySet<SourceEditorCommand>;
  onOverflowChange: (open: boolean) => void;
  onCommand: (command: SourceEditorCommand) => void;
  onClose: (restoreEditorFocus: boolean) => void;
  onMeasure: (width: number, height: number) => void;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const primaryGroups = useMemo<CommandItem[][]>(() => [
    [
      item("bold", zh ? "加粗" : "Bold", <Bold />, "Ctrl+B"),
      item("italic", zh ? "斜体" : "Italic", <Italic />, "Ctrl+I"),
      item("strike", zh ? "删除线" : "Strikethrough", <Strikethrough />),
      item("code", zh ? "行内代码" : "Inline code", <Code2 />),
    ],
    [
      item("heading", zh ? "转换为标题" : "Convert to heading", <Heading2 />),
      { ...item("quote", zh ? "引用" : "Quote", <Quote />), compactHidden: true },
      item("bullets", zh ? "无序列表" : "Bulleted list", <List />),
      { ...item("numbered", zh ? "有序列表" : "Numbered list", <ListOrdered />), compactHidden: true },
      { ...item("tasks", zh ? "任务清单" : "Task list", <ListTodo />), compactHidden: true },
    ],
    [
      item("link", zh ? "插入链接" : "Insert link", <Link2 />),
      { ...item("code-block", zh ? "代码块" : "Code block", <Code2 />), compactHidden: true },
    ],
  ], [zh]);

  const overflowItems = useMemo<CommandItem[]>(() => [
    { ...item("quote", zh ? "引用" : "Quote", <Quote />), compactOnly: true },
    { ...item("numbered", zh ? "有序列表" : "Numbered list", <ListOrdered />), compactOnly: true },
    { ...item("tasks", zh ? "任务清单" : "Task list", <ListTodo />), compactOnly: true },
    { ...item("code-block", zh ? "代码块" : "Code block", <Code2 />), compactOnly: true },
    item("underline", zh ? "下划线" : "Underline", <Underline />),
    item("rule", zh ? "分隔线" : "Horizontal rule", <Minus />),
    item("table", zh ? "插入表格" : "Insert table", <Table2 />),
    item("attachment", zh ? "插入附件引用" : "Insert attachment reference", <Paperclip />),
    item("format", zh ? "格式化当前段落" : "Format paragraph", <AlignLeft />),
    item("undo", zh ? "撤销" : "Undo", <Undo2 />, "Ctrl+Z"),
    item("redo", zh ? "重做" : "Redo", <Redo2 />, "Ctrl+Y"),
  ], [zh]);

  useEffect(() => {
    if (!open || !toolbarRef.current) return;
    const node = toolbarRef.current;
    const measure = () => onMeasure(node.offsetWidth, node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMeasure, open]);

  if (!open || !position || typeof document === "undefined") return null;

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "Tab") {
      onClose(false);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      toolbarRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-source-toolbar-command]:not(:disabled)",
      ) ?? [],
    ).filter((button) => button.offsetParent !== null);
    if (!buttons.length) return;
    event.preventDefault();
    const currentIndex = Math.max(
      0,
      buttons.indexOf(document.activeElement as HTMLButtonElement),
    );
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  return createPortal(
    <div
      ref={toolbarRef}
      id="source-editor-tools"
      data-testid="source-editor-tools"
      data-placement={position.placement}
      role="toolbar"
      aria-label={zh ? "Markdown 格式工具" : "Markdown formatting tools"}
      onKeyDown={handleKeyboard}
      className="source-context-toolbar fixed z-[200] flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-lg border border-ui bg-raised p-1 text-secondary shadow-[var(--shadow-medium)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{ left: position.left, top: position.top }}
    >
      {primaryGroups.map((group, groupIndex) => (
        <div key={groupIndex} className="contents">
          {groupIndex > 0 ? (
            <span
              className="mx-1 h-[18px] w-px shrink-0 bg-[var(--border)]"
              aria-hidden="true"
            />
          ) : null}
          {group.map((command, index) => (
            <ToolbarIconButton
              key={command.command}
              item={{ ...command, active: activeCommands.has(command.command) }}
              tabIndex={groupIndex === 0 && index === 0 ? 0 : -1}
              onCommand={onCommand}
              tooltipPlacement={position.placement}
            />
          ))}
        </div>
      ))}
      <span
        className="mx-1 h-[18px] w-px shrink-0 bg-[var(--border)]"
        aria-hidden="true"
      />
      <div className="relative">
        <button
          type="button"
          data-source-toolbar-command="more"
          aria-label={zh ? "更多格式" : "More formatting"}
          aria-expanded={overflowOpen}
          aria-controls="source-editor-tools-overflow"
          tabIndex={-1}
          onPointerDown={preserveSelection}
          onClick={() => onOverflowChange(!overflowOpen)}
          className={buttonClass(overflowOpen)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          <ToolbarTooltip
            label={zh ? "更多格式" : "More formatting"}
            placement={position.placement}
          />
        </button>
        {overflowOpen ? (
          <div
            id="source-editor-tools-overflow"
            className={
              (position.placement === "above"
                ? "bottom-[calc(100%+6px)]"
                : "top-[calc(100%+6px)]")
              + " absolute right-0 grid grid-cols-4 gap-0.5 rounded-lg border border-ui bg-raised p-1 shadow-[var(--shadow-medium)]"
            }
          >
            {overflowItems.map((command) => (
              <ToolbarIconButton
                key={command.command}
                item={{ ...command, active: activeCommands.has(command.command) }}
                tabIndex={-1}
                onCommand={onCommand}
                tooltipPlacement={position.placement === "above" ? "below" : "above"}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function item(
  command: SourceEditorCommand,
  label: string,
  icon: ReactNode,
  shortcut?: string,
): CommandItem {
  return { command, label, icon, shortcut };
}

function ToolbarIconButton({
  item,
  tabIndex,
  onCommand,
  tooltipPlacement = "above",
}: {
  item: CommandItem;
  tabIndex: number;
  onCommand: (command: SourceEditorCommand) => void;
  tooltipPlacement?: "above" | "below";
}) {
  return (
    <button
      type="button"
      data-source-toolbar-command={item.command}
      aria-label={item.shortcut ? item.label + " · " + item.shortcut : item.label}
      aria-pressed={item.active || undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      tabIndex={tabIndex}
      onPointerDown={preserveSelection}
      onClick={() => onCommand(item.command)}
      className={buttonClass(Boolean(item.active), item.compactHidden, item.compactOnly)}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
        {item.icon}
      </span>
      <ToolbarTooltip
        label={item.shortcut ? item.label + " · " + item.shortcut : item.label}
        placement={tooltipPlacement}
      />
    </button>
  );
}

function ToolbarTooltip({
  label,
  placement,
}: {
  label: string;
  placement: "above" | "below";
}) {
  return (
    <span
      role="tooltip"
      className={
        (placement === "above"
          ? "bottom-[calc(100%+7px)]"
          : "top-[calc(100%+7px)]")
        + " pointer-events-none invisible absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text)] px-2 py-1.5 text-[11px] font-medium text-[var(--surface)] opacity-0 shadow-sm transition-opacity duration-75 group-hover:visible group-hover:opacity-100 group-hover:delay-[350ms] group-focus-visible:visible group-focus-visible:opacity-100 group-focus-visible:delay-0"
      }
    >
      {label}
    </span>
  );
}

function buttonClass(active: boolean, compactHidden = false, compactOnly = false) {
  return "group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-35 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 "
    + (compactHidden ? "max-sm:hidden " : "")
    + (compactOnly ? "sm:hidden " : "")
    + (active ? "bg-[var(--accent-soft)] text-accent shadow-inner" : "text-secondary");
}

function preserveSelection(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}
