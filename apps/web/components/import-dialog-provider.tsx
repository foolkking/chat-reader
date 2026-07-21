"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ImportPanel } from "../features/import/import-panel";
import { useTranslations } from "./preferences-provider";

type ImportDialogContextValue = {
  openImportDialog: () => void;
  closeImportDialog: () => void;
};

const ImportDialogContext = createContext<ImportDialogContextValue | null>(null);

export function ImportDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const openImportDialog = useCallback(() => setOpen(true), []);
  const closeImportDialog = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ openImportDialog, closeImportDialog }), [closeImportDialog, openImportDialog]);

  return (
    <ImportDialogContext.Provider value={value}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-[2vw]" role="dialog" aria-modal="true" aria-label={t("importData")}>
          <button type="button" aria-label={t("close")} className="absolute inset-0" onClick={closeImportDialog} />
          <section className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-ui bg-raised shadow-2xl sm:max-w-2xl sm:rounded-xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ui bg-raised px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-primary">{t("importData")}</h2>
                <p className="mt-0.5 text-sm text-secondary">{t("serverFileNotice")}</p>
              </div>
              <button type="button" data-testid="import-dialog-close" onClick={closeImportDialog} className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" aria-label={t("close")} title={t("close")}>
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5"><ImportPanel /></div>
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
