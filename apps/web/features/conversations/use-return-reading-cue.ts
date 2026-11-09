"use client";

import { useEffect, useState } from "react";

/** Presentation lifetime only: the real navigation checkpoint is never cleared. */
export function useReturnReadingCue(startedAt: number, available: boolean, busy: boolean) {
  const [phase, setPhase] = useState<"emphasized" | "ordinary" | "hidden">("hidden");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!available || !startedAt) { setFocused(false); setPhase("hidden"); return; }
    const elapsed = Date.now() - startedAt;
    setPhase(elapsed < 3000 ? "emphasized" : elapsed < 30_000 ? "ordinary" : "hidden");
    const ordinary = elapsed < 3000 ? window.setTimeout(() => setPhase("ordinary"), 3000 - elapsed) : undefined;
    const hidden = elapsed < 30_000 ? window.setTimeout(() => setPhase("hidden"), 30_000 - elapsed) : undefined;
    return () => { window.clearTimeout(ordinary); window.clearTimeout(hidden); };
  }, [startedAt, available]);
  return {
    visible: available && Boolean(startedAt) && (phase !== "hidden" || focused || busy),
    emphasized: phase === "emphasized",
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
