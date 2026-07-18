"use client";

import { useState } from "react";
import { useTranslations } from "../../components/preferences-provider";
import { getHealth } from "../../lib/api";

export default function OfflinePage() {
  const t = useTranslations();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"ok" | "failed" | null>(null);
  async function checkConnection() { setChecking(true); try { await getHealth(); setStatus("ok"); } catch { setStatus("failed"); } finally { setChecking(false); } }
  return <main className="flex min-h-screen items-center justify-center bg-page px-[4vw] text-primary"><section className="w-full max-w-md rounded-xl border border-ui bg-raised p-6 shadow-sm"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-semibold text-white">CR</span><div><h1 className="text-lg font-semibold">{t("connectionFailed")}</h1><p className="text-sm text-secondary">{t("connectionHint")}</p></div></div><div className="mt-5 flex gap-2"><button type="button" onClick={() => void checkConnection()} disabled={checking} className="rounded-lg bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:opacity-60">{checking ? "…" : t("retry")}</button><button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-ui bg-surface px-4 py-2 text-sm font-medium">Reload</button></div>{status ? <p role="status" className={`mt-3 text-sm ${status === "ok" ? "text-accent" : "text-[var(--danger)]"}`}>{status === "ok" ? "API OK" : t("connectionFailed")}</p> : null}</section></main>;
}
