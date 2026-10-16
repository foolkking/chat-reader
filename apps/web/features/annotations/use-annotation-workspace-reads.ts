"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { ApiRequestError } from "../../lib/api";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import { authenticationGeneration, AUTH_UNAUTHORIZED_EVENT, OFFLINE_ACCESS_LOCKED_EVENT, OfflineAccessError } from "../../lib/offline-access";
import type { AnnotationRead, NotebookRead } from "../../lib/types";

export type AnnotationReadKind = "annotations" | "notebook" | "conflicts";
export type AnnotationReadStatus = "idle" | "loading" | "ready" | "error";
type Scope = { conversationId: string; repository: AnnotationRepository; generation: number };
type Visit = { scope: Scope; open: boolean; sequence: number; scopeKey: number };
type ReadState<T> = { scope: Scope; data: T | null; status: AnnotationReadStatus; unavailable: boolean };
const EMPTY_ANNOTATIONS: AnnotationRead[] = [];
const EMPTY_CONFLICTS: NotebookRead[] = [];

function useOwnedRead<T>(scope: Scope, visit: MutableRefObject<Visit>, read: () => Promise<T>) {
  const [state, setState] = useState<ReadState<T>>({ scope, data: null, status: "idle", unavailable: false });
  const stateRef = useRef(state);
  const change = useCallback((update: (previous: ReadState<T>) => ReadState<T>) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);
  const ownsScope = useCallback(() => mounted.current && visit.current.scope === scope
    && authenticationGeneration() === scope.generation, [scope, visit]);
  const load = useCallback(async () => {
    if (!ownsScope()) return;
    const serial = ++request.current, visitSequence = visit.current.sequence;
    const current = () => ownsScope() && serial === request.current && visitSequence === visit.current.sequence;
    change(previous => ({ scope, data: previous.scope === scope ? previous.data : null, status: "loading", unavailable: false }));
    try {
      const data = await read();
      if (current()) change(() => ({ scope, data, status: "ready", unavailable: false }));
    } catch (error) {
      if (!current()) return;
      const unavailable = error instanceof OfflineAccessError
        || (error instanceof ApiRequestError && [401, 403, 404].includes(error.status));
      change(previous => ({ scope, data: !unavailable && previous.scope === scope ? previous.data : null, status: "error", unavailable }));
    }
  }, [change, ownsScope, read, scope, visit]);
  // A confirmed write retires older reads immediately, even while the panel is
  // closed. Keeping current-scope data here also preserves Reader highlights.
  const publish = useCallback((data: T) => {
    if (!ownsScope()) return;
    request.current += 1;
    change(() => ({ scope, data, status: "ready", unavailable: false }));
  }, [change, ownsScope, scope]);
  const isReady = useCallback(() => ownsScope() && stateRef.current.scope === scope
    && stateRef.current.status === "ready", [ownsScope, scope]);
  const currentData = useCallback(() => ownsScope() && stateRef.current.scope === scope ? stateRef.current.data : null, [ownsScope, scope]);
  const updateData = useCallback((update: (data: T) => T) => {
    if (!ownsScope()) return;
    request.current += 1;
    change(previous => previous.scope === scope && previous.data !== null
      ? { scope, data: update(previous.data), status: "ready", unavailable: false } : previous);
  }, [change, ownsScope, scope]);
  return {
    data: state.scope === scope ? state.data : null,
    status: state.scope === scope ? state.status : "idle" as AnnotationReadStatus,
    unavailable: state.scope === scope && state.unavailable,
    load, publish, isReady, ownsScope, currentData, updateData,
  };
}

export function useAnnotationWorkspaceReads(conversationId: string, repository: AnnotationRepository, open: boolean) {
  const [, refreshAuthorization] = useState(0);
  const generation = authenticationGeneration();
  const scope = useMemo(() => ({ conversationId, repository, generation }), [conversationId, repository, generation]);
  const visit = useRef<Visit>({ scope, open, sequence: 0, scopeKey: 0 });
  // Live ownership also rejects completions between a new render and passive
  // effects. Closing invalidates pending reads without clearing valid data.
  if (visit.current.scope !== scope || visit.current.open !== open) {
    visit.current = { scope, open, sequence: visit.current.sequence + 1,
      scopeKey: visit.current.scopeKey + Number(visit.current.scope !== scope) };
  }
  useEffect(() => {
    const update = () => refreshAuthorization(value => value + 1);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, update);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, update);
    return () => {
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, update);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, update);
    };
  }, []);
  const readers = useMemo(() => ({
    annotations: () => scope.repository.list(scope.conversationId),
    notebook: () => scope.repository.getNotebook(scope.conversationId),
    conflicts: () => scope.repository.listNotebookConflicts(scope.conversationId),
  }), [scope]);
  const annotations = useOwnedRead(scope, visit, readers.annotations);
  const notebook = useOwnedRead(scope, visit, readers.notebook);
  const conflicts = useOwnedRead(scope, visit, readers.conflicts);
  const { load: loadAnnotations } = annotations, { load: loadNotebook } = notebook, { load: loadConflicts } = conflicts;
  const { isReady: notebookIsReady } = notebook, { isReady: conflictsAreReady } = conflicts;
  const canUseNotebook = useCallback(() => notebookIsReady() && conflictsAreReady(), [notebookIsReady, conflictsAreReady]);
  const reload = useCallback(async (kind?: AnnotationReadKind) => {
    await Promise.allSettled([
      ...(!kind || kind === "annotations" ? [loadAnnotations()] : []),
      ...(!kind || kind === "notebook" ? [loadNotebook()] : []),
      ...(!kind || kind === "conflicts" ? [loadConflicts()] : []),
    ]);
  }, [loadAnnotations, loadNotebook, loadConflicts]);
  return {
    annotations: annotations.data ?? EMPTY_ANNOTATIONS,
    notebook: notebook.data,
    conflicts: conflicts.data ?? EMPTY_CONFLICTS,
    reads: { annotations, notebook, conflicts },
    notebookReady: notebook.status === "ready" && conflicts.status === "ready",
    scopeKey: visit.current.scopeKey,
    reload,
    publishNotebook: notebook.publish,
    canUseNotebook,
    isCurrent: annotations.ownsScope,
    currentAnnotations: annotations.currentData,
    updateAnnotations: annotations.updateData,
  };
}
