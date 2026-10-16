"use client";

import { AlertTriangle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authenticationGeneration, AUTH_UNAUTHORIZED_EVENT, OFFLINE_ACCESS_LOCKED_EVENT } from "../lib/offline-access";
import { usePreferences } from "./preferences-provider";
import { useDialogFocus } from "./use-dialog-focus";

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

type DialogScope = { pathname: string; epoch: number; visit: number };
type DialogView = (({ kind: "confirm" } & ConfirmOptions) | ({ kind: "prompt" } & PromptOptions)) & { scope: DialogScope };
type DialogState = DialogView | null;
type DialogResult = boolean | string | null;
type PendingDialog = { view: DialogView; complete: (result: DialogResult) => void };
const cancelled = (view: DialogView): DialogResult => view.kind === "confirm" ? false : null;

type InteractionDialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const InteractionDialogContext = createContext<InteractionDialogContextValue | null>(null);

export function InteractionDialogProvider({ children }: { children: React.ReactNode }) {
  const { resolvedLocale } = usePreferences();
  const pathname = usePathname() ?? "/";
  const epoch = authenticationGeneration();
  const scopeRef = useRef<DialogScope>({ pathname, epoch, visit: 0 });
  if (scopeRef.current.pathname !== pathname || scopeRef.current.epoch !== epoch) {
    scopeRef.current = { pathname, epoch, visit: scopeRef.current.visit + 1 };
  }
  const scope = scopeRef.current;
  const mounted = useRef(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLInputElement | null>(null);
  const zh = resolvedLocale === "zh-CN";

  const isCurrent = useCallback((view: DialogView) => mounted.current && pendingRef.current?.view === view
    && view.scope === scopeRef.current && view.scope.epoch === authenticationGeneration(), []);

  const cancelPending = useCallback((updateView = true) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (updateView && mounted.current) { setDialog(null); setValue(""); setError(null); }
    pending.complete(cancelled(pending.view));
  }, []);

  const settle = useCallback((view: DialogView, result: DialogResult) => {
    const pending = pendingRef.current;
    if (pending?.view !== view) return;
    const decision = isCurrent(view) ? result : cancelled(view);
    // Release ownership before resolving, so a subsequent request cannot be
    // erased by the old callback's cleanup.
    pendingRef.current = null;
    if (mounted.current) { setDialog(null); setValue(""); setError(null); }
    pending.complete(decision);
  }, [isCurrent]);

  const begin = useCallback((view: DialogView, complete: PendingDialog["complete"]) => {
    if (!mounted.current || view.scope !== scopeRef.current || view.scope.epoch !== authenticationGeneration()) {
      complete(cancelled(view));
      return;
    }
    const pending = pendingRef.current;
    if (pending && isCurrent(pending.view)) {
      // Keep the visible decision and its draft. Do not overwrite its resolver,
      // or queue another destructive decision for later.
      complete(cancelled(view));
      return;
    }
    cancelPending();
    pendingRef.current = { view, complete };
    setValue(view.kind === "prompt" ? view.initialValue ?? "" : "");
    setError(null);
    setDialog(view);
  }, [cancelPending, isCurrent]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    begin({ ...options, kind: "confirm", scope }, result => resolve(result === true));
  }), [begin, scope]);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    begin({ ...options, kind: "prompt", scope }, result => resolve(typeof result === "string" ? result : null));
  }), [begin, scope]);

  useEffect(() => {
    mounted.current = true;
    const retire = () => cancelPending();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, retire);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    return () => {
      mounted.current = false;
      cancelPending(false);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, retire);
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    };
  }, [cancelPending]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && !isCurrent(pending.view)) cancelPending();
  }, [scope, isCurrent, cancelPending]);

  // Hide retired decisions during render, before passive cancellation runs.
  const view = dialog && isCurrent(dialog) ? dialog : null;

  useDialogFocus({
    open: Boolean(view),
    rootRef: dialogRef,
    onClose: () => { if (view) settle(view, cancelled(view)); },
    initialFocusRef: view?.kind === "prompt" ? promptRef : undefined,
  });

  const context = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  return (
    <InteractionDialogContext.Provider value={context}>
      {children}
      {view ? (
        <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[400] flex items-end justify-center bg-[var(--overlay)] p-0 outline-none sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-labelledby="interaction-dialog-title">
          <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => settle(view, cancelled(view))} />
          <form className="relative w-full rounded-t-2xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-md sm:rounded-xl" onSubmit={(event) => {
            event.preventDefault();
            if (!isCurrent(view)) { settle(view, cancelled(view)); return; }
            if (view.kind === "prompt") {
              const trimmed = value.trim();
              if (!trimmed) { setError(zh ? "\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a\u3002" : "This field cannot be empty."); return; }
              settle(view, trimmed);
            } else settle(view, true);
          }}>
            <div className="flex items-start gap-3">
              {view.danger ? <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]"><AlertTriangle className="h-4 w-4" /></span> : null}
              <div className="min-w-0 flex-1"><h2 id="interaction-dialog-title" className="text-base font-semibold text-primary">{view.title}</h2>{view.description ? <p className="mt-1 text-sm leading-6 text-secondary">{view.description}</p> : null}</div>
              <button type="button" onClick={() => settle(view, cancelled(view))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "\u5173\u95ed" : "Close"} title={zh ? "\u5173\u95ed" : "Close"}><X className="h-4 w-4" /></button>
            </div>
            {view.kind === "prompt" ? <label className="mt-4 block text-sm font-medium text-primary">{view.label ?? view.title}<input ref={promptRef} value={value} onChange={(event) => { if (isCurrent(view)) { setValue(event.target.value); setError(null); } }} placeholder={view.placeholder} className="mt-2 h-11 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label> : null}
            {error ? <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => settle(view, cancelled(view))} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "\u53d6\u6d88" : "Cancel"}</button><button type="submit" className={`min-h-10 rounded-lg px-4 text-sm font-medium ${view.danger ? "bg-[var(--danger)] text-white" : "bg-[var(--text)] text-[var(--surface)]"}`}>{view.confirmLabel ?? (zh ? "\u786e\u8ba4" : "Confirm")}</button></div>
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
