"use client";

import { usePreferences } from "../../components/preferences-provider";
import { useEffect, useRef } from "react";
import type { CleanupApplyResult } from "../../lib/types";

export function CleanupCompletion({ result, busy = false, readFailed = false, onContinue }: {
  result: CleanupApplyResult; busy?: boolean; readFailed?: boolean; onContinue?: () => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => { resultRef.current?.focus({ preventScroll: true }); }, []);
  return <section ref={resultRef} tabIndex={-1} aria-label={zh ? "清理结果" : "Cleanup result"} className="space-y-3 rounded-md py-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
    <h3 className="text-base font-semibold text-primary">{result.conflicts ? (zh ? "本次清理已处理" : "Cleanup processed") : (zh ? "清理已完成" : "Cleanup completed")}</h3>
    <p role="status" className="text-sm text-secondary">{zh ? `已删除 ${result.applied} 个片段${result.conflicts ? `，${result.conflicts} 项冲突保留原文` : ""}。` : `${result.applied} ${result.applied === 1 ? "fragment" : "fragments"} removed${result.conflicts ? `; ${result.conflicts} ${result.conflicts === 1 ? "conflict" : "conflicts"} kept unchanged` : ""}.`}</p>
    {readFailed ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "正文重新读取失败。清理结果已保存，重试只会读取，不会再次清理。" : "The source could not reload. Cleanup is saved; retry only reads the result and does not apply it again."}</p> : null}
    {onContinue ? <button type="button" disabled={busy} onClick={onContinue} className="btn-secondary min-h-11 px-4 text-sm">{busy ? (zh ? "正在读取正文…" : "Reloading source…") : readFailed ? (zh ? "重新读取正文" : "Reload source") : result.conflicts ? (zh ? "继续审查" : "Continue review") : (zh ? "完成" : "Done")}</button> : null}
  </section>;
}
