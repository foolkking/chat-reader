"use client";

import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { usePreferences } from "./preferences-provider";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
};

type PromptOptions = ConfirmOptions & {
  initialValue?: string;
  label?: string;
  placeholder?: string;
};

type DialogState =
  | ({ kind: "confirm" } & ConfirmOptions)
  | ({ kind: "prompt" } & PromptOptions)
  | null;

type InteractionDialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const InteractionDialogContext = createContext<InteractionDialogContextValue | null>(null);

export function InteractionDialogProvider({ children }: { children: React.ReactNode }) {
  const { resolvedLocale } = usePreferences();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null);
  const zh = resolvedLocale === "zh-CN";

  const settle = useCallback((result: boolean | string | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
    setError(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolverRef.current = resolve as (value: boolean | string | null) => void;
    setValue("");
    setError(null);
    setDialog({ kind: "confirm", ...options });
  }), []);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    resolverRef.current = resolve as (value: boolean | string | null) => void;
    setValue(options.initialValue ?? "");
    setError(null);
    setDialog({ kind: "prompt", ...options });
  }), []);

  const context = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  return (
    <InteractionDialogContext.Provider value={context}>
      {children}
      {dialog ? (
        <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-labelledby="interaction-dialog-title" onKeyDown={(event) => { if (event.key === "Escape") settle(dialog.kind === "confirm" ? false : null); }}>
          <button type="button" className="absolute inset-0" aria-label={zh ? "关闭" : "Close"} onClick={() => settle(dialog.kind === "confirm" ? false : null)} />
          <form className="relative w-full rounded-t-2xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-md sm:rounded-xl" onSubmit={(event) => {
            event.preventDefault();
            if (dialog.kind === "prompt") {
              const trimmed = value.trim();
              if (!trimmed) { setError(zh ? "内容不能为空。" : "This field cannot be empty."); return; }
              settle(trimmed);
            } else settle(true);
          }}>
            <div className="flex items-start gap-3">
              {dialog.danger ? <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]"><AlertTriangle className="h-4 w-4" /></span> : null}
              <div className="min-w-0 flex-1"><h2 id="interaction-dialog-title" className="text-base font-semibold text-primary">{dialog.title}</h2>{dialog.description ? <p className="mt-1 text-sm leading-6 text-secondary">{dialog.description}</p> : null}</div>
              <button type="button" onClick={() => settle(dialog.kind === "confirm" ? false : null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
            </div>
            {dialog.kind === "prompt" ? <label className="mt-4 block text-sm font-medium text-primary">{dialog.label ?? dialog.title}<input autoFocus value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} placeholder={dialog.placeholder} className="mt-2 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label> : null}
            {error ? <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => settle(dialog.kind === "confirm" ? false : null)} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "取消" : "Cancel"}</button><button type="submit" autoFocus={dialog.kind === "confirm"} className={`min-h-10 rounded-lg px-4 text-sm font-medium ${dialog.danger ? "bg-[var(--danger)] text-white" : "bg-[var(--text)] text-[var(--surface)]"}`}>{dialog.confirmLabel ?? (zh ? "确认" : "Confirm")}</button></div>
          </form>
        </div>
      ) : null}
    </InteractionDialogContext.Provider>
  );
}

export function useInteractionDialog(): InteractionDialogContextValue {
  const value = useContext(InteractionDialogContext);
  if (!value) throw new Error("useInteractionDialog must be used within InteractionDialogProvider");
  return value;
}
