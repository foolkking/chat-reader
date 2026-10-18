"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ImportPanel } from "../features/import/import-panel";
import { useTranslations } from "./preferences-provider";
import { useDialogFocus } from "./use-dialog-focus";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../lib/offline-access";

type ImportDialogContextValue = {
  openImportDialog: (options?: {
    repairProfileId?: string;
    initialMode?: "adaptive" | "archive";
    resumeImportId?: string;
    projectId?: string | null;
    initialFiles?: File[];
  }) => void;
  closeImportDialog: () => void;
};

const ImportDialogContext = createContext<ImportDialogContextValue | null>(null);

export function ImportDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const zh = t("settings") === "设置";
  const { confirm } = useInteractionDialog();
  const [mappingState, setMappingState] = useState({ dirty: false, busy: false });
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [repairProfileId, setRepairProfileId] = useState<string | null>(null);
  const [resumeImportId, setResumeImportId] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<"adaptive" | "archive">("adaptive");
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [initialFiles, setInitialFiles] = useState<File[]>([]);
  const [dialogVersion, setDialogVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const mappingRef = useRef(mappingState);
  mappingRef.current = mappingState;
  const transition = useRef(0);
  const mounted = useRef(true);
  const canLeaveMapping = useCallback(async () => {
    const state = mappingRef.current;
    if (state.busy) return false;
    const operation = ++transition.current;
    const generation = authenticationGeneration();
    const zh = t("settings") === "设置";
    if (state.dirty && !(await confirm({ title: zh ? "放弃未保存的映射？" : "Discard unsaved mapping?", description: zh ? "字段映射尚未保存，导入会话和原始文件仍会保留。" : "The field mapping has not been saved. The import session and source files will remain available.", confirmLabel: zh ? "放弃更改" : "Discard changes", danger: true }))) return false;
    return mounted.current && operation === transition.current && generation === authenticationGeneration()
      && mappingRef.current === state && !mappingRef.current.busy;
  }, [confirm, t]);
  const openImportDialog = useCallback((options?: {
    repairProfileId?: string;
    initialMode?: "adaptive" | "archive";
    resumeImportId?: string;
    projectId?: string | null;
    initialFiles?: File[];
  }) => {
    void (async () => {
      if (!(await canLeaveMapping())) return;
      setRepairProfileId(options?.repairProfileId ?? null);
      setResumeImportId(options?.resumeImportId ?? null);
      setInitialMode(options?.initialMode ?? "adaptive");
      setTargetProjectId(options?.projectId ?? null);
      setInitialFiles(options?.initialFiles ?? []);
      setMappingState({ dirty: false, busy: false });
      setDialogVersion(version => version + 1);
      setOpen(true);
    })();
  }, [canLeaveMapping]);
  const closeImportDialog = useCallback(() => { transition.current++; setOpen(false); setWorkspaceOpen(false); setRepairProfileId(null); setResumeImportId(null); setInitialMode("adaptive"); setTargetProjectId(null); setInitialFiles([]); setMappingState({ dirty: false, busy: false }); }, []);
  const requestClose = useCallback(async () => {
    if (!(await canLeaveMapping())) return;
    closeImportDialog();
  }, [canLeaveMapping, closeImportDialog]);
  useEffect(() => {
    mounted.current = true;
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, closeImportDialog);
    return () => {
      mounted.current = false;
      transition.current++;
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, closeImportDialog);
    };
  }, [closeImportDialog]);
  useEffect(() => {
    if (!mappingState.dirty && !mappingState.busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [mappingState]);
  useDialogFocus({ open, rootRef, initialFocusRef: closeButtonRef, onClose: () => { void requestClose(); } });
  const value = useMemo(() => ({ openImportDialog, closeImportDialog: () => { void requestClose(); } }), [requestClose, openImportDialog]);

  return (
    <ImportDialogContext.Provider value={value}>
      {children}
      {open ? (
        <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-label={initialMode === "archive" ? (zh ? "恢复对话归档" : "Restore conversation archive") : t("importData")}>
          <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => void requestClose()} />
          <section className={`relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl transition-[max-width,height] sm:rounded-xl ${workspaceOpen ? "sm:h-[min(900px,94vh)] sm:max-w-[min(1480px,96vw)]" : "sm:max-w-2xl"}`}>
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ui bg-raised px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-primary">{initialMode === "archive" ? (zh ? "恢复对话归档" : "Restore conversation archive") : t("importData")}</h2>
              </div>
              <button ref={closeButtonRef} type="button" data-testid="import-dialog-close" disabled={mappingState.busy} onClick={() => void requestClose()} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-50" aria-label={t("close")} title={t("close")}><X className="h-4 w-4" aria-hidden="true" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><ImportPanel key={`${dialogVersion}:${repairProfileId ?? ""}:${resumeImportId ?? ""}`} repairProfileId={repairProfileId} resumeImportId={resumeImportId} initialMode={initialMode} initialFiles={initialFiles} targetProjectId={targetProjectId} onImportCommitted={closeImportDialog} onWorkspaceChange={setWorkspaceOpen} onMappingStateChange={setMappingState} /></div>
          </section>
        </div>
      ) : null}
    </ImportDialogContext.Provider>
  );
}

export function useImportDialog(): ImportDialogContextValue {
  const value = useContext(ImportDialogContext);
  if (!value) throw new Error("useImportDialog must be used within ImportDialogProvider");
  return value;
}
