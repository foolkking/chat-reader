"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function ShortcutManager() {
  const pathname = usePathname();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "o" && !event.ctrlKey && !event.metaKey
        && (pathname?.startsWith("/conversations/") || pathname === "/read-together") && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault(); window.dispatchEvent(new Event("chat-reader:open-together")); return;
      }
      const isFind = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      const isGlobalSearch = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const isActionPalette = event.altKey && event.shiftKey && event.key.toLowerCase() === "p" && !event.ctrlKey && !event.metaKey;
      if (!isFind && !isSlash && !isGlobalSearch && !isActionPalette) return;
      event.preventDefault();
      window.dispatchEvent(
        new Event(
          isActionPalette
            ? "chat-reader:open-action-palette"
            : isGlobalSearch
            ? "chat-reader:focus-global-search"
            : pathname?.startsWith("/conversations/") || pathname === "/read-together"
              ? "chat-reader:open-reader-search"
              : "chat-reader:focus-global-search",
        ),
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pathname]);
  return null;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
