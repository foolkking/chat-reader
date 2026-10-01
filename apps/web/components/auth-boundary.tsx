"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OfflineWriteBarrier } from "./offline-write-barrier";
import { configureOfflineAccess, OFFLINE_ACCESS_LOCKED_EVENT } from "../lib/offline-access";
import { SIGNOUT_CLEANUP_EVENT, SignoutCleanupPendingError } from "../lib/signout-cleanup";
import { SignoutCleanupRecovery } from "./signout-cleanup-recovery";
import {
  AUTH_UNAUTHORIZED_EVENT,
  AUTH_OFFLINE_IDENTITY_STORAGE_KEY,
  AuthRequestError,
  activateOfflineLeaseContext,
  bindAuthenticatedOfflineContext,
  lockBrowserAuthenticationState,
  suspendBrowserOfflineContext,
  getCurrentOfflineRuntimeUserId,
  hasCurrentOfflineLease,
  hasLockedOfflineAccount,
  loginLocation,
  offlineLeaseExpiresAt,
  readAuthSession,
} from "../lib/auth-client";

type AuthState = "checking" | "granted" | "offline-locked" | "unavailable" | "storage-error" | "signout-cleanup";

export function AuthBoundary({ children, authEnabled = true }: { children: React.ReactNode; authEnabled?: boolean }) {
  useState(() => { if (typeof window !== "undefined") configureOfflineAccess(authEnabled); });
  const pathname = usePathname();
  const currentPath = pathname ?? "/";
  const publicShare = /^\/share\/[^/]+\/?$/i.test(currentPath);
  const publicAuth = /^\/(?:login|register|account-upgrade|password-reset|reset-password|verify-email)(?:\/|$)/i.test(currentPath);
  if (!authEnabled || publicAuth || publicShare) return children;
  // A public page must never carry its granted state into private content.
  return <PrivateAuthBoundary currentPath={currentPath}>{children}</PrivateAuthBoundary>;
}

