"use client";

import { LoaderCircle, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export type ReaderHeaderAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  closeOnSelect?: boolean;
  group?: string;
};

export function ReaderHeaderActionRail({
  expanded,
  onExpandedChange,
  actions,
  triggerLabel,
  closeLabel,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  actions: ReaderHeaderAction[];
  triggerLabel: string;
  closeLabel: string;
  compact?: boolean;
  fixedTrigger?: boolean;
}) {
  const menuId = useId();
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
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      onExpandedChange(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
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
      if (!actions[nextIndex]?.disabled && actionRefs.current[nextIndex]?.getClientRects().length) {
        actionRefs.current[nextIndex]?.focus({ preventScroll: true });
        return;
      }
    }
  }

  return <div ref={rootRef} className="relative flex shrink-0 items-center" onBlur={event => {
    if (expanded && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onExpandedChange(false);
  }}>
    <button ref={triggerRef} data-reader-more-actions="true" data-reader-header-more-actions="true" type="button"
      aria-label={expanded ? closeLabel : triggerLabel} title={triggerLabel} aria-expanded={expanded} aria-haspopup="menu" aria-controls={expanded ? menuId : undefined}
      onClick={() => onExpandedChange(!expanded)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); onExpandedChange(true); requestAnimationFrame(() => actionRefs.current.find(node => node && !node.disabled && node.getClientRects().length)?.focus({ preventScroll: true })); }
      }} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
      {expanded ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
    </button>
    {expanded ? <div id={menuId} data-reader-header-menu role="menu" aria-label={triggerLabel}
      className="absolute right-0 top-12 z-[80] max-h-[min(70dvh,36rem)] w-64 max-w-[calc(100vw-32px)] overflow-y-auto rounded-lg border border-ui bg-raised p-1 shadow-md">
      {actions.map((action, index) => {
        const Icon = action.busy ? LoaderCircle : action.icon;
        const startsGroup = action.group && action.group !== actions[index - 1]?.group;
        return <div key={action.id} role="none">
          {startsGroup ? <div role="presentation" className={`px-3 pb-1 pt-3 text-xs text-secondary ${index ? "mt-1 border-t border-ui" : ""}`}>{action.group}</div> : null}
          <button ref={node => { actionRefs.current[index] = node; }} type="button" role="menuitem"
            data-reader-header-action={action.id} disabled={action.disabled} onKeyDown={event => {
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                if (event.key === "Home") moveFocus(-1, 1);
                else if (event.key === "End") moveFocus(0, -1);
                else moveFocus(index, event.key === "ArrowUp" ? -1 : 1);
              }
            }} onClick={() => {
              // The menu item will unmount. Dialogs capture the persistent
              // logical opener, rather than returning to a retired item.
              if (action.closeOnSelect !== false) { triggerRef.current?.focus({ preventScroll: true }); onExpandedChange(false); }
              action.onSelect();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-secondary hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50">
            <Icon className={`h-[18px] w-[18px] shrink-0 ${action.busy ? "animate-spin" : ""}`} /><span>{action.label}</span>
          </button>
        </div>;
      })}
    </div> : null}
  </div>;
}
