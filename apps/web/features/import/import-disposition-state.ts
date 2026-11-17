import type { AdaptiveImportSession } from "../../lib/types";

export type ImportDispositionControl = {
  operationId: string;
  action: "retain" | "discard" | "cleanup";
  state: "pending" | "unknown" | "confirmed" | "rejected";
  rejected?: boolean;
};

/** One small, account-local receipt survives a reload; it never stores source text. */
export function restoreDisposition(storage: Pick<Storage, "getItem">, key: string): ImportDispositionControl | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (value && typeof value.operationId === "string" && value.operationId.length <= 100
      && ["retain", "discard", "cleanup"].includes(value.action)
      && ["pending", "unknown"].includes(value.state)) return { ...value, state: "unknown" };
  } catch { /* Optional device persistence must not issue a write. */ }
  return null;
}

export function dispositionOutcome(action: ImportDispositionControl["action"], session: AdaptiveImportSession) {
  if (session.state === "COMPLETED") return "completed" as const;
  if (action === "retain" && ["PAUSED", "FAILED", "CANCELED"].includes(session.state)) return "stopped" as const;
  if (session.state === "CANCELED" && session.source_cleanup?.state === "completed") return "discarded" as const;
  return null;
}
