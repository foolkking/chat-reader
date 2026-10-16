"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEmailChange, emailChangeError, previewEmailChange, readAuthSession, type PendingEmailChange } from "../../lib/auth-client";
import { authenticationGeneration } from "../../lib/offline-access";
import { usePreferences } from "../../components/preferences-provider";
import { AuthPageShell } from "./auth-page-shell";

export function EmailChangeConfirmation({ token }: { token: string }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [preview, setPreview] = useState<PendingEmailChange | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(true);
  const [error, setError] = useState(""), [changedEmail, setChangedEmail] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const mounted = useRef(true), generation = useRef(authenticationGeneration());
  const operation = useRef(0), checkingRef = useRef(false), confirmingRef = useRef(false);
  const expected = useRef<{ userId: string; email: string; token: string } | null>(null);
  const active = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  const current = useCallback((id: number) => active() && operation.current === id, [active]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);
  const markChanged = useCallback((email: string) => {
    if (!active()) return;
    setChangedEmail(email);
    window.history.replaceState(null, "", window.location.pathname);
  }, [active]);
  const check = useCallback(async () => {
    if (!active() || checkingRef.current || confirmingRef.current) return;
    const id = ++operation.current;
    checkingRef.current = true;
    if (expected.current?.token !== token) expected.current = null;
    setChecking(true); setError(""); setPreview(null); setSignedOut(false);
    try {
      const session = await readAuthSession();
      if (!current(id)) return;
      setSignedOut(!session.authenticated);
      if (session.authenticated && expected.current?.token === token && session.user_id === expected.current.userId && session.email === expected.current.email) {
        markChanged(session.email); return;
      }
      if (session.authenticated && token) {
        const next = await previewEmailChange(token);
        if (!current(id)) return;
        setPreview(next);
        if (session.user_id) expected.current = { userId: session.user_id, email: next.target_email, token };
      }
      else if (!token) setError(zh ? "请重新打开邮件中的完整链接。" : "Reopen the complete link from your email.");
    } catch (cause) {
      if (current(id)) setError(emailChangeError(cause, zh));
    } finally {
      if (checkingRef.current && operation.current === id) checkingRef.current = false;
      if (current(id)) setChecking(false);
    }
  }, [active, current, markChanged, token, zh]);
  useEffect(() => {
    operation.current += 1;
    checkingRef.current = false;
    confirmingRef.current = false;
    expected.current = null;
    void check();
  }, [check]);
  async function confirm() {
    if (!active() || checkingRef.current || confirmingRef.current || !preview) return;
    const id = ++operation.current;
    confirmingRef.current = true;
    const targetEmail = preview.target_email;
    setBusy(true); setError("");
    try {
      const result = await confirmEmailChange(token);
      if (!current(id)) return;
      markChanged(result.email ?? preview?.target_email ?? "");
    } catch (cause) {
      // An interrupted response can follow a committed change. Verify the
      // original UUID and target address before reporting recovered success.
      if (!current(id)) return;
      const session = await readAuthSession().catch(() => null);
      if (!current(id)) return;
      if (session?.authenticated && expected.current?.token === token && expected.current.email === targetEmail
        && session.user_id === expected.current.userId && session.email === expected.current.email) markChanged(session.email);
      else setError(emailChangeError(cause, zh));
    } finally {
      if (confirmingRef.current && operation.current === id) confirmingRef.current = false;
      if (current(id)) setBusy(false);
    }
  }
  return <AuthPageShell title={zh ? "确认修改邮箱" : "Confirm email change"} description={zh ? "只有点击确认，登录邮箱才会更换。" : "Your sign-in email changes only after you confirm below."} footer={<Link href="/" className="text-accent underline underline-offset-4">{zh ? "返回资料库" : "Return to your library"}</Link>}>
    <div className="grid gap-4">
      {checking ? <p role="status" className="text-sm text-secondary">{zh ? "正在检查账户与链接…" : "Checking your account and link…"}</p> : null}
      {changedEmail ? <div role="status" className="space-y-3"><p className="text-sm font-medium text-primary">{zh ? "邮箱已更换" : "Email changed"}</p><p className="break-all text-sm text-primary">{changedEmail}</p><p className="text-sm leading-6 text-secondary">{zh ? "请使用新邮箱登录。资料和本机离线归属保持不变，当前设备继续登录，其他设备会话已撤销。" : "Use your new email to sign in. Your data and offline ownership are unchanged. This device stays signed in; other sessions have been revoked."}</p></div> : <>
        {preview ? <><div className="rounded-lg border border-ui bg-subtle p-4"><p className="text-xs text-secondary">{zh ? "新的登录邮箱" : "New sign-in email"}</p><p className="mt-2 break-all text-base font-medium text-primary">{preview.target_email}</p><p className="mt-3 text-xs text-secondary">{zh ? "链接到期：" : "Link expires: "}{new Date(preview.expires_at).toLocaleString(resolvedLocale)}</p></div><p className="text-sm leading-6 text-secondary">{zh ? "确认后会撤销其他设备会话；当前设备和所有资料保留。" : "Confirming signs out other devices. This device and all your data are retained."}</p><button type="button" disabled={busy || checking} className="btn-primary min-h-11 px-4" onClick={() => void confirm()}>{busy ? (zh ? "正在确认…" : "Confirming…") : (zh ? "确认使用新邮箱" : "Confirm new email")}</button></> : null}
        {signedOut ? <p className="text-sm leading-6 text-secondary">{zh ? "请在新标签页登录申请修改的原账户，再回到这里重新检查。" : "Sign in to the original account in a new tab, then return here to check again."}</p> : null}
        {(signedOut || error) && !checking ? <div className="flex flex-wrap gap-3"><a href="/login?reauth=1" target="_blank" rel="noreferrer" className="btn-secondary inline-flex min-h-11 items-center px-3 text-sm">{zh ? "登录原账户（新标签页）" : "Sign in to original account (new tab)"}</a><button type="button" disabled={busy || checking} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => void check()}>{zh ? "重新检查" : "Check again"}</button></div> : null}
      </>}
      {error ? <p role="alert" className="state-error text-sm">{error}</p> : null}
    </div>
  </AuthPageShell>;
}
