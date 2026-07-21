"use client";

import { useState } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { useTranslations } from "../../components/preferences-provider";

export function RestoreVersionButton({
  versionNumber,
  onRestore,
}: {
  versionNumber: number;
  onRestore: () => Promise<void>;
}) {
  const [isRestoring, setIsRestoring] = useState(false);
  const dialog = useInteractionDialog();
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (!(await dialog.confirm({ title: t("restoreVersionTitle", { version: versionNumber }), description: t("restoreVersionDescription"), confirmLabel: t("restore") }))) {
      return;
    }
    setError(null);
    setIsRestoring(true);
    try {
      await onRestore();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableRestoreVersion"));
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
        className="rounded-lg border border-ui bg-surface px-3 py-1.5 text-xs font-medium text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRestoring ? t("restoring") : t("restore")}
      </button>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
