"use client";

import { useEffect, useRef, type RefObject } from "react";

type DialogFocusOptions = {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]):not([data-dialog-backdrop]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function initialFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? focusable(root)[0] ?? null;
}

function focusFallback() {
  const fallback = document.querySelector<HTMLElement>("[data-reader-focus-fallback], main button, main a");
  fallback?.focus();
}

/** Shared modal lifecycle: initial focus, trap, Escape and logical restoration. */
export function useDialogFocus({ open, rootRef, onClose, initialFocusRef }: DialogFocusOptions) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      const preferred = initialFocusRef?.current;
      if (preferred?.isConnected) {
        preferred.focus();
        return;
      }
      const first = root ? initialFocusable(root) : null;
      (first ?? root)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const items = focusable(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
        else focusFallback();
      });
    };
  }, [initialFocusRef, open, rootRef]);
}
