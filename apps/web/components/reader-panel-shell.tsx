"use client";

import { X } from "lucide-react";

export function ReaderPanelShell({
  title,
  description,
  closeLabel,
  onClose,
  children,
  compact = false,
}: {
  title: string;
  description?: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-raised text-primary" aria-label={title}>
      <header className={`flex shrink-0 items-start gap-3 border-b border-ui ${compact ? "px-1 pb-3" : "px-5 py-4"}`}>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-5 text-secondary">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary transition hover:bg-subtle hover:text-primary focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className={`reader-aux-scroll min-h-0 flex-1 overflow-y-auto ${compact ? "pt-3" : "p-5"}`}>
        {children}
      </div>
    </section>
  );
}
