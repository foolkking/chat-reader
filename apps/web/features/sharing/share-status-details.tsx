"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { OwnedShareRead } from "../../lib/types";

/** Status disclosure stays inside the dialog focus boundary and clear of scroll clipping. */
export function ShareStatusDetails({ share, locale }: { share: OwnedShareRead; locale: "zh-CN" | "en-US" }) {
  const zh = locale === "zh-CN", id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null), detail = useRef<HTMLDivElement>(null);
  const status = share.status === "active" ? (zh ? "有效" : "Active") : share.status === "expired" ? (zh ? "已过期" : "Expired") : (zh ? "已撤销" : "Revoked");
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = detail.current?.offsetHeight ?? 120;
      const top = rect.top - height >= 12 ? rect.top - height : rect.bottom;
      setPosition({ left: Math.max(12, Math.min(rect.right - 256, window.innerWidth - 268)), top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
    }
    function outside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !detail.current?.contains(event.target as Node)) setOpen(false);
    }
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", dismiss, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", dismiss, true); };
  }, [open]);
  return <div className="shrink-0" onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }} onPointerLeave={(event) => { if (event.pointerType === "mouse" && document.activeElement !== trigger.current) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button ref={trigger} type="button" className="min-h-9 rounded-md bg-subtle px-2 text-xs text-secondary underline decoration-dotted underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--focus)]" aria-expanded={open} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}>{status}</button>
    {open ? <div ref={detail} id={id} role="tooltip" style={position} className="fixed z-10 w-64 max-w-[calc(100vw-24px)] space-y-2 rounded-lg border border-ui bg-raised p-3 text-xs leading-5 text-primary">
      <p>{share.password_required ? (zh ? "密码保护" : "Password protected") : (zh ? "公开链接" : "Public link")}</p>
      <p>{share.scope === "conversation" ? (zh ? "整个对话" : "Entire conversation") : (zh ? `${share.selected_message_ids?.length ?? 0} 条消息` : `${share.selected_message_ids?.length ?? 0} messages`)}</p>
      <p>{share.expires_at ? (zh ? "到期：" : "Expires: ") + new Date(share.expires_at).toLocaleString(locale) : (zh ? "永久有效" : "No expiry")}</p>
    </div> : null}
  </div>;
}
