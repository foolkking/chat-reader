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
    const copy = anchorRef.current?.querySelector<HTMLElement>("[data-hover-preview-copy]");
    return Boolean(copy && (
      copy.scrollHeight > copy.clientHeight + 1 ||
      copy.scrollWidth > copy.clientWidth + 1 ||
      description.trim().length > 180
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("reader:dnd-start", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("reader:dnd-start", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearPreview]);

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
        onPointerLeave={clearPreview}
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
