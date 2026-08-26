"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ProjectSidebar } from "../features/projects/project-sidebar";

type WorkspaceShellContextValue = {
  embedded: boolean;
  openMobileSidebar: () => void;
};

const WorkspaceShellContext = createContext<WorkspaceShellContextValue>({ embedded: false, openMobileSidebar: () => undefined });

export function WorkspaceShellBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [mobileOpenSignal, setMobileOpenSignal] = useState(0);
  const ownerSurface = pathname === "/"
    || pathname === "/archived"
    || pathname === "/recent"
    || pathname === "/search"
    || pathname.startsWith("/conversations/")
    || pathname.startsWith("/projects/");
  const value = useMemo(() => ({ embedded: ownerSurface, openMobileSidebar: () => setMobileOpenSignal((current) => current + 1) }), [ownerSurface]);
  if (!ownerSurface) return <WorkspaceShellContext.Provider value={value}>{children}</WorkspaceShellContext.Provider>;
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const projectId = routeProjectId ?? searchParams?.get("projectId") ?? searchParams?.get("project_id") ?? undefined;
  return (
    <WorkspaceShellContext.Provider value={value}>
      <main className="flex h-screen w-screen overflow-hidden bg-page text-primary">
        <ProjectSidebar currentProjectId={projectId} currentProjectDropTargetId={routeProjectId} mobileOpenSignal={mobileOpenSignal} showMobileTrigger={false} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </main>
    </WorkspaceShellContext.Provider>
  );
}

export function useWorkspaceShell() {
  return useContext(WorkspaceShellContext);
}
