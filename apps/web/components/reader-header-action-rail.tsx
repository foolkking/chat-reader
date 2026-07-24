"use client";

import { LoaderCircle, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export type ReaderHeaderAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  closeOnSelect?: boolean;
};

export function ReaderHeaderActionRail({
  expanded,
  onExpandedChange,
  actions,
  triggerLabel,
  closeLabel,
  compact = false,
  fixedTrigger = false,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  actions: ReaderHeaderAction[];
  triggerLabel: string;
  closeLabel: string;
  compact?: boolean;
  fixedTrigger?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !event.composedPath().includes(root)) onExpandedChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onExpandedChange(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, onExpandedChange]);

  function moveFocus(currentIndex: number, delta: number) {
    if (actions.length === 0) return;
    let nextIndex = currentIndex;
    for (let attempt = 0; attempt < actions.length; attempt += 1) {
      nextIndex = (nextIndex + delta + actions.length) % actions.length;
      if (!actions[nextIndex]?.disabled) {
        actionRefs.current[nextIndex]?.focus();
        return;
      }
    }
  }

  const actionContainerClass = fixedTrigger
    ? `reader-aux-scroll absolute right-[calc(100%+0.25rem)] top-1/2 flex min-w-0 items-center justify-end gap-1 overflow-x-auto overflow-y-hidden transition-[max-width,opacity,transform] duration-200 ease-out ${
      expanded ? "visible max-w-[calc(100vw-5.5rem)] -translate-y-1/2 translate-x-0 opacity-100" : "invisible pointer-events-none max-w-0 -translate-y-1/2 translate-x-2 opacity-0"
    }`
    : `flex min-w-0 items-center justify-end gap-1 overflow-hidden transition-[max-width,opacity,transform] duration-200 ease-out ${
      expanded ? "visible max-w-[22rem] translate-x-0 opacity-100" : "invisible pointer-events-none max-w-0 translate-x-3 opacity-0"
    }`;

  return (
    <div ref={rootRef} className={`${fixedTrigger ? (compact ? "h-9 w-9" : "h-10 w-10") : "min-w-0"} relative flex shrink-0 items-center justify-end gap-1.5`}>
      <div
        className={actionContainerClass}
        aria-hidden={!expanded}
      >
        {actions.map((action, index) => {
          const Icon = action.busy ? LoaderCircle : action.icon;
          return (
            <button
              key={action.id}
              ref={(node) => { actionRefs.current[index] = node; }}
              type="button"
              title={action.label}
              aria-label={action.label}
              disabled={action.disabled}
              tabIndex={expanded ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveFocus(index, -1);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveFocus(index, 1);
                }
              }}
              onClick={() => {
                action.onSelect();
                if (action.closeOnSelect !== false) onExpandedChange(false);
              }}
              className={`${compact ? "h-8 w-8" : "h-9 w-9"} inline-flex shrink-0 items-center justify-center rounded-lg border border-ui bg-surface text-secondary shadow-sm transition hover:-translate-y-0.5 hover:bg-subtle hover:text-primary focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:cursor-wait disabled:opacity-50`}
            >
              <Icon className={`${compact ? "h-4 w-4" : "h-[1.125rem] w-[1.125rem]"} ${action.busy ? "animate-spin" : ""}`} />
            </button>
          );
        })}
      </div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={expanded ? closeLabel : triggerLabel}
        title={expanded ? closeLabel : triggerLabel}
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
        className={`${compact ? "h-9 w-9" : "h-10 w-10"} inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--surface)] transition hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--focus)]`}
      >
        {expanded ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
      </button>
    </div>
  );
}
