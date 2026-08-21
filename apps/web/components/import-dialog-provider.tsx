"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ImportPanel } from "../features/import/import-panel";
import { useTranslations } from "./preferences-provider";
import { useDialogFocus } from "./use-dialog-focus";

type ImportDialogContextValue = {
  openImportDialog: (options?: { repairProfileId?: string }) => void;
  closeImportDialog: () => void;
};

const ImportDialogContext = createContext<ImportDialogContextValue | null>(null);

export function ImportDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [repairProfileId, setRepairProfileId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openImportDialog = useCallback((options?: { repairProfileId?: string }) => { setRepairProfileId(options?.repairProfileId ?? null); setOpen(true); }, []);
  const closeImportDialog = useCallback(() => { setOpen(false); setWorkspaceOpen(false); setRepairProfileId(null); }, []);
  useDialogFocus({ open, rootRef, onClose: closeImportDialog });
  const value = useMemo(() => ({ openImportDialog, closeImportDialog }), [closeImportDialog, openImportDialog]);

  return (
    <ImportDialogContext.Provider value={value}>
      {children}
      {open ? (
        <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--overlay)] outline-none sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-label={t("importData")}>
          <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={closeImportDialog} />
          <section className={`relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl transition-[max-width,height] sm:rounded-xl ${workspaceOpen ? "sm:h-[min(900px,94vh)] sm:max-w-[min(1480px,96vw)]" : "sm:max-w-2xl"}`}>
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ui bg-raised px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-primary">{t("importData")}</h2>
                <p className="mt-0.5 text-sm text-secondary">{t("serverFileNotice")}</p>
              </div>
              <button type="button" data-testid="import-dialog-close" onClick={closeImportDialog} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label={t("close")} title={t("close")}><X className="h-4 w-4" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><ImportPanel repairProfileId={repairProfileId} onImportCommitted={closeImportDialog} onWorkspaceChange={setWorkspaceOpen} /></div>
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
