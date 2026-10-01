"use client";

import { useState } from "react";
import { pendingSignoutCleanups, retrySignoutCleanup } from "../lib/signout-cleanup";

export function SignoutCleanupRecovery({ zh, onComplete }: { zh: boolean; onComplete: () => void }) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const retry = async () => {
    setBusy(true); setFailed(false);
    try {
      if (await retrySignoutCleanup() && !pendingSignoutCleanups().length) onComplete();
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-l-2 border-[var(--danger)] pl-3 text-left" aria-label={zh ? "退出后的本机清理" : "Signout cleanup"}>
    <p className="text-sm font-semibold" role="alert">{zh ? "已退出登录，本机资料尚未全部清除" : "Signed out. Some local data could not be cleared."}</p>
    <p className="text-sm leading-6 text-secondary">{zh ? "这些资料已锁定。请关闭其他资料库标签页后重试；完成清理后可继续登录。" : "This data is locked. Close other library tabs and retry. Sign in again after cleanup finishes."}</p>
    {failed ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "清理仍未完成。请允许本站使用浏览器存储后重试，或在浏览器设置中清除本站数据后重新打开登录页。" : "Cleanup is still incomplete. Allow browser storage and retry, or clear this site's data in browser settings and reopen sign-in."}</p> : null}
    <button type="button" className="btn-primary min-h-11 px-4 text-sm" disabled={busy} onClick={() => void retry()}>{busy ? (zh ? "正在清理…" : "Clearing…") : (zh ? "重试本机清理" : "Retry local cleanup")}</button>
  </section>;
}
