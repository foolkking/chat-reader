"use client";

import { ExternalLink, ListFilter, MessageSquare, MoreHorizontal, Unlink } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { OwnedShareRead } from "../../lib/types";

/** Kept inside the settings focus boundary; fixed positioning avoids scroll clipping. */
export function ShareActionsMenu({ share, zh, busy, online, onSource, onFilter, onRevoke }: {
  share: OwnedShareRead; zh: boolean; busy: boolean; online: boolean;
  onSource: () => void; onFilter: () => void; onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  const itemClass = "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-primary hover:bg-subtle";
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); }
  useLayoutEffect(() => {
    if (!open) return;
    function positionMenu() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = menu.current?.offsetHeight ?? 200;
      setPosition({ left: Math.max(12, Math.min(rect.right - 256, window.innerWidth - 268)), top: Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - height - 12)) });
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    positionMenu();
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    focusLast.current = false;
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="btn-ghost inline-flex min-h-11 items-center gap-1 px-3 text-xs" disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusLast.current = event.key === "ArrowUp"; setOpen(true); } }}>
      <MoreHorizontal aria-hidden="true" className="h-4 w-4" />{zh ? "更多" : "More"}
    </button>
    {open ? <div ref={menu} id={menuId} role="menu" aria-label={zh ? "分享操作" : "Share actions"} style={position} className="fixed z-10 w-64 max-w-[calc(100vw-24px)] rounded-lg border border-ui bg-raised p-1 shadow-xl" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === "Tab") { close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      {share.share_url ? <a role="menuitem" tabIndex={-1} className={itemClass} href={share.share_url} target="_blank" rel="noreferrer" onClick={() => close()}><ExternalLink aria-hidden="true" className="h-4 w-4" />{zh ? "打开分享" : "Open share"}</a> : null}
      <button type="button" role="menuitem" tabIndex={-1} className={itemClass} disabled={!online || share.conversation_deleted} onClick={() => { close(); onSource(); }}><MessageSquare aria-hidden="true" className="h-4 w-4" />{zh ? "打开来源对话" : "Open source conversation"}</button>
      <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => { close(); onFilter(); }}><ListFilter aria-hidden="true" className="h-4 w-4" />{zh ? "仅此对话" : "Only this conversation"}</button>
      <div className="mt-1 border-t border-ui pt-1"><button type="button" role="menuitem" tabIndex={-1} className="btn-danger flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm" disabled={!online || share.status === "revoked"} onClick={() => { close(); onRevoke(); }}><Unlink aria-hidden="true" className="h-4 w-4" />{zh ? "撤销" : "Revoke"}</button></div>
    </div> : null}
  </>;
}
