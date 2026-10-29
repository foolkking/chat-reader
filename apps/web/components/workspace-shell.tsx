"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { releaseExportRoute } from "../lib/export-usage";
import { ProjectSidebar } from "../features/projects/project-sidebar";
import { useImportDialog } from "./import-dialog-provider";
import { useTranslations } from "./preferences-provider";

type WorkspaceShellContextValue = {
  embedded: boolean;
  openMobileSidebar: () => void;
  setReaderProjectContext: (conversationId: string, projectId: string | null | undefined) => void;
};

const WorkspaceShellContext = createContext<WorkspaceShellContextValue>({
  embedded: false,
  openMobileSidebar: () => undefined,
  setReaderProjectContext: () => undefined,
});

export function WorkspaceShellBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const { openImportDialog } = useImportDialog();
  const t = useTranslations();
  const [fileDropActive, setFileDropActive] = useState(false);
  const [dropOverImportTarget, setDropOverImportTarget] = useState(false);
  const [readerProjectContext, setReaderProjectContext] = useState<{ conversationId: string; projectId: string | null } | null>(null);
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const projectId = routeProjectId ?? searchParams?.get("projectId") ?? searchParams?.get("project_id") ?? undefined;
  const routeConversationId = pathname.match(/^\/conversations\/([^/]+)/)?.[1];
  const importProjectId = projectId ?? (
    routeConversationId && readerProjectContext?.conversationId === routeConversationId
      ? readerProjectContext.projectId ?? undefined
      : undefined
  );
  const isChinese = t("settings") === "设置";
  const hasDroppedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");
  const isInsideDialog = (event: DragEvent<HTMLElement>) =>
    event.target instanceof Element && Boolean(event.target.closest('[role="dialog"]'));
  const isLocalFileDrop = (event: DragEvent<HTMLElement>) =>
    event.target instanceof Element && Boolean(event.target.closest('[data-local-file-drop-target="true"]'));
  const setDropTarget = (event: DragEvent<HTMLElement>) => {
    setDropOverImportTarget(
      event.target instanceof Element && Boolean(event.target.closest('[data-workspace-import-drop-target="true"]')),
    );
  };
  const handleFileDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event) || isInsideDialog(event)) return;
    if (isLocalFileDrop(event)) {
      setFileDropActive(false);
      setDropOverImportTarget(false);
      return;
    }
    event.preventDefault();
    setFileDropActive(true);
    setDropTarget(event);
  };
  const handleFileDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event) || isInsideDialog(event)) return;
    if (isLocalFileDrop(event)) {
      setFileDropActive(false);
      setDropOverImportTarget(false);
      return;
    }
    event.preventDefault();
    setDropTarget(event);
    event.dataTransfer.dropEffect = event.target instanceof Element
      && event.target.closest('[data-workspace-import-drop-target="true"]') ? "copy" : "none";
  };
  const handleFileDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event) || isInsideDialog(event)) return;
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFileDropActive(false);
    setDropOverImportTarget(false);
  };
  const handleFileDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDroppedFiles(event) || isInsideDialog(event) || isLocalFileDrop(event)) {
      setFileDropActive(false);
      setDropOverImportTarget(false);
      return;
    }
    event.preventDefault();
    setFileDropActive(false);
    setDropOverImportTarget(false);
    const acceptsImport = event.target instanceof Element
      && Boolean(event.target.closest('[data-workspace-import-drop-target="true"]'));
    if (!acceptsImport) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const archive = files.length === 1 && /\.cr$/i.test(files[0]?.name ?? "");
    openImportDialog({
      projectId: importProjectId ?? null,
      initialFiles: files,
      initialMode: archive ? "archive" : "adaptive",
    });
  };
  const setReaderProjectContextForRoute = useCallback((conversationId: string, nextProjectId: string | null | undefined) => {
    if (routeConversationId !== conversationId) return;
    setReaderProjectContext(nextProjectId === undefined ? null : { conversationId, projectId: nextProjectId });
  }, [routeConversationId]);
  useEffect(() => {
    if (!routeConversationId) setReaderProjectContext(null);
  }, [routeConversationId]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) releaseExportRoute(previousPath.current);
    previousPath.current = pathname;
  }, [pathname]);
  const [mobileOpenSignal, setMobileOpenSignal] = useState(0);
  const ownerSurface = pathname === "/"
    || pathname === "/archived"
    || pathname === "/recent"
    || pathname === "/reading-list"
    || pathname === "/annotations"
    || pathname === "/files"
    || pathname === "/duplicates"
    || pathname === "/search"
    || pathname.startsWith("/conversations/")
    || pathname.startsWith("/projects/");
  const value = useMemo(() => ({
    embedded: ownerSurface,
    openMobileSidebar: () => setMobileOpenSignal((current) => current + 1),
    setReaderProjectContext: setReaderProjectContextForRoute,
  }), [ownerSurface, setReaderProjectContextForRoute]);
  if (!ownerSurface) return <WorkspaceShellContext.Provider value={value}>{children}</WorkspaceShellContext.Provider>;
  return (
    <WorkspaceShellContext.Provider value={value}>
      <main
        className="relative flex h-screen w-screen overflow-hidden bg-page text-primary"
        data-file-drag-active={fileDropActive ? "true" : undefined}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        <ProjectSidebar
          currentProjectId={projectId}
          currentProjectDropTargetId={routeProjectId}
          mobileOpenSignal={mobileOpenSignal}
          showMobileTrigger={false}
          onImportClick={() => openImportDialog({ projectId: importProjectId ?? null })}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {fileDropActive ? (
          <div aria-hidden="true" data-testid="workspace-file-drop-overlay" className="workspace-file-drop-overlay fixed inset-0 z-[80] grid place-items-center p-4">
            <div data-testid="workspace-import-drop-target" data-workspace-import-drop-target="true" className={`workspace-import-drop-target pointer-events-auto max-w-md border border-dashed bg-raised px-6 py-5 text-center shadow-2xl ${dropOverImportTarget ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui"}`}>
              <p className="text-sm font-semibold text-primary">
                {dropOverImportTarget
                  ? (isChinese ? "松开以打开导入" : "Drop to open import")
                  : (isChinese ? "拖到这里导入" : "Drop here to import")}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {importProjectId
                  ? (isChinese ? "导入位置：当前项目" : "Import destination: current project")
                  : (isChinese ? "导入位置：未归类" : "Import destination: unclassified")}
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </WorkspaceShellContext.Provider>
  );
}

export function useWorkspaceShell() {
  return useContext(WorkspaceShellContext);
}
