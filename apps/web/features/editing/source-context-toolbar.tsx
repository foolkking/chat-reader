"use client";

import {
  AlignLeft,
  Bold,
  Code2,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Superscript,
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
  | "image"
  | "footnote"
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
};

export function SourceContextToolbar({
  open,
  position,
  zh,
  activeCommands,
  onCommand,
  onClose,
  onMeasure,
}: {
  open: boolean;
  position: SourceContextToolbarPosition | null;
  zh: boolean;
  activeCommands: ReadonlySet<SourceEditorCommand>;
  onCommand: (command: SourceEditorCommand) => void;
  onClose: (restoreEditorFocus: boolean) => void;
  onMeasure: (width: number, height: number) => void;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo<CommandItem[][]>(() => [
    [
      item("bold", zh ? "加粗" : "Bold", <Bold />, "Ctrl+B"),
      item("italic", zh ? "斜体" : "Italic", <Italic />, "Ctrl+I"),
      item("underline", zh ? "下划线" : "Underline", <Underline />),
      item("strike", zh ? "删除线" : "Strikethrough", <Strikethrough />),
      item("code", zh ? "行内代码" : "Inline code", <Code2 />),
    ],
    [
      item("link", zh ? "插入链接" : "Insert link", <Link2 />),
      item("code-block", zh ? "代码块" : "Code block", <Code2 />),
    ],
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

  return createPortal(
    <div
      ref={toolbarRef}
      id="source-editor-selection-tools"
      data-testid="source-editor-selection-tools"
      data-placement={position.placement}
      role="toolbar"
      aria-label={zh ? "选中文本格式工具" : "Selected text formatting tools"}
      onKeyDown={(event) => handleToolbarKeyboard(event, toolbarRef, onClose)}
      className="source-context-toolbar fixed z-[200] flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-lg border border-ui bg-raised p-1 text-secondary shadow-[var(--shadow-medium)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{ left: position.left, top: position.top }}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="contents">
          {groupIndex > 0 ? <ToolbarDivider /> : null}
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
    </div>,
    document.body,
  );
}

export function SourceCommandPanel({
  open,
  zh,
  activeCommands,
  onCommand,
  onClose,
}: {
  open: boolean;
  zh: boolean;
  activeCommands: ReadonlySet<SourceEditorCommand>;
  onCommand: (command: SourceEditorCommand) => void;
  onClose: (restoreEditorFocus: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo<CommandItem[][]>(() => [
    [
      item("bold", zh ? "加粗" : "Bold", <Bold />, "Ctrl+B"),
      item("italic", zh ? "斜体" : "Italic", <Italic />, "Ctrl+I"),
      item("underline", zh ? "下划线" : "Underline", <Underline />),
      item("strike", zh ? "删除线" : "Strikethrough", <Strikethrough />),
      item("code", zh ? "行内代码" : "Inline code", <Code2 />),
      item("link", zh ? "插入链接" : "Insert link", <Link2 />),
      item("image", zh ? "插入图片" : "Insert image", <ImageIcon />),
    ],
    [
      item("heading", zh ? "切换标题级别" : "Cycle heading level", <Heading2 />),
      item("quote", zh ? "引用" : "Quote", <Quote />),
      item("code-block", zh ? "代码块" : "Code block", <Code2 />),
      item("rule", zh ? "分隔线" : "Horizontal rule", <Minus />),
      item("table", zh ? "插入表格" : "Insert table", <Table2 />),
    ],
    [
      item("bullets", zh ? "无序列表" : "Bulleted list", <List />),
      item("numbered", zh ? "有序列表" : "Numbered list", <ListOrdered />),
      item("tasks", zh ? "任务清单" : "Task list", <ListTodo />),
    ],
    [
      item("attachment", zh ? "插入附件引用" : "Insert attachment reference", <Paperclip />),
      item("footnote", zh ? "插入脚注" : "Insert footnote", <Superscript />),
      item("format", zh ? "格式化当前段落" : "Format paragraph", <AlignLeft />),
    ],
    [
      item("undo", zh ? "撤销" : "Undo", <Undo2 />, "Ctrl+Z"),
      item("redo", zh ? "重做" : "Redo", <Redo2 />, "Ctrl+Y"),
    ],
  ], [zh]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id="source-editor-command-panel"
      data-testid="source-editor-command-panel"
      role="toolbar"
      aria-label={zh ? "Markdown 编辑命令" : "Markdown editing commands"}
      onKeyDown={(event) => handleToolbarKeyboard(event, panelRef, onClose)}
      className="absolute inset-x-2 top-2 z-[45] flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-ui bg-raised p-1.5 text-secondary shadow-[var(--shadow-medium)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-0.5 motion-safe:duration-100"
    >
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          role="group"
          aria-label={groupLabel(groupIndex, zh)}
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-subtle p-0.5"
        >
          {group.map((command, index) => (
            <ToolbarIconButton
              key={command.command}
              item={{ ...command, active: activeCommands.has(command.command) }}
              tabIndex={groupIndex === 0 && index === 0 ? 0 : -1}
              onCommand={onCommand}
              tooltipPlacement="below"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function groupLabel(index: number, zh: boolean) {
  const labels = zh
    ? ["文字格式", "结构", "列表", "插入与整理", "编辑历史"]
    : ["Text formatting", "Structure", "Lists", "Insert and organize", "Edit history"];
  return labels[index] ?? labels[0];
}

function item(command: SourceEditorCommand, label: string, icon: ReactNode, shortcut?: string): CommandItem {
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
  const label = item.shortcut ? item.label + " · " + item.shortcut : item.label;
  return (
    <button
      type="button"
      data-source-toolbar-command={item.command}
      aria-label={label}
      aria-pressed={item.active || undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      tabIndex={tabIndex}
      onPointerDown={preserveSelection}
      onClick={() => onCommand(item.command)}
      className={buttonClass(Boolean(item.active))}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{item.icon}</span>
      <ToolbarTooltip label={label} placement={tooltipPlacement} />
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-[18px] w-px shrink-0 bg-[var(--border)]" aria-hidden="true" />;
}

function ToolbarTooltip({ label, placement }: { label: string; placement: "above" | "below" }) {
  return (
    <span
      role="tooltip"
      className={(placement === "above" ? "bottom-[calc(100%+7px)]" : "top-[calc(100%+7px)]")
        + " pointer-events-none invisible absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text)] px-2 py-1.5 text-[11px] font-medium text-[var(--surface)] opacity-0 shadow-sm transition-opacity duration-75 group-hover:visible group-hover:opacity-100 group-hover:delay-[350ms] group-focus-visible:visible group-focus-visible:opacity-100 group-focus-visible:delay-0"}
    >
      {label}
    </span>
  );
}

function handleToolbarKeyboard(
  event: KeyboardEvent<HTMLDivElement>,
  rootRef: { current: HTMLDivElement | null },
  onClose: (restoreEditorFocus: boolean) => void,
) {
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
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(
    rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-source-toolbar-command]:not(:disabled)") ?? [],
  ).filter((button) => button.offsetParent !== null);
  if (!buttons.length) return;
  event.preventDefault();
  const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : forward
        ? (currentIndex + 1) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function buttonClass(active: boolean) {
  return "group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-raised hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-35 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 "
    + (active ? "bg-[var(--accent-soft)] text-accent shadow-inner" : "text-secondary");
}

function preserveSelection(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}
