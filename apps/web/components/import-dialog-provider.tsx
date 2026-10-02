"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ImportPanel } from "../features/import/import-panel";
import { useTranslations } from "./preferences-provider";
import { useDialogFocus } from "./use-dialog-focus";
import { useInteractionDialog } from "./interaction-dialog-provider";

type ImportDialogContextValue = {
  openImportDialog: (options?: { repairProfileId?: string; initialMode?: "adaptive" | "archive" }) => void;
  closeImportDialog: () => void;
};

const ImportDialogContext = createContext<ImportDialogContextValue | null>(null);

export function ImportDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { confirm } = useInteractionDialog();
  const [mappingState, setMappingState] = useState({ dirty: false, busy: false });
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [repairProfileId, setRepairProfileId] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<"adaptive" | "archive">("adaptive");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openImportDialog = useCallback((options?: { repairProfileId?: string; initialMode?: "adaptive" | "archive" }) => {
    setRepairProfileId(options?.repairProfileId ?? null);
    setInitialMode(options?.initialMode ?? "adaptive");
    setOpen(true);
  }, []);
  const closeImportDialog = useCallback(() => { setOpen(false); setWorkspaceOpen(false); setRepairProfileId(null); setInitialMode("adaptive"); setMappingState({ dirty: false, busy: false }); }, []);
  const requestClose = useCallback(async () => {
    if (mappingState.busy) return;
    const zh = t("settings") === "设置";
    if (mappingState.dirty && !(await confirm({ title: zh ? "放弃未保存的映射？" : "Discard unsaved mapping?", description: zh ? "字段映射尚未保存，导入会话和原始文件仍会保留。" : "The field mapping has not been saved. The import session and source files will remain available.", confirmLabel: zh ? "放弃更改" : "Discard changes", danger: true }))) return;
    closeImportDialog();
  }, [closeImportDialog, confirm, mappingState, t]);
  useEffect(() => {
    if (!mappingState.dirty && !mappingState.busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [mappingState]);
  useDialogFocus({ open, rootRef, onClose: () => { void requestClose(); } });
  const value = useMemo(() => ({ openImportDialog, closeImportDialog: () => { void requestClose(); } }), [requestClose, openImportDialog]);

  return (
    <ImportDialogContext.Provider value={value}>
      {children}
      {open ? (
        <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-label={t("importData")}>
          <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={() => void requestClose()} />
          <section className={`relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl transition-[max-width,height] sm:rounded-xl ${workspaceOpen ? "sm:h-[min(900px,94vh)] sm:max-w-[min(1480px,96vw)]" : "sm:max-w-2xl"}`}>
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ui bg-raised px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-primary">{t("importData")}</h2>
                <p className="mt-0.5 text-sm text-secondary">{t("serverFileNotice")}</p>
              </div>
              <button type="button" data-testid="import-dialog-close" disabled={mappingState.busy} onClick={() => void requestClose()} className="flex h-11 w-11 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)] disabled:opacity-50" aria-label={t("close")} title={t("close")}><X className="h-4 w-4" aria-hidden="true" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><ImportPanel repairProfileId={repairProfileId} initialMode={initialMode} onImportCommitted={closeImportDialog} onWorkspaceChange={setWorkspaceOpen} onMappingStateChange={setMappingState} /></div>
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
