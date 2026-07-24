"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

type Limit = number | (() => number);

export type ResizeStartOptions = {
  direction?: 1 | -1;
  axis?: "x" | "y";
};

export type ResizablePaneOptions = {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: Limit;
};

export function useResizablePane({ storageKey, defaultSize, minSize, maxSize }: ResizablePaneOptions) {
  const [size, setSizeState] = useState(defaultSize);
  const sizeRef = useRef(defaultSize);
  const maxSizeRef = useRef(maxSize);
  maxSizeRef.current = maxSize;
  const dragRef = useRef<{ startClient: number; startSize: number; direction: 1 | -1; axis: "x" | "y" } | null>(null);

  const clampSize = useCallback((value: number) => clampNumber(value, minSize, resolveLimit(maxSizeRef.current)), [minSize]);

  const setSize = useCallback((value: number, persist = true) => {
    const next = clampSize(value);
    sizeRef.current = next;
    setSizeState(next);
    if (persist) writeStoredNumber(storageKey, next);
  }, [clampSize, storageKey]);

  const resetSize = useCallback(() => {
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
    setSize(defaultSize, false);
  }, [defaultSize, setSize, storageKey]);

  const startResize = useCallback((event: ReactPointerEvent, options: ResizeStartOptions = {}) => {
    event.preventDefault();
    event.stopPropagation();
    const axis = options.axis ?? "x";
    dragRef.current = {
      startClient: axis === "x" ? event.clientX : event.clientY,
      startSize: sizeRef.current,
      direction: options.direction ?? 1,
      axis,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const stored = readStoredNumber(storageKey);
    if (stored !== null) setSize(stored);
  }, [setSize, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const client = drag.axis === "x" ? event.clientX : event.clientY;
      setSize(drag.startSize + (client - drag.startClient) * drag.direction);
    };
    const stop = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [setSize]);

  useEffect(() => {
    const onResize = () => setSize(sizeRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setSize]);

  return { size, setSize, resetSize, startResize };
}

export function ResizeHandle({
  side,
  label,
  onPointerDown,
  onDoubleClick,
  className = "",
}: {
  side: "left" | "right" | "bottom";
  label: string;
  onPointerDown: (event: ReactPointerEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
}) {
  const vertical = side !== "bottom";
  return (
    <button
      type="button"
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`${vertical ? "cursor-col-resize" : "cursor-row-resize"} group absolute z-20 touch-none focus:outline-none ${handlePosition(side)} ${className}`}
    >
      <span className={`${vertical ? "h-full w-px group-hover:w-1 group-focus:w-1" : "h-px w-full group-hover:h-1 group-focus:h-1"} block rounded-full bg-transparent transition-all group-hover:bg-[var(--accent)] group-focus:bg-[var(--accent)]`} />
    </button>
  );
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function ResizableDockPanel({
  storageKey,
  defaultSize,
  minSize,
  maxSize,
  side = "left",
  className = "",
  children,
  onResizeStart,
}: {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: Limit;
  side?: "left" | "right";
  className?: string;
  children: ReactNode;
  onResizeStart?: (size: number) => void;
}) {
  const pane = useResizablePane({ storageKey, defaultSize, minSize, maxSize });
  return (
    <div className={`relative h-full shrink-0 overflow-visible ${className}`} style={{ width: pane.size }}>
      {children}
      <ResizeHandle
        side={side}
        label={side === "left" ? "Resize panel width" : "Resize sidebar width"}
        onPointerDown={(event) => {
          onResizeStart?.(pane.size);
          pane.startResize(event, { direction: side === "left" ? -1 : 1 });
        }}
        onDoubleClick={pane.resetSize}
      />
    </div>
  );
}

function handlePosition(side: "left" | "right" | "bottom") {
  if (side === "left") return "bottom-0 left-0 top-0 w-3";
  if (side === "right") return "bottom-0 right-0 top-0 w-3";
  return "bottom-0 left-0 right-0 h-3";
}

function resolveLimit(limit: Limit): number {
  return typeof limit === "function" ? limit() : limit;
}

function readStoredNumber(storageKey: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function writeStoredNumber(storageKey: string, value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, String(Math.round(value)));
}
