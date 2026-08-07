"use client";

import { GripHorizontal, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type Geometry = { x: number; y: number; width: number; height: number };
type DragMode = "move" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;

export function FloatingWorkspacePanel({
  storageKey,
  title,
  subtitle,
  closeLabel,
  resetLabel,
  onClose,
  banner,
  placement = "floating",
  testId = "floating-source-workspace",
  children,
}: {
  storageKey: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  resetLabel: string;
  onClose: () => void;
  banner?: ReactNode;
  placement?: "floating" | "left-overlay";
  testId?: string;
  children: ReactNode;
}) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; x: number; y: number; geometry: Geometry } | null>(null);
  const desktop = () => window.innerWidth >= (placement === "left-overlay" ? 1024 : 768);

  useEffect(() => {
    const fallback = defaultGeometry(placement);
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<Geometry> | null;
      const next = clampGeometry({
        x: Number(saved?.x ?? fallback.x),
        y: Number(saved?.y ?? fallback.y),
        width: Number(saved?.width ?? fallback.width),
        height: Number(saved?.height ?? fallback.height),
      }, placement);
      geometryRef.current = next;
      setGeometry(next);
      if (placement === "left-overlay") {
        window.dispatchEvent(new CustomEvent("chat-reader:source-editor-width-committed", { detail: next.width }));
      }
    } catch {
      geometryRef.current = fallback;
      setGeometry(fallback);
    }
  }, [placement, storageKey]);

  useEffect(() => {
    const onResize = () => {
      const next = geometryRef.current ? clampGeometry(geometryRef.current, placement) : defaultGeometry(placement);
      geometryRef.current = next;
      setGeometry(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [placement]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const next = clampGeometry(resizeGeometry(drag.geometry, drag.mode, dx, dy), placement);
      geometryRef.current = next;
      const node = panelRef.current;
      if (node) {
        node.style.width = `${next.width}px`;
        node.style.height = `${next.height}px`;
        if (placement !== "left-overlay") {
          node.style.left = `${next.x}px`;
          node.style.top = `${next.y}px`;
        }
      }
      if (placement === "left-overlay") {
        window.dispatchEvent(new CustomEvent("chat-reader:source-editor-width-change", { detail: next.width }));
      }
    };
    const onUp = () => {
      const next = geometryRef.current;
      dragRef.current = null;
      if (!next) return;
      setGeometry(next);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("chat-reader:source-editor-width-committed", { detail: next.width }));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [placement, storageKey]);

  function beginDrag(mode: DragMode, event: ReactPointerEvent) {
    if (!geometry || !desktop()) return;
    if (placement === "left-overlay" && mode !== "right") return;
    event.preventDefault();
    dragRef.current = { mode, x: event.clientX, y: event.clientY, geometry };
    if (placement === "left-overlay") {
      window.dispatchEvent(new Event("chat-reader:source-editor-resize-start"));
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function reset() {
    const next = defaultGeometry(placement);
    geometryRef.current = next;
    setGeometry(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    if (placement === "left-overlay") {
      window.dispatchEvent(new CustomEvent("chat-reader:source-editor-width-committed", { detail: next.width }));
    }
  }

  return (
    <section
      data-testid={testId}
      aria-label={title}
      ref={panelRef}
      className={`fixed inset-x-0 bottom-0 top-14 z-[115] flex min-h-0 flex-col overflow-hidden border-t border-ui bg-surface shadow-2xl ${placement === "left-overlay" ? "lg:inset-auto lg:left-0 lg:top-0 lg:h-[100dvh] lg:w-[clamp(560px,32vw,720px)] lg:rounded-none lg:border-b-0 lg:border-l-0 lg:border-r lg:border-t" : "md:inset-auto md:rounded-lg md:border"}`}
      style={geometry && typeof window !== "undefined" && desktop() ? placement === "left-overlay" ? { left: 0, top: 0, width: geometry.width, height: "100dvh" } : geometry : undefined}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-ui bg-raised px-2">
        {placement !== "left-overlay" ? <button type="button" onPointerDown={(event) => beginDrag("move", event)} className="hidden h-10 w-10 cursor-move items-center justify-center rounded-lg text-secondary hover:bg-subtle md:inline-flex" aria-label={title} title={title}><GripHorizontal className="h-4 w-4" /></button> : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-primary">{title}</h2>
          {subtitle ? <p className="truncate text-[11px] text-secondary">{subtitle}</p> : null}
        </div>
        <button type="button" onClick={reset} className="hidden h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle md:inline-flex" aria-label={resetLabel} title={resetLabel}><Maximize2 className="h-4 w-4" /></button>
        <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={closeLabel} title={closeLabel}><X className="h-4 w-4" /></button>
      </header>
      {banner}
      <div className="min-h-0 flex-1">{children}</div>
      {(placement === "left-overlay" ? ["right"] : ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as DragMode[]).map((mode) => (
        <div key={mode} aria-hidden="true" onPointerDown={(event) => beginDrag(mode as DragMode, event)} className={`absolute hidden ${placement === "left-overlay" ? "lg:block" : "md:block"} ${resizeHandleClass(mode as DragMode)}`} />
      ))}
    </section>
  );
}

function defaultGeometry(placement: "floating" | "left-overlay" = "floating"): Geometry {
  const minWidth = placement === "left-overlay" ? 560 : MIN_WIDTH;
  const width = Math.min(placement === "left-overlay" ? 720 : 680, Math.max(minWidth, window.innerWidth * (placement === "left-overlay" ? 0.32 : 0.42)));
  const height = Math.min(760, Math.max(MIN_HEIGHT, window.innerHeight - 96));
  return placement === "left-overlay"
    ? { x: 0, y: 0, width, height: window.innerHeight }
    : { x: Math.max(VIEWPORT_MARGIN, (window.innerWidth - width) / 2), y: Math.max(VIEWPORT_MARGIN, (window.innerHeight - height) / 2), width, height };
}

function clampGeometry(value: Geometry, placement: "floating" | "left-overlay" = "floating"): Geometry {
  const minWidth = placement === "left-overlay" ? 560 : MIN_WIDTH;
  const maxWidth = Math.max(minWidth, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(maxWidth, Math.max(minWidth, value.width));
  const height = Math.min(maxHeight, Math.max(MIN_HEIGHT, value.height));
  if (placement === "left-overlay") return { width, height: window.innerHeight, x: 0, y: 0 };
  return {
    width,
    height,
    x: Math.min(window.innerWidth - width - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, value.x)),
    y: Math.min(window.innerHeight - height - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, value.y)),
  };
}

function resizeGeometry(value: Geometry, mode: DragMode, dx: number, dy: number): Geometry {
  if (mode === "move") return { ...value, x: value.x + dx, y: value.y + dy };
  const next = { ...value };
  if (mode.includes("left")) { next.x += dx; next.width -= dx; }
  if (mode.includes("right")) next.width += dx;
  if (mode.includes("top")) { next.y += dy; next.height -= dy; }
  if (mode.includes("bottom")) next.height += dy;
  return next;
}

function resizeHandleClass(mode: DragMode): string {
  const classes: Record<Exclude<DragMode, "move">, string> = {
    left: "inset-y-2 -left-1 w-2 cursor-ew-resize",
    right: "inset-y-2 -right-1 w-2 cursor-ew-resize",
    top: "inset-x-2 -top-1 h-2 cursor-ns-resize",
    bottom: "inset-x-2 -bottom-1 h-2 cursor-ns-resize",
    "top-left": "-left-1 -top-1 h-3 w-3 cursor-nwse-resize",
    "top-right": "-right-1 -top-1 h-3 w-3 cursor-nesw-resize",
    "bottom-left": "-bottom-1 -left-1 h-3 w-3 cursor-nesw-resize",
    "bottom-right": "-bottom-1 -right-1 h-3 w-3 cursor-nwse-resize",
  };
  return mode === "move" ? "" : classes[mode];
}
