"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { assertOfflineAccess, authenticationGeneration, captureOfflineAccess, notifyAuthenticationFailure, OFFLINE_ACCESS_LOCKED_EVENT } from "../../lib/offline-access";

export function DirectExportDownload({ href, format }: { href: string; format: "canjson" | "markdown" }) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  return <DownloadButton key={`${href}:${zh}`} href={href} format={format} zh={zh} />;
}

function DownloadButton({ href, format, zh }: { href: string; format: "canjson" | "markdown"; zh: boolean }) {
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const stop = () => active.current?.abort();
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, stop);
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, stop);
    };
  }, []);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    const generation = authenticationGeneration();
    active.current = controller;
    setBusy(true); setError(null); setStarted(false);
    let status: number | null = null;
    try {
      const access = captureOfflineAccess();
      const response = await fetch(href, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      status = response.status;
      if (status === 401) notifyAuthenticationFailure(access);
      assertOfflineAccess(access);
      if (!response.ok) throw new Error("Download unavailable");
      const expectedType = format === "canjson" ? "application/x-ndjson" : "text/markdown";
      if (!response.headers.get("content-type")?.startsWith(expectedType)) throw new Error("Unexpected download response");
      const blob = await response.blob();
      assertOfflineAccess(access);
      if (!mounted.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = downloadName(response.headers.get("content-disposition"), format);
        link.click();
        setStarted(true);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted && generation === authenticationGeneration()) {
        setError(status === 404
          ? (zh ? "对话已不可用，无法下载。" : "This conversation is no longer available.")
          : status === 503
            ? (zh ? "暂时无法准备下载，请稍后重试。" : "The download could not be prepared. Please retry shortly.")
            : (zh ? "下载失败，请检查连接并重试。" : "Download failed. Check your connection and retry."));
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className="grid min-w-0 gap-2" data-testid="direct-export-download">
    <div className="flex gap-2">
      <button type="button" disabled={busy} aria-busy={busy} onClick={() => void download()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] hover:opacity-85 disabled:cursor-wait disabled:opacity-60">
        <Download className="h-4 w-4 shrink-0" aria-hidden />
        {busy ? (zh ? "正在准备下载…" : "Preparing download…") : error ? (zh ? "重试下载" : "Retry download") : (zh ? "下载文件" : "Download file")}
      </button>
      {busy ? <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => active.current?.abort()}>{zh ? "取消" : "Cancel"}</button> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {started ? <p role="status" className="text-xs text-secondary">{zh ? "下载已交给浏览器。" : "Download sent to your browser."}</p> : null}
  </div>;
}

function downloadName(disposition: string | null, format: "canjson" | "markdown"): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* Use the safe fallback. */ }
  }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? `conversation.${format === "canjson" ? "canonical.jsonl" : "md"}`;
}
