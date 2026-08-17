"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearBrowserAuthenticationState,
  hasCurrentOfflineLease,
  loginLocation,
  readAuthSession,
  rememberOfflineLease,
} from "../lib/auth-client";

type AuthState = "checking" | "granted" | "offline-locked";

export function AuthBoundary({ children, authEnabled = true }: { children: React.ReactNode; authEnabled?: boolean }) {
  const pathname = usePathname();
  const currentPath = pathname ?? "/";
  // Auth-disabled test/dev mode must preserve the legacy offline shell from the
  // first render. Production and auth-enabled tests still begin fail-closed.
  const [state, setState] = useState<AuthState>(!authEnabled || currentPath === "/login" ? "granted" : "checking");

  useEffect(() => {
    if (!authEnabled) {
      setState("granted");
      return;
    }
    if (currentPath === "/login") {
      setState("granted");
      return;
    }
    let active = true;

    const verify = async () => {
      if (!navigator.onLine) {
        if (hasCurrentOfflineLease()) {
          if (active) setState("granted");
        } else {
          await clearBrowserAuthenticationState();
          if (active) setState("offline-locked");
        }
        return;
      }
      try {
        const session = await readAuthSession();
        if (!session.authenticated) {
          await clearBrowserAuthenticationState();
          window.location.replace(loginLocation(currentPath));
          return;
        }
        rememberOfflineLease(session.inactivity_expires_at);
        if (active) setState("granted");
      } catch {
        // An unavailable authentication authority never grants a fresh session.
        if (active) setState("checking");
      }
    };

    const unauthorized = () => {
      void clearBrowserAuthenticationState().finally(() => {
        window.location.replace(loginLocation(currentPath));
      });
    };
    const recheck = () => void verify();
    void verify();
    const interval = window.setInterval(recheck, 5 * 60 * 1000);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [authEnabled, currentPath]);

  if (currentPath === "/login") return children;
  if (state === "checking") {
    return <main className="grid min-h-screen place-items-center bg-page p-6 text-sm text-secondary" aria-live="polite">Checking trusted device…</main>;
  }
  if (state === "offline-locked") {
    return <main className="grid min-h-screen place-items-center bg-page p-6"><section className="w-full max-w-md rounded-xl border border-ui bg-surface p-6 text-center shadow-sm"><h1 className="text-lg font-semibold text-primary">Password required</h1><p className="mt-2 text-sm text-secondary">Reconnect to verify this device. Offline business data has been locked and removed from the application cache.</p></section></main>;
  }
  return children;
}
