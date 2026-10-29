"use client";

import type { ReactNode } from "react";
import { MobileSidebarTrigger } from "../features/projects/project-sidebar";

export function MobilePageHeader({
  title,
  description,
  onOpenSidebar,
  actions,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  onOpenSidebar: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-testid="mobile-page-header"
      className={`sticky top-0 z-40 isolate flex min-h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-3 border-b border-ui px-4 pt-[env(safe-area-inset-top)] md:px-[2vw] ${className}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-surface/95 backdrop-blur" />
      <MobileSidebarTrigger onOpen={onOpenSidebar} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {description ? <p className="truncate text-xs text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
