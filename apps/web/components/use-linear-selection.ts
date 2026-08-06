"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export function useLinearSelection({
  ids,
  selectedIds,
  onChange,
  disabled = false,
  selectionMode,
  onActivate,
  onExit,
}: {
  ids: string[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  disabled?: boolean;
  selectionMode?: boolean;
  onActivate?: () => void;
  onExit?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const anchorIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTargetRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const selectionActive = selectionMode ?? selectedIds.size > 0;

  const apply = useCallback((next: Set<string>) => {
    onChange(new Set(ids.filter((id) => next.has(id))));
  }, [ids, onChange]);

  const toggle = useCallback((id: string, options: { selected?: boolean; range?: boolean } = {}) => {
    if (disabled || !idSet.has(id)) return;
    const next = new Set(selectedIds);
    const shouldSelect = options.selected ?? !next.has(id);
    if (shouldSelect && !selectionActive) onActivate?.();
    if (options.range && anchorIdRef.current && idSet.has(anchorIdRef.current)) {
      const start = ids.indexOf(anchorIdRef.current);
      const end = ids.indexOf(id);
      const [from, to] = start <= end ? [start, end] : [end, start];
      ids.slice(from, to + 1).forEach((rangeId) => shouldSelect ? next.add(rangeId) : next.delete(rangeId));
    } else {
      if (shouldSelect) next.add(id); else next.delete(id);
      anchorIdRef.current = id;
    }
    setActiveId(id);
    apply(next);
  }, [apply, disabled, idSet, ids, onActivate, selectedIds, selectionActive]);

  const clear = useCallback(() => {
    anchorIdRef.current = null;
    onChange(new Set());
  }, [onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("textarea, select, [contenteditable='true'], input:not([type='checkbox'])")) return;
      if (event.key === "Escape" && selectionActive) {
        event.preventDefault();
        if (onExit) onExit(); else clear();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && selectionActive) {
        event.preventDefault();
        apply(new Set(ids));
      } else if (event.key.toLowerCase() === "x" && activeId && selectionActive) {
        event.preventDefault();
        toggle(activeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, apply, clear, disabled, ids, onExit, selectionActive, toggle]);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, []);

  function itemHandlers(id: string) {
    return {
      onMouseEnter: () => setActiveId(id),
      onFocusCapture: () => setActiveId(id),
      onPointerDown: (event: ReactPointerEvent) => {
        if (disabled || event.pointerType === "mouse") return;
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTargetRef.current = id;
          onActivate?.();
          toggle(id, { selected: true });
        }, 450);
      },
      onPointerMove: (event: ReactPointerEvent) => {
        const start = pointerStartRef.current;
        if (!start || !longPressTimerRef.current) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return;
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        pointerStartRef.current = null;
      },
      onPointerUp: () => {
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        pointerStartRef.current = null;
      },
      onPointerCancel: () => {
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        pointerStartRef.current = null;
      },
      onClickCapture: (event: ReactMouseEvent) => {
        if (longPressTargetRef.current !== id) return;
        longPressTargetRef.current = null;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }

  return {
    activeId,
    selectionActive,
    clear,
    selectAll: () => apply(new Set(ids)),
    invert: () => apply(new Set(ids.filter((id) => !selectedIds.has(id)))),
    toggle,
    itemHandlers,
    checkboxClass: (_id: string) => selectionActive ? "flex" : "hidden",
  };
}
