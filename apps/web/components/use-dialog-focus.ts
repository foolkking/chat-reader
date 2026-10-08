"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type DialogFocusOptions = {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: () => HTMLElement | null;
};

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]):not([data-dialog-backdrop]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.matches(":disabled") && element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]") && element.getClientRects().length > 0);
}

function initialFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? focusable(root)[0] ?? null;
}

function focusFallback() {
  const fallback = document.querySelector<HTMLElement>("[data-reader-focus-fallback], main button, main a");
  fallback?.focus();
}

function modalLayers(element: HTMLElement): HTMLElement[] {
  const layers = [element];
  let parent = element.parentElement?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  while (parent) {
    layers.unshift(parent);
    parent = parent.parentElement?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  }
  return layers;
}

function compareModalLayers(a: HTMLElement, b: HTMLElement): number {
  const left = modalLayers(a), right = modalLayers(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    const order = (Number.parseInt(getComputedStyle(left[index]).zIndex) || 0)
      - (Number.parseInt(getComputedStyle(right[index]).zIndex) || 0);
    if (order) return order;
    return left[index].compareDocumentPosition(right[index]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }
  return left.length - right.length;
}

/** Shared modal lifecycle: initial focus, trap, Escape and logical restoration. */
export function useDialogFocus({ open, rootRef, onClose, initialFocusRef, restoreFocus }: DialogFocusOptions) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    const preferred = initialFocusRef?.current;
    const first = root ? initialFocusable(root) : null;
    (preferred?.isConnected ? preferred : first ?? root)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = rootRef.current?.closest('[role="dialog"][aria-modal="true"]');
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .filter((item) => item.getClientRects().length > 0)
        .sort(compareModalLayers);
      // Nested confirmations own Escape/Tab until they close. The underlying
      // settings dialog must not also close or steal their focus. Portals can
      // appear later in the DOM while a confirmation has a higher modal layer.
      // A nested review's local z-index is relative to its parent's layer;
      // comparing that number directly with the parent's closes both dialogs.
      if (dialog && dialogs.length && dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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
      document.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => {
        const logicalTarget = restoreFocusRef.current?.();
        const target = logicalTarget?.isConnected ? logicalTarget : previous?.isConnected ? previous : null;
        const topDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
          .filter((item) => item.getClientRects().length > 0)
          .sort(compareModalLayers).at(-1);
        // A newly opened modal owns focus. A closing sibling's delayed restore
        // must not send it back to the page underneath. Nested confirmations may
        // still restore their opener inside the remaining top modal.
        if (topDialog && (!target || !topDialog.contains(target))) {
          if (!topDialog.contains(document.activeElement)) initialFocusable(topDialog)?.focus({ preventScroll: true });
          return;
        }
        if (target) target.focus({ preventScroll: true });
        else focusFallback();
      }, 0);
    };
  }, [initialFocusRef, open, rootRef]);
}
