"use client";

import { useState } from "react";

export function RestoreVersionButton({
  versionNumber,
  onRestore,
}: {
  versionNumber: number;
  onRestore: () => Promise<void>;
}) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (!window.confirm(`Restore version ${versionNumber}?`)) {
      return;
    }
    setError(null);
    setIsRestoring(true);
    try {
      await onRestore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to restore version.");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={restore}
        disabled={isRestoring}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {isRestoring ? "Restoring" : "Restore"}
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
