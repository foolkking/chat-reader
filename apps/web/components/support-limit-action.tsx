"use client";

import { useRef, useState } from "react";
import type { AccountCapabilities } from "../lib/auth-client";
import { usePreferences } from "./preferences-provider";
import { SettingsFocusedDialog } from "./settings-focused-dialog";

/** Keep the originating import/merge mounted while a user requests help. */
export function SupportLimitAction({ capabilities, limit, requestedValue, active, returnFocus, onReturn }: {
  capabilities: AccountCapabilities;
  limit: "import_size_mb" | "merge_message_count";
  requestedValue: number;
  active: boolean;
  returnFocus: () => HTMLElement | null;
  onReturn: () => void;
}) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const admin = capabilities.role === "ADMIN";
  const hard = capabilities.limit_hard_bounds?.[limit];
  const current = limit === "import_size_mb" ? capabilities.maximum_import_size_mb : capabilities.maximum_merge_message_count;
  const canIncrease = hard != null && requestedValue > current && requestedValue <= hard && (limit !== "import_size_mb" || capabilities.allow_user_import);
  return <>{active ? <div className="flex flex-wrap items-center gap-2">
    {hard != null && requestedValue > hard ? <p className="w-full text-xs text-secondary">{limit === "import_size_mb" ? (zh ? `服务器目前最多支持单文件 ${hard} MiB，请拆分文件或联系管理员。` : `This server currently supports up to ${hard} MiB per file. Split the file or contact the administrator.`) : (zh ? `服务器目前最多支持合并 ${hard.toLocaleString()} 条消息，请减少所选对话或联系管理员。` : `This server currently supports up to ${hard.toLocaleString()} merged messages. Select fewer conversations or contact the administrator.`)}</p> : null}
    <button ref={opener} type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => setOpen(true)}>
      {admin ? (zh ? "调整系统限制" : "Adjust system limits") : canIncrease ? (zh ? "申请提高上限" : "Request a higher limit") : (zh ? "向管理员求助" : "Ask the administrator")}
    </button>
    <button type="button" className="btn-ghost min-h-11 px-3 text-sm text-secondary" onClick={onReturn}>{zh ? "刷新限制" : "Refresh limits"}</button>
  </div> : null}
    {open ? <SettingsFocusedDialog category={admin ? "admin-features" : "requests"} initialSupportKind={canIncrease ? "LIMIT" : "QUESTION"} initialSupportLimits={canIncrease ? { [limit]: requestedValue } : undefined} restoreFocus={() => opener.current ?? returnFocus()} onClose={() => { setOpen(false); onReturn(); }} /> : null}
  </>;
}
