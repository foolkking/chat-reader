"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PreviewPosition = { left: number; top: number };

export function HoverPreviewLink({ href, title, description, children, className = "", onClick }: {
  href: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [position, setPosition] = useState<PreviewPosition | null>(null);

  const clearPreview = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPosition(null);
  }, []);

  function isCopyTruncated() {
    if (description.trim().length > 180) return true;
    const copy = anchorRef.current?.querySelector<HTMLElement>("[data-hover-preview-copy]");
    return Boolean(copy && (
      copy.scrollHeight > copy.clientHeight + 1 ||
      copy.scrollWidth > copy.clientWidth + 1
    ));
  }

  function placePreview(clientX: number, clientY: number) {
    const width = Math.min(360, window.innerWidth - 24);
    const estimatedHeight = 172;
    setPosition({
      left: clientX + 12 + width > window.innerWidth ? Math.max(12, clientX - width - 12) : clientX + 12,
      top: clientY + 12 + estimatedHeight > window.innerHeight ? Math.max(12, clientY - estimatedHeight - 12) : clientY + 12,
    });
  }

  const schedulePreview = useCallback((clientX: number, clientY: number) => {
    if (!description || !isCopyTruncated() || timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      placePreview(clientX, clientY);
    }, 700);
  }, [description]);

  useEffect(() => {
    const dismiss = () => clearPreview();
    const onScroll = (event: Event) => {
      // Playwright and browsers can scroll a low row into view as part of the
      // same trusted hover gesture. Preserve only that pending delay; direct
      // wheel/touch/pointer input and synthetic scrolls still dismiss below.
      if (event.isTrusted && timerRef.current !== null && position === null) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("reader:dnd-start", dismiss);
    window.addEventListener("wheel", dismiss, { capture: true, passive: true });
    window.addEventListener("touchstart", dismiss, { capture: true, passive: true });
    window.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("reader:dnd-start", dismiss);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("touchstart", dismiss, true);
      window.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearPreview, position]);

  // Keep the delayed affordance reliable across browsers that do not replay
  // React's delegated pointer events during an automated or restored hover.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const onMouseOver = (event: MouseEvent) => schedulePreview(event.clientX, event.clientY);
    const onWindowMouseMove = (event: MouseEvent) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (hit && (hit === anchor || anchor.contains(hit))) {
        schedulePreview(event.clientX, event.clientY);
      }
    };
    anchor.addEventListener("mouseover", onMouseOver);
    window.addEventListener("mousemove", onWindowMouseMove);
    return () => {
      anchor.removeEventListener("mouseover", onMouseOver);
      window.removeEventListener("mousemove", onWindowMouseMove);
    };
  }, [schedulePreview]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <>
      <Link
        ref={anchorRef}
        href={href}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onClick={onClick}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          schedulePreview(event.clientX, event.clientY);
        }}
        onMouseEnter={(event) => schedulePreview(event.clientX, event.clientY)}
        onMouseOver={(event) => schedulePreview(event.clientX, event.clientY)}
        onMouseMove={(event) => schedulePreview(event.clientX, event.clientY)}
        onPointerLeave={(event) => {
          // Browsers can report a null relatedTarget while an auto-scroll
          // brings a hovered row into view. Keep that pending hover alive;
          // explicit scroll/escape handlers still dismiss it.
          if (timerRef.current !== null && event.relatedTarget === null) return;
          clearPreview();
        }}
        onFocus={() => {
          if (!description || !isCopyTruncated()) return;
          const rect = anchorRef.current?.getBoundingClientRect();
          if (rect) placePreview(rect.left + Math.min(rect.width, 160), rect.bottom);
        }}
        onBlur={clearPreview}
        className={className}
      >
        {children}
      </Link>
      {position && typeof document !== "undefined" ? createPortal(
        <div role="tooltip" aria-hidden="true" className="pointer-events-none fixed z-[260] w-[min(22.5rem,calc(100vw-1.5rem))] rounded-lg border border-ui bg-raised px-4 py-3 text-left shadow-[var(--shadow-medium)]" style={position}>
          <p className="truncate text-sm font-semibold text-primary">{title}</p>
          <p className="mt-1 line-clamp-6 text-sm leading-5 text-secondary">{description}</p>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
