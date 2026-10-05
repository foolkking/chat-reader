"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CopyPhase = "copying" | "copied" | "failed";

/** Feedback belongs to the exact text copied, including across locale changes. */
export function useClipboardCopy(value: string) {
  const [result, setResult] = useState<{ value: string; phase: CopyPhase } | null>(null);
  const sequence = useRef(0);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const state = result?.value === value ? result.phase : "idle";
  useEffect(() => {
    if (state !== "failed") return;
    const field = manualRef.current;
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "nearest" });
    field?.select();
  }, [state, value]);
  const copy = useCallback(async () => {
    const current = ++sequence.current;
    setResult({ value, phase: "copying" });
    try {
      // Access itself can throw when the browser has no Clipboard API.
      await navigator.clipboard.writeText(value);
      if (current === sequence.current) setResult({ value, phase: "copied" });
    } catch {
      if (current === sequence.current) setResult({ value, phase: "failed" });
    }
  }, [value]);
  return { copy, state, manualRef };
}
