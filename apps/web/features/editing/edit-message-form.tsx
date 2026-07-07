"use client";

import { useState } from "react";

export function EditMessageForm({
  initialText,
  onCancel,
  onSave,
}: {
  initialText: string;
  onCancel: () => void;
  onSave: (text: string, reason?: string) => Promise<void>;
}) {
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
      setError(err instanceof Error ? err.message : "Unable to save edit.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-48 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-sm leading-6 text-slate-950 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Edit reason"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isSaving || !trimmedText || isUnchanged}
          className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSaving ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
