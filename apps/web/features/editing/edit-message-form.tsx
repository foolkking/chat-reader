"use client";

import { useState } from "react";
import { useTranslations } from "../../components/preferences-provider";

export function EditMessageForm({
  initialText,
  onCancel,
  onSave,
}: {
  initialText: string;
  onCancel: () => void;
  onSave: (text: string, reason?: string) => Promise<void>;
}) {
  const t = useTranslations();
  const [text, setText] = useState(initialText);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedText = text.trim();
  const isUnchanged = trimmedText === initialText.trim();

  async function submit() {
    setError(null);
    if (!trimmedText || isUnchanged) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave(trimmedText, reason.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableSaveEdit"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-48 w-full resize-y rounded-lg border border-ui bg-surface p-3 font-mono text-sm leading-6 text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]"
      />
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("editReason")}
        className="w-full rounded-lg border border-ui bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]"
      />
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isSaving || !trimmedText || isUnchanged}
          className="rounded-lg bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-ui bg-surface px-3 py-2 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
