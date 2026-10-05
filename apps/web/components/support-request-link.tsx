"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { SettingsFocusedDialog } from "./settings-focused-dialog";

/** One authenticated owner for notification links, independent of responsive sidebars. */
export function SupportRequestLink() {
  const [id, setId] = useState<string | null>(null), opener = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    const read = () => {
      if (!pathname || /^\/(share|login|register|account-upgrade|password-reset|reset-password|verify-email)(\/|$)/.test(pathname)) return;
      const match = /^#support-request=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(location.hash);
      if (match) { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setId(match[1]); history.replaceState(history.state, "", `${location.pathname}${location.search}`); }
    };
    read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read);
  }, [pathname]);
  return id ? <SettingsFocusedDialog key={id} category="requests" initialSupportRequestId={id} onClose={() => setId(null)} restoreFocus={() => opener.current} /> : null;
}
