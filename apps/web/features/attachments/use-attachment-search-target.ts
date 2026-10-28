"use client";

import { useEffect, useMemo, useRef } from "react";

/** Focus a committed file row once for an explicit search activation. */
export function useAttachmentSearchTarget(scope: { focused: boolean } | null) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const row = ref.current;
    if (!scope || scope.focused || !row) return;
    scope.focused = true;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  }, [scope]);
  return ref;
}

export function useAttachmentSearchActivation(conversationId: string, attachmentId?: string | null, replayKey = 0) {
  return useMemo(() => ({ focused: false }), [conversationId, attachmentId, replayKey]);
}
