"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { loginWithPassword, rememberOfflineLease, safeReturnPath } from "../../lib/auth-client";

export default function LoginPage() {
  return <Suspense fallback={<LoginShell />}><LoginForm /></Suspense>;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const session = await loginWithPassword(password);
      rememberOfflineLease(session.inactivity_expires_at);
      const destination = safeReturnPath(searchParams?.get("return_to") ?? "/");
      window.location.replace(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Incorrect password.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return <LoginShell><form onSubmit={submit} className="mt-6 space-y-4">
    <div className="space-y-1.5 text-left">
      <label htmlFor="owner-password" className="text-sm font-medium text-primary">Password</label>
      <input id="owner-password" name="password" type="password" autoComplete="current-password" autoFocus required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} className="input-base min-h-11 w-full px-3" />
    </div>
    {error ? <p role="alert" aria-live="assertive" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
    <button type="submit" disabled={submitting || !password} className="btn-primary min-h-11 w-full px-4 font-medium">{submitting ? "Signing in…" : "Sign in"}</button>
  </form></LoginShell>;
}

function LoginShell({ children }: { children?: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-page p-6"><section className="w-full max-w-sm rounded-xl border border-ui bg-surface p-6 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Chat Reader</p><h1 className="mt-2 text-2xl font-semibold text-primary">Unlock your library</h1><p className="mt-2 text-sm text-secondary">Enter the owner password for this device.</p>{children}</section></main>;
}
