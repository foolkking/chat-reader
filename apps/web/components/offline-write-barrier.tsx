"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getActiveOfflineStorageContext } from "../lib/offline-db";
import { OFFLINE_WRITE_FREEZE_EVENT, offlineWriteFreezeExpiry } from "../lib/offline-write-guard";

// Keep working components mounted while another tab finalizes signout. An
// unsuccessful request restores the editor with its in-memory input intact.
export function OfflineWriteBarrier({ children, zh }: { children: ReactNode; zh: boolean }) {
  const [paused, setPaused] = useState(false);
  const overlay = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const remaining = offlineWriteFreezeExpiry(getActiveOfflineStorageContext().userId) - Date.now();
      setPaused(remaining > 0);
      if (remaining > 0) timer = setTimeout(update, remaining + 10);
    };
    update();
    window.addEventListener(OFFLINE_WRITE_FREEZE_EVENT, update);
    window.addEventListener("storage", update);
    return () => { clearTimeout(timer); window.removeEventListener(OFFLINE_WRITE_FREEZE_EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  useEffect(() => {
    if (!paused) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const states = new Map<HTMLElement, boolean>();
    const apply = () => {
      for (const element of Array.from(document.body.children)) {
        if (!(element instanceof HTMLElement) || element === overlay.current || states.has(element)) continue;
        states.set(element, element.inert); element.inert = true;
      }
    };
    apply(); overlay.current?.focus();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true });
    return () => { observer.disconnect(); states.forEach((wasInert, element) => { element.inert = wasInert; }); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [paused]);
  return <>{children}{paused ? createPortal(<div ref={overlay} tabIndex={-1} className="fixed inset-0 z-[600] grid place-items-center bg-[var(--overlay)] p-6 outline-none" role="status"><p className="max-w-md rounded-xl border border-ui bg-raised p-5 text-sm text-primary">{zh ? "正在处理此账户的退出，请稍候。此设备的其他标签页已暂时停止编辑；操作失败后可继续。" : "Finishing signout for this account. Editing is paused across this device's tabs. If it fails, you can continue editing."}</p></div>, document.body) : null}</>;
}
