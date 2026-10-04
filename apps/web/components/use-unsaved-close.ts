"use client";

import { useRef } from "react";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { usePreferences } from "./preferences-provider";

/** A single dismissal boundary for close, backdrop and Escape. */
export function useUnsavedClose({ dirty, busy, onClose }: { dirty: boolean; busy: boolean; onClose: () => void }) {
  const dialog = useInteractionDialog();
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const asking = useRef(false);
  return async () => {
    if (busy || asking.current) return;
    if (!dirty) { onClose(); return; }
    asking.current = true;
    try {
      if (await dialog.confirm({
        title: zh ? "放弃未保存的修改？" : "Discard unsaved changes?",
        description: zh ? "关闭后，这次输入的内容将丢失。" : "Closing will discard what you entered.",
        confirmLabel: zh ? "放弃修改" : "Discard changes",
        danger: true,
      })) onClose();
    } finally { asking.current = false; }
  };
}
