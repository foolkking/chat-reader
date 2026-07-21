"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function ShortcutManager() {
  const pathname = usePathname();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const isFind = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!isFind && !isSlash) return;
      event.preventDefault();
      window.dispatchEvent(new Event(pathname.startsWith("/conversations/") ? "chat-reader:open-reader-search" : "chat-reader:focus-global-search"));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pathname]);
  return null;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
