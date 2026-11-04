"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEVICE_TRUST_KEY } from "../lib/offline-device-trust";
import { pauseServerSession, serverSession, SERVER_SESSION_CHANGED } from "../lib/server-session";
import { OfflineWriteBarrier } from "./offline-write-barrier";
import { configureOfflineAccess, OFFLINE_ACCESS_LOCKED_EVENT } from "../lib/offline-access";
import { pendingSignoutCleanups, SIGNOUT_CLEANUP_EVENT, SignoutCleanupPendingError } from "../lib/signout-cleanup";
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
  readAuthSession,
  forgetAuthSession,
  refreshAuthenticatedOfflineLease,
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
  const [notice, setNotice] = useState<"unavailable" | "sign-in-required" | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    setZh(document.documentElement.lang.toLowerCase().startsWith("zh"));
    let active = true, verifying = false;
    let controller: AbortController | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    // Do not restart this effect on route navigation. A public route is never
    // owned by an old private check, even before React unmounts it.
    const ownsRoute = () => active && !/^\/(?:share|login|register|verify-email|reset-password|password-reset|account-upgrade)(?:\/|$)/i.test(window.location.pathname);
    const destination = () => window.location.pathname + window.location.search + window.location.hash;
    const showReady = () => { ready.current = true; setState("granted"); };
    const invalidate = (security: boolean) => {
      if (!ownsRoute()) return;
      // A late successful check must not unlock a device after an explicit
      // revocation/local lock, or re-enable writes after a newer 401.
      controller?.abort();
      forgetAuthSession();
      pauseServerSession("sign-in-required");
      clearTimeout(expiryTimer);
      if (!security && ready.current) { setNotice("sign-in-required"); return; }
      if (!security && hasCurrentOfflineLease() && /^\/library(?:\/|$)/.test(window.location.pathname)) {
        setNotice("sign-in-required");
        if (ready.current) return;
        setAttempt(value => value + 1);
        return;
      }
      if (security) lockBrowserAuthenticationState(false);
      else suspendBrowserOfflineContext();
      ready.current = false;
      queryClient.clear();
      if (!navigator.onLine || security) setState("offline-locked");
      else window.location.replace(loginLocation(destination()));
    };
    const verify = async (force = false) => {
      if (!ownsRoute() || verifying) return;
      // A durable signout cleanup owns recovery even after a reload. Showing
      // only the local-lock screen would hide its retry and strand retained data.
      if (pendingSignoutCleanups().length) {
        cleanupRequired();
        return;
      }
      if (hasLockedOfflineAccount()) {
        ready.current = false; setState("offline-locked");
        pauseServerSession("sign-in-required");
        return;
      }
      verifying = true;
      controller = new AbortController();
      const signal = controller.signal;
      let stage: "session" | "storage" = "session";
      const deadline = setTimeout(() => {
        controller?.abort();
        if (!ownsRoute()) return;
        if (ready.current) { pauseServerSession("unavailable"); setNotice("unavailable"); }
        else setState(stage === "storage" ? "storage-error" : "unavailable");
      }, 15_000);
      try {
        const library = /^\/library(?:\/|$)/.test(window.location.pathname);
        const previousUserId = getCurrentOfflineRuntimeUserId();
        // Cold local startup must not await the network, even with a lying
        // navigator.onLine value or an expired/missing HTTP session cookie.
        if (!ready.current && (library || !navigator.onLine) && hasCurrentOfflineLease()) {
          stage = "storage";
          await activateOfflineLeaseContext(signal);
          if (!ownsRoute() || signal.aborted) return;
          showReady();
          stage = "session";
        }
        if (!navigator.onLine) {
          pauseServerSession("unavailable");
          if (!ready.current) setState("offline-locked");
          return;
        }
        const session = await readAuthSession(signal, force ? 0 : 5 * 60_000);
        if (!ownsRoute() || signal.aborted) return;
        if (!session.authenticated) {
          invalidate(["revoked", "account_restricted", "credentials_changed"].includes(session.failure_reason ?? ""));
          return;
        }
        if (previousUserId && previousUserId !== (session.user_id ?? session.principal_id)) {
          ready.current = false; setState("checking"); queryClient.clear();
        }
        stage = "storage";
        const context = await bindAuthenticatedOfflineContext(session, signal);
        if (!ownsRoute() || signal.aborted) return;
        if (previousUserId && previousUserId !== context.userId) {
          window.location.replace(destination()); return;
        }
        showReady(); setNotice(null);
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => {
          if (document.visibilityState === "visible") void verify(true);
        }, Math.max(1_000, Math.min(serverSession().expiresAt - Date.now(), 2_147_483_647)));
      } catch (cause) {
        if (!ownsRoute() || signal.aborted) return;
        if (cause instanceof SignoutCleanupPendingError) {
          suspendBrowserOfflineContext(); queryClient.clear(); window.location.replace("/login?reauth=1");
        } else if (cause instanceof AuthRequestError && cause.status === 401) invalidate(false);
        else if (stage === "session" && ready.current) { pauseServerSession("unavailable"); setNotice("unavailable"); }
        else if (stage === "session" && hasLockedOfflineAccount()) setState("offline-locked");
        else setState(stage === "storage" ? "storage-error" : "unavailable");
      } finally { clearTimeout(deadline); verifying = false; }
    };
    const unauthorized = (event: Event) => {
      const reason = (event as CustomEvent<{reason?: string}>).detail?.reason;
      if (["revoked", "account_restricted", "credentials_changed"].includes(reason ?? "")) invalidate(true);
      else if (reason === "expired" || reason === "missing_session") invalidate(false);
      else { forgetAuthSession(); void verify(true); }
    };
    const accessLocked = () => invalidate(true);
    const recheck = () => { if (document.visibilityState === "visible") void verify(); };
    const networkChanged = () => {
      if (!navigator.onLine) { pauseServerSession("unavailable"); setNotice("unavailable"); }
      else { forgetAuthSession(); void verify(true); }
    };
    const cleanupRequired = () => {
      if (!ownsRoute()) return;
      controller?.abort(); clearTimeout(expiryTimer);
      pauseServerSession("sign-in-required");
      ready.current = false;
      suspendBrowserOfflineContext(); queryClient.clear(); setState("signout-cleanup");
    };
    const storageChanged = (event: StorageEvent) => {
      if (!ownsRoute() || ![AUTH_OFFLINE_IDENTITY_STORAGE_KEY, DEVICE_TRUST_KEY, null].includes(event.key)) return;
      controller?.abort(); forgetAuthSession(); pauseServerSession("sign-in-required");
      ready.current = false;
      suspendBrowserOfflineContext(); queryClient.clear(); setState("checking");
      setAttempt(value => value + 1);
    };
    void verify();
    const interval = setInterval(recheck, 5 * 60_000);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, accessLocked);
    window.addEventListener("online", networkChanged);
    window.addEventListener("offline", networkChanged);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("storage", storageChanged);
    window.addEventListener(SIGNOUT_CLEANUP_EVENT, cleanupRequired);
    window.addEventListener(SERVER_SESSION_CHANGED, refreshAuthenticatedOfflineLease);
    return () => {
      active = false; controller?.abort(); clearTimeout(expiryTimer); clearInterval(interval);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, accessLocked);
      window.removeEventListener("online", networkChanged);
      window.removeEventListener("offline", networkChanged);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(SIGNOUT_CLEANUP_EVENT, cleanupRequired);
      window.removeEventListener(SERVER_SESSION_CHANGED, refreshAuthenticatedOfflineLease);
    };
  }, [attempt, queryClient]);

  if (state === "granted") return <OfflineWriteBarrier zh={zh}>{children}{notice ? <aside role="status" className="fixed bottom-4 right-4 z-[70] max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-ui bg-surface p-3 text-sm text-primary shadow-sm">
    <p>{notice === "sign-in-required" ? (zh ? "需要重新登录，在线操作和同步已暂停。已打开的内容仍保留；可信本机资料可继续使用。" : "Sign in again for online operations and sync. Open content is retained; trusted local copies remain available.") : (zh ? "暂时无法连接服务器。已打开的内容仍保留，可信本机资料可继续使用。" : "The server is unavailable. Open content is retained; trusted local copies remain available.")}</p>
    <div className="mt-2 flex flex-wrap gap-3"><button type="button" className="min-h-10 text-accent" onClick={() => { forgetAuthSession(); setAttempt(value => value + 1); }}>{zh ? "重新连接" : "Reconnect"}</button>{notice === "sign-in-required" ? <a className="inline-flex min-h-10 items-center text-accent" href={loginLocation(currentPath) + (currentPath === "/" ? "?" : "&") + "reauth=1"}>{zh ? "重新登录" : "Sign in"}</a> : null}<button type="button" className="min-h-10 text-secondary" onClick={() => setNotice(null)}>{zh ? "收起提示" : "Dismiss"}</button></div>
  </aside> : null}</OfflineWriteBarrier>;
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