function PrivateAuthBoundary({ children, currentPath }: { children: React.ReactNode; currentPath: string }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>("checking");
  const [attempt, setAttempt] = useState(0);
  const [zh, setZh] = useState(false);

  useEffect(() => {
    setZh(document.documentElement.lang.toLowerCase().startsWith("zh"));
    let active = true;
    let verifying = false;
    let redirecting = false;
    let controller: AbortController | null = null;
    let expiryTimer: number | undefined;

    const destination = () => window.location.pathname + window.location.search + window.location.hash;
    const invalidate = async (offline: boolean) => {
      if (!active || redirecting) return;
      redirecting = true;
      controller?.abort();
      window.clearTimeout(expiryTimer);
      setState(offline ? "offline-locked" : "checking");
      lockBrowserAuthenticationState();
      queryClient.clear();
      if (!active) return;
      if (offline) redirecting = false;
      else window.location.replace(loginLocation(destination()));
    };

    const scheduleExpiry = (expiresAt: number) => {
      window.clearTimeout(expiryTimer);
      if (!Number.isFinite(expiresAt)) return;
      expiryTimer = window.setTimeout(() => {
        if (!active) return;
        setState("checking");
        void verify();
      }, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)));
    };

    const verify = async () => {
      if (!active || verifying || redirecting) return;
      verifying = true;
      controller = new AbortController();
      const signal = controller.signal;
      let stage: "session" | "storage" = "session";
      // Cover response bodies and storage as well as the HTTP connection.
      const deadline = window.setTimeout(() => {
        controller?.abort();
        if (active && !redirecting) setState(stage === "storage" ? "storage-error" : "unavailable");
      }, 15_000);
      try {
        const previousUserId = getCurrentOfflineRuntimeUserId();
        if (!navigator.onLine) {
          if (!hasCurrentOfflineLease()) {
            await invalidate(true);
            return;
          }
          stage = "storage";
          const context = await activateOfflineLeaseContext(signal);
          if (!active || signal.aborted) return;
          if (!hasCurrentOfflineLease()) {
            await invalidate(true);
            return;
          }
          if (previousUserId && previousUserId !== context.userId) {
            window.location.replace(destination());
            return;
          }
          scheduleExpiry(offlineLeaseExpiresAt());
        } else {
          const session = await readAuthSession(signal);
          if (!active || signal.aborted) return;
          if (!session.authenticated) {
            await invalidate(false);
            return;
          }
          if (previousUserId && previousUserId !== (session.user_id ?? session.principal_id)) setState("checking");
          stage = "storage";
          const context = await bindAuthenticatedOfflineContext(session, signal);
          if (!active || signal.aborted) return;
          if (previousUserId && previousUserId !== context.userId) {
            window.location.replace(destination());
            return;
          }
          scheduleExpiry(Date.parse(session.inactivity_expires_at ?? ""));
        }
        setState("granted");
      } catch (cause) {
        if (!active || signal.aborted) return;
        if (cause instanceof SignoutCleanupPendingError) { suspendBrowserOfflineContext(); queryClient.clear(); window.location.replace("/login?reauth=1"); }
        else if (cause instanceof AuthRequestError && cause.status === 401) await invalidate(false);
        else if (stage === "session" && hasLockedOfflineAccount()) setState("offline-locked");
        else if (stage === "session" && !navigator.onLine) { setState("checking"); setAttempt((value) => value + 1); }
        else setState(stage === "storage" ? "storage-error" : "unavailable");
      } finally {
        window.clearTimeout(deadline);
        verifying = false;
      }
    };

    const unauthorized = () => { void invalidate(!navigator.onLine); };
    const accessLocked = () => { void invalidate(!navigator.onLine); };
    const recheck = () => { void verify(); };
    const cleanupRequired = () => {
      redirecting = true;
      controller?.abort(); window.clearTimeout(expiryTimer);
      suspendBrowserOfflineContext(); queryClient.clear(); setState("signout-cleanup");
    };
    const storageChanged = (event: StorageEvent) => {
      if (redirecting) return;
      if (event.key !== AUTH_OFFLINE_IDENTITY_STORAGE_KEY && event.key !== null) return;
      // Hide the old account immediately, even with no network to revalidate.
      controller?.abort();
      suspendBrowserOfflineContext();
      queryClient.clear();
      setState("checking");
      setAttempt((value) => value + 1);
    };
    void verify();
    const interval = window.setInterval(recheck, 5 * 60 * 1000);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, accessLocked);
    window.addEventListener("online", recheck);
    window.addEventListener("offline", recheck);
    window.addEventListener("focus", recheck);
    window.addEventListener("storage", storageChanged);
    window.addEventListener(SIGNOUT_CLEANUP_EVENT, cleanupRequired);
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(expiryTimer);
      window.clearInterval(interval);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, accessLocked);
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", recheck);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(SIGNOUT_CLEANUP_EVENT, cleanupRequired);
    };
  }, [currentPath, attempt, queryClient]);

  if (state === "granted") return <OfflineWriteBarrier zh={zh}>{children}</OfflineWriteBarrier>;
  if (state === "signout-cleanup") return <main className="grid min-h-screen place-items-center bg-page p-6"><div className="w-full max-w-md rounded-xl border border-ui bg-surface p-6"><SignoutCleanupRecovery zh={zh} onComplete={() => window.location.replace("/login")} /></div></main>;
  const copy = zh ? zhCopy : enCopy;
  if (state === "checking") {
    return <main className="grid min-h-screen place-items-center bg-page p-6 text-sm text-secondary" role="status">{copy.checking}</main>;
  }
  const login = loginLocation(currentPath);
  return <main className="grid min-h-screen place-items-center bg-page p-6">
    <section className="w-full max-w-md rounded-xl border border-ui bg-surface p-6 text-center shadow-sm" aria-labelledby="auth-recovery-title">
      <h1 id="auth-recovery-title" className="text-lg font-semibold text-primary">{state === "offline-locked" ? copy.locked : state === "storage-error" ? copy.storageTitle : copy.unavailable}</h1>
      <p className="mt-2 text-sm leading-6 text-secondary" role="alert">{state === "offline-locked" ? copy.reconnect : state === "storage-error" ? copy.storageDescription : copy.connection}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn-primary min-h-11 px-4 text-sm font-medium" onClick={() => { setState("checking"); setAttempt((value) => value + 1); }}>{copy.retry}</button>
        <a className="btn-secondary inline-flex min-h-11 items-center px-4 text-sm font-medium" href={login + (login.includes("?") ? "&" : "?") + "reauth=1"}>{copy.signIn}</a>
      </div>
    </section>
  </main>;
}

const enCopy = {
  checking: "Checking your session…",
  locked: "Sign in required",
  reconnect: "Offline access is locked. Your local copies and unsynced edits are retained. Reconnect and sign in to the same account to restore access.",
  unavailable: "Unable to verify your session",
  connection: "The sign-in service did not respond. Check your connection and try again.",
  storageTitle: "Unable to open browser storage",
  storageDescription: "This browser could not prepare your library. Close other library tabs and try again.",
  retry: "Try again",
  signIn: "Go to sign in",
};

const zhCopy: typeof enCopy = {
  checking: "正在验证登录状态…",
  locked: "需要重新登录",
  reconnect: "离线访问已锁定，本地副本和未同步修改已保留。请联网并重新登录原账户以恢复访问。",
  unavailable: "暂时无法验证登录状态",
  connection: "登录服务未能响应。请检查网络连接后重试。",
  storageTitle: "无法打开浏览器存储",
  storageDescription: "浏览器无法准备资料库。请关闭其他资料库标签页后重试。",
  retry: "重试",
  signIn: "前往登录",
};
