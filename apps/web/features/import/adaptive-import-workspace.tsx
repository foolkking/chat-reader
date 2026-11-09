"use client";

import { importErrorMessage, useImportCopy, type ImportCopy, type ImportErrorAction } from "./import-workspace-copy";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  FileUp,
  FolderCog,
  Layers3,
  LoaderCircle,
  Save,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  excludeAdaptiveImportGroup,
  getAdaptiveImportArchive,
  reanalyzeAdaptiveImportSession,
  rebuildAdaptiveImportPreview,
  getAdaptiveImportSession,
  replaceAdaptiveImportArtifact,
  resolveAdaptiveImportGroups,
  selectAdaptiveFamilyProfile,
  updateAdaptiveImportArchive,
} from "../../lib/api";
import type {
  AdaptiveArchiveCatalog,
  AdaptiveArchiveMember,
  AdaptiveArchiveSummary,
  AdaptiveImportDiagnostic,
  AdaptiveImportFamily,
  AdaptiveImportGroup,
  AdaptiveImportSession,
} from "../../lib/types";
import { FormatConversionDialog } from "./format-conversion-guide";
import { MappingWorkspace } from "./mapping-workspace";
import { FormatHealthCheck } from "./format-health-check";

type SessionActionControls = {
  begin: () => number | null;
  apply: (token: number, session: AdaptiveImportSession) => boolean;
  finish: (token: number) => void;
  background?: (token: number) => void;
};

type ImportEditState = { dirty: boolean; busy: boolean; background?: boolean };

function useAdaptiveSessionAction<TVariables>(
  mutationFn: (variables: TVariables) => Promise<AdaptiveImportSession>,
  controls: SessionActionControls,
  onApplied?: (session: AdaptiveImportSession) => void,
) {
  const mutation = useMutation({ mutationFn });
  const run = (variables: TVariables) => {
    const token = controls.begin();
    if (token === null) return;
    void mutation.mutateAsync(variables)
      .then((next) => {
        if (controls.apply(token, next)) onApplied?.(next);
      })
      .catch(() => undefined)
      .finally(() => controls.finish(token));
  };
  return { ...mutation, run };
}

export function AdaptiveImportWorkspace({ session, onSession, onBack, onImport, importing, error, onRetryImport, retryingImport = false, statusError, onRetryStatus, statusRetrying = false, onMappingStateChange }: {
  onMappingStateChange?: (state: ImportEditState) => void;
  session: AdaptiveImportSession;
  onSession: (session: AdaptiveImportSession) => void;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
  error: unknown;
  onRetryImport?: () => void;
  retryingImport?: boolean;
  statusError?: unknown;
  onRetryStatus?: () => void;
  statusRetrying?: boolean;
}) {
  const tr = useImportCopy();
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [sessionActionBackground, setSessionActionBackground] = useState(false);
  const [mappingState, setMappingState] = useState<ImportEditState>({ dirty: false, busy: false });
  const [archiveStates, setArchiveStates] = useState<Record<string, ImportEditState>>({});
  const onArchiveStateChange = useCallback((artifactId: string, state: ImportEditState) => {
    setArchiveStates(current => {
      if (current[artifactId]?.dirty === state.dirty && current[artifactId]?.busy === state.busy) return current;
      return { ...current, [artifactId]: state };
    });
  }, []);
  const archiveDirty = session.archives?.some(archive => archiveStates[archive.artifact_id]?.dirty) ?? false;
  const archiveBusy = session.archives?.some(archive => archiveStates[archive.artifact_id]?.busy) ?? false;
  const overviewActionBusy = sessionActionBusy || importing || archiveDirty || archiveBusy;
  useEffect(() => {
    onMappingStateChange?.({ dirty: mappingState.dirty || archiveDirty, busy: mappingState.busy || archiveBusy || sessionActionBusy,
      background: sessionActionBackground && !archiveBusy && !importing });
  }, [archiveBusy, archiveDirty, importing, mappingState, onMappingStateChange, sessionActionBackground, sessionActionBusy]);
  useEffect(() => () => { onMappingStateChange?.({ dirty: false, busy: false }); }, [onMappingStateChange]);
  const sessionActionRef = useRef<{ nextToken: number; activeToken: number | null }>({ nextToken: 0, activeToken: null });
  const currentImportIdRef = useRef(session.import_id);
  currentImportIdRef.current = session.import_id;
  const beginSessionAction = useCallback(() => {
    if (sessionActionRef.current.activeToken !== null) return null;
    const token = sessionActionRef.current.nextToken + 1;
    sessionActionRef.current = { nextToken: token, activeToken: token };
    setSessionActionBusy(true);
    setSessionActionBackground(false);
    return token;
  }, []);
  const applySessionAction = useCallback((token: number, next: AdaptiveImportSession) => {
    if (sessionActionRef.current.activeToken !== token || next.import_id !== currentImportIdRef.current) return false;
    onSession(next);
    return true;
  }, [onSession]);
  const finishSessionAction = useCallback((token: number) => {
    if (sessionActionRef.current.activeToken !== token) return;
    sessionActionRef.current.activeToken = null;
    setSessionActionBusy(false);
    setSessionActionBackground(false);
  }, []);
  const backgroundSessionAction = useCallback((token: number) => {
    if (sessionActionRef.current.activeToken === token) setSessionActionBackground(true);
  }, []);
  const sessionActions = useMemo<SessionActionControls>(() => ({
    begin: beginSessionAction,
    apply: applySessionAction,
    finish: finishSessionAction,
    background: backgroundSessionAction,
  }), [applySessionAction, backgroundSessionAction, beginSessionAction, finishSessionAction]);
  const rebuildPreview = useAdaptiveSessionAction(
    () => rebuildAdaptiveImportPreview(session.import_id, session.updated_at!), sessionActions);
  const refreshSession = useAdaptiveSessionAction(() => getAdaptiveImportSession(session.import_id), sessionActions);
  const activeFamily = session.families.find((family) => family.id === activeFamilyId) ?? null;
  const supportedFamilies = session.families.filter((family) => family.handling_class === "SUPPORTED");
  const mappableFamilies = session.families.filter((family) => family.handling_class === "MAPPABLE");
  const notMappableFamilies = session.families.filter((family) => family.handling_class === "NOT_MAPPABLE");
  const supportedCount = supportedFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const mappableCount = mappableFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const notMappableCount = notMappableFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const invalidCount = notMappableCount;
  const pendingCount = mappableCount + notMappableCount;

  if (activeFamily) {
    return (
      <MappingWorkspace
        onMappingStateChange={setMappingState}
        session={session}
        family={activeFamily}
        sessionAction={sessionActions}
        sessionActionBusy={sessionActionBusy}
        onBack={() => setActiveFamilyId(null)}
      />
    );
  }
  if (session.state === "NEEDS_GROUPING" || groupingOpen) {
    return (
      <GroupResolver
        session={session}
        sessionAction={sessionActions}
        sessionActionBusy={sessionActionBusy}
        forced={session.state === "NEEDS_GROUPING"}
        onClose={session.state === "NEEDS_GROUPING" ? onBack : () => setGroupingOpen(false)}
        onResolved={() => {
          setGroupingOpen(false);
        }}
      />
    );
  }
  return (
    <section className="space-y-5" aria-labelledby="adaptive-import-title">
      {session.source_status === "missing" || (session.state === "READY" && session.draft_status !== undefined && session.draft_status !== "ready") ? <div role="status" className="space-y-2 border-b border-ui pb-3 text-sm text-secondary">
        <p>{tr(session.source_status === "missing" ? "源文件不可用，已保存的配置仍可查看。请选择原文件后继续处理。" : "原文件仍保留，导入预览已过期或缺失。重新生成预览会保留分组和映射，不会提交导入。")}</p>
        {session.allowed_actions?.includes("rebuild_preview") && session.updated_at ? <button type="button" disabled={overviewActionBusy} className="btn-secondary min-h-11 px-3" onClick={() => rebuildPreview.run(undefined)}>{tr("重新生成预览")}</button> : null}
        <button type="button" disabled={overviewActionBusy} className="btn-secondary min-h-11 px-3" onClick={() => refreshSession.run(undefined)}>{tr("刷新会话状态")}</button>
        {rebuildPreview.error ? <ErrorLine message={rebuildPreview.error} action="mutation" /> : null}
        {refreshSession.error ? <ErrorLine message={refreshSession.error} /> : null}
      </div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ui pb-4">
        <div>
          <button type="button" disabled={overviewActionBusy} onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
            <ArrowLeft className="h-3.5 w-3.5" />{tr("重新选择文件")}</button>
          <h3 id="adaptive-import-title" className="text-lg font-semibold text-primary">{tr("导入概览")}</h3>
          <p className="mt-1 text-sm text-secondary">{tr("发现 {0} 个对话，识别出 {1} 种格式", session.group_count, session.family_count)}</p>
        </div>
        <StateBadge state={session.state} pendingCount={pendingCount} />
      </div>

      {session.state === "BLOCKED" && invalidCount > 0 ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3">
          <div className="flex min-w-0 gap-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-primary">{invalidCount} {tr("个对话需要修复输入")}</p>
              <p className="mt-1 text-xs leading-5 text-secondary">{tr("其他已识别格式仍可继续设置。替换、排除或重新组合这些文件后，系统会自动重新分析。")}</p>
            </div>
          </div>
          <button type="button" disabled={overviewActionBusy} onClick={() => setGroupingOpen(true)} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50">
            <FolderCog className="h-4 w-4" />{tr("调整文件组合")}</button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-y border-ui py-3 text-xs" aria-label={tr("导入格式处理状态")}>
        <StatusSummary icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={tr("已支持")} count={supportedCount} tone="success" />
        <StatusSummary icon={<Settings2 className="h-3.5 w-3.5" />} label={tr("可设置格式")} count={mappableCount} tone="warning" />
        <StatusSummary icon={<ShieldAlert className="h-3.5 w-3.5" />} label={tr("暂不可映射")} count={notMappableCount} tone="danger" />
      </div>
      {archiveDirty ? <p role="status" className="text-sm text-[var(--warning)]">{tr("请先保存或放弃 ZIP 分类选择，再进行其他操作。")}</p> : null}
      {session.archives?.length ? <ArchiveLedger session={session} archives={session.archives} sessionAction={sessionActions} sessionActionBusy={sessionActionBusy || importing} onStateChange={onArchiveStateChange} /> : null}
      <FamilySection title={tr("已支持 · 可直接导入")} families={supportedFamilies} session={session} sessionAction={sessionActions} sessionActionBusy={overviewActionBusy} onConfigure={(id) => setActiveFamilyId(id)} />
      <FamilySection title={tr("可设置格式 · 需要确认一次")} families={mappableFamilies} session={session} sessionAction={sessionActions} sessionActionBusy={overviewActionBusy} onConfigure={(id) => setActiveFamilyId(id)} />
      <FamilySection title={tr("暂不可映射 · 需要先转换")} families={notMappableFamilies} session={session} sessionAction={sessionActions} sessionActionBusy={overviewActionBusy} onConfigure={() => undefined} />

      {session.state === "BLOCKED" ? <LegacyBlockedRecovery session={session} sessionAction={sessionActions} sessionActionBusy={overviewActionBusy} onRegroup={() => setGroupingOpen(true)} /> : null}
      {error ? <ErrorLine message={error} action="commit" onRetry={onRetryImport} retrying={retryingImport} /> : null}
      {statusError ? <ErrorLine message={statusError} onRetry={onRetryStatus} retrying={statusRetrying} /> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ui pt-4">
        <div>
          <p className="text-sm text-secondary">
            {session.state === "READY"
              ? session.can_import ? tr("准备导入 {0} 个对话、{1} 条消息。", session.conversation_count, session.message_count) : tr("请先重新生成预览，再确认导入。")
              : pendingCount
                ? tr("还有 {0} 个对话需要设置或修复。已完成的处理会保留。", pendingCount)
                : tr("正在整理导入计划。")}
          </p>
          {!invalidCount && session.state !== "READY" ? (
            <button type="button" disabled={overviewActionBusy} onClick={() => setGroupingOpen(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
              <FolderCog className="h-3.5 w-3.5" />{tr("调整文件组合")}</button>
          ) : null}
        </div>
        <button type="button" data-testid="commit-import-button" disabled={!session.can_import || overviewActionBusy} onClick={onImport} className="btn-primary min-h-10 px-5 text-sm font-medium">
          {importing ? <><LoaderCircle className="h-4 w-4 animate-spin" />{tr("正在导入")}</> : tr("导入 {0} 个对话", session.conversation_count || session.group_count)}
        </button>
      </footer>
    </section>
  );
}

function StatusSummary({ icon, label, count, tone }: { icon: ReactNode; label: string; count: number; tone: "success" | "warning" | "danger" }) {
  const styles = tone === "success" ? "bg-[var(--accent-soft)] text-accent" : tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold ${styles}`}>{icon}{label} {count}</span>;
}

function ArchiveLedger({
  session,
  archives,
  sessionAction,
  sessionActionBusy,
  onStateChange,
}: {
  session: AdaptiveImportSession;
  archives: AdaptiveArchiveSummary[];
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
  onStateChange: (artifactId: string, state: ImportEditState) => void;
}) {
  const tr = useImportCopy();
  return (
    <section aria-labelledby="adaptive-archive-ledger-title" className="space-y-2">
      <div className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-accent" aria-hidden="true" />
        <h4 id="adaptive-archive-ledger-title" className="text-sm font-semibold text-primary">{tr("ZIP 内容")}</h4>
        <span className="text-xs text-secondary">{tr("可在导入前确认文档、附件和排除项")}</span>
      </div>
      <div className="divide-y divide-ui border-y border-ui">
        {archives.map((archive) => (
          <ArchiveLedgerRow
            key={archive.artifact_id}
            archive={archive}
            session={session}
            sessionAction={sessionAction}
            sessionActionBusy={sessionActionBusy}
            onStateChange={onStateChange}
          />
        ))}
      </div>
    </section>
  );
}

function ArchiveLedgerRow({
  archive,
  session,
  sessionAction,
  sessionActionBusy,
  onStateChange,
}: {
  archive: AdaptiveArchiveSummary;
  session: AdaptiveImportSession;
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
  onStateChange: (artifactId: string, state: ImportEditState) => void;
}) {
  const tr = useImportCopy();
  const [open, setOpen] = useState(false);
  const [draftState, setDraftState] = useState<ArchiveClassificationDraft>({ version: null, members: {} });
  const draft = draftState.members;
  const archiveQuery = useInfiniteQuery({
    queryKey: ["adaptive-import-archive", session.import_id, archive.artifact_id, archive.classification_version],
    initialPageParam: 0,
    enabled: open,
    queryFn: ({ pageParam, signal }) => getAdaptiveImportArchive(session.import_id, archive.artifact_id, pageParam, 500, signal),
    getNextPageParam: (last) => last.has_more ? last.offset + last.limit : undefined,
  });
  const { catalog, mixedVersions } = useMemo(
    () => mergeArchiveCatalogPages(archiveQuery.data?.pages ?? []),
    [archiveQuery.data?.pages],
  );
  const staleDraft = draftState.version !== null && catalog !== null && draftState.version !== catalog.classification_version;
  const dirtyChanges = useMemo(() => {
    if (!catalog) return [];
    return catalog.members.flatMap((member) => {
      const value = draft[member.member_id];
      if (!value || value.use === member.use && sameStringArray(value.ownerDocumentIds, member.owner_document_ids)) return [];
      return [{
        memberId: member.member_id,
        use: value.use,
        ownerDocumentIds: value.ownerDocumentIds,
      }];
    });
  }, [catalog, draft]);
  const saveMutation = useAdaptiveSessionAction(
    (changes: Array<{ memberId: string; use: string; ownerDocumentIds: string[] }>) => updateAdaptiveImportArchive(
      session.import_id,
      archive.artifact_id,
      catalog?.classification_version ?? archive.classification_version,
      changes,
    ),
    sessionAction,
    () => {
      setDraftState({ version: null, members: {} });
      void archiveQuery.refetch();
    },
  );
  const conversationMembers = catalog?.members.filter((member) => (draft[member.member_id]?.use ?? member.use) === "conversation") ?? [];
  const statusTone = archive.blocking_issue_count > 0 ? "text-[var(--danger)]" : archive.issue_count > 0 ? "text-[var(--warning)]" : "text-secondary";
  const dirty = mixedVersions || staleDraft || dirtyChanges.length > 0 || (!catalog && Object.keys(draft).length > 0);
  useEffect(() => {
    onStateChange(archive.artifact_id, { dirty, busy: saveMutation.isPending });
  }, [archive.artifact_id, dirty, onStateChange, saveMutation.isPending]);
  useEffect(() => () => {
    onStateChange(archive.artifact_id, { dirty: false, busy: false });
  }, [archive.artifact_id, onStateChange]);

  return (
    <article className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-primary" title={archive.filename}>{archive.filename}</span>
            <span className="shrink-0 text-xs text-secondary">{formatBytes(archive.byte_size)}</span>
          </span>
          <span className={`mt-1 block text-xs ${statusTone}`}>
            {archive.document_count} {tr("个文档")} · {archive.attachment_count} {tr("个附件")} · {archive.excluded_count} {tr("项排除")}
            {archive.issue_count ? ` · ${archive.issue_count} ${tr("条提示")}` : ""}
          </span>
          {archive.missing_attachment_count ? <span className="mt-1 block text-xs text-[var(--warning)]">
            {tr("缺少 {0} 个附件，正文仍可导入；缺失引用将保留。", archive.missing_attachment_count ?? 0)}
          </span> : null}
        </button>
        <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setOpen((value) => !value)} aria-label={tr("查看 ZIP 内容")}>
          {open ? tr("收起内容") : tr("查看内容")}
        </button>
      </div>
      {dirty ? <p className="mt-2 text-xs text-[var(--warning)]">{tr("ZIP 分类尚未保存")}</p> : null}
      {open ? (
        <div className="mt-3 space-y-3 border-l-2 border-ui pl-3">
          {archiveQuery.isPending ? <p role="status" className="text-xs text-secondary">{tr("正在读取 ZIP 内容…")}</p> : null}
          {archiveQuery.isError ? <ErrorLine message={archiveQuery.error} action="mutation" onRetry={() => { void archiveQuery.refetch(); }} retrying={archiveQuery.isFetching} /> : null}
          {catalog ? (
            <>
              {mixedVersions || staleDraft ? <div role="alert" className="space-y-2 text-xs text-[var(--warning)]">
                <p>{tr("ZIP 内容已变化，未保存的选择已保留。请重新读取并核对后再保存。")}</p>
                <button type="button" className="min-h-9 underline" disabled={archiveQuery.isFetching} onClick={() => { void archiveQuery.refetch(); }}>{tr("重新读取 ZIP 内容")}</button>
                {staleDraft ? <button type="button" className="ml-3 min-h-9 underline" onClick={() => setDraftState({ version: null, members: {} })}>{tr("放弃旧选择，使用最新分类")}</button> : null}
              </div> : null}
              {catalog.issues.length ? <div className="space-y-1 border-l-2 border-[var(--warning)] pl-3 text-xs text-secondary">
                {catalog.issues.map((issue) => <p key={`${issue.code}-${issue.message}`}><strong className="text-primary">{issue.code}</strong> · {issue.message}</p>)}
              </div> : null}
              <div className="divide-y divide-ui border-y border-ui">
                {catalog.members.map((member) => (
                  <ArchiveMemberRow
                    key={member.member_id}
                    member={member}
                    draft={draft[member.member_id] ?? { use: member.use, ownerDocumentIds: member.owner_document_ids }}
                    conversationMembers={conversationMembers}
                    disabled={sessionActionBusy || saveMutation.isPending || mixedVersions || staleDraft}
                    onChange={(value) => setDraftState((current) => editArchiveClassificationDraft(current, catalog.classification_version, member.member_id, value))}
                  />
                ))}
              </div>
              {catalog.has_more && !mixedVersions ? (
                <button type="button" className="text-xs font-medium text-accent underline" disabled={archiveQuery.isFetchingNextPage} onClick={() => { void archiveQuery.fetchNextPage(); }}>
                  {archiveQuery.isFetchingNextPage ? tr("正在读取…") : tr("读取其余 {0} 项", catalog.member_count - catalog.members.length)}
                </button>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-secondary">{tr("只保存发生变化的分类；资源文件仍从原 ZIP 安全读取。")}</p>
                {!staleDraft && Object.keys(draft).length > 0 ? <button type="button" className="min-h-9 text-xs underline" disabled={sessionActionBusy || saveMutation.isPending} onClick={() => setDraftState({ version: null, members: {} })}>{tr("放弃 ZIP 分类选择")}</button> : null}
                <button
                  type="button"
                  className="btn-primary inline-flex min-h-9 items-center gap-2 px-3 text-xs"
                  disabled={!dirtyChanges.length || sessionActionBusy || saveMutation.isPending || mixedVersions || staleDraft}
                  onClick={() => saveMutation.run(dirtyChanges)}
                >
                  {saveMutation.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {tr("保存 ZIP 分类")}
                </button>
              </div>
              {saveMutation.isError ? <ErrorLine message={saveMutation.error} action="mutation" /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type ArchiveClassificationDraft = {
  version: number | null;
  members: Record<string, { use: string; ownerDocumentIds: string[] }>;
};

function editArchiveClassificationDraft(
  current: ArchiveClassificationDraft,
  version: number,
  memberId: string,
  value: { use: string; ownerDocumentIds: string[] },
): ArchiveClassificationDraft {
  // A newer catalog cannot silently rebase an old user's selection.
  if (current.version !== null && current.version !== version) return current;
  return { version, members: { ...current.members, [memberId]: value } };
}

function mergeArchiveCatalogPages(pages: AdaptiveArchiveCatalog[]): { catalog: AdaptiveArchiveCatalog | null; mixedVersions: boolean } {
  const first = pages[0];
  if (!first) return { catalog: null, mixedVersions: false };
  const mixedVersions = pages.some(page => page.classification_version !== first.classification_version);
  const consistent = pages.filter(page => page.classification_version === first.classification_version);
  const members = consistent.flatMap(page => page.members);
  const last = consistent.at(-1) ?? first;
  return {
    catalog: { ...first, members, offset: 0, limit: members.length, has_more: last.has_more },
    mixedVersions,
  };
}

function ArchiveMemberRow({
  member,
  draft,
  conversationMembers,
  disabled,
  onChange,
}: {
  member: AdaptiveArchiveMember;
  draft: { use: string; ownerDocumentIds: string[] };
  conversationMembers: AdaptiveArchiveMember[];
  disabled: boolean;
  onChange: (value: { use: string; ownerDocumentIds: string[] }) => void;
}) {
  const tr = useImportCopy();
  const markdown = member.kind === "markdown";
  return (
    <div className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(10rem,14rem)] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm text-primary" title={member.path}>{member.path}</p>
        <p className="text-xs text-secondary">
          {member.availability === "missing" ? tr("文件缺失 · 保留引用") : formatBytes(member.byte_size ?? 0)} · {member.reference_count} {tr("次引用")}
          {member.manifest_kind ? ` · ${member.manifest_kind}` : ""}
        </p>
      </div>
      <label className="text-xs text-secondary">
        <span className="sr-only">{tr("分类")}</span>
        <select
          value={draft.use}
          disabled={disabled}
          onChange={(event) => onChange({
            use: event.currentTarget.value,
            ownerDocumentIds: event.currentTarget.value === "attachment" ? draft.ownerDocumentIds : [],
          })}
          className="min-h-9 w-full rounded-md border border-ui bg-surface px-2 text-xs text-primary"
        >
          {markdown ? <option value="conversation">{tr("导入为对话")}</option> : null}
          <option value="attachment">{tr("导入为附件")}</option>
          <option value="excluded">{tr("排除")}</option>
        </select>
      </label>
      <label className="text-xs text-secondary">
        <span className="mb-1 block">{tr("附件归属对话")}</span>
        <select
          multiple
          value={draft.ownerDocumentIds}
          disabled={disabled || draft.use !== "attachment" || !conversationMembers.length}
          onChange={(event) => onChange({
            use: draft.use,
            ownerDocumentIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value),
          })}
          className="min-h-9 w-full rounded-md border border-ui bg-surface px-2 py-1 text-xs text-primary disabled:opacity-60"
          aria-label={tr("附件归属对话")}
        >
          {conversationMembers.map((conversation) => <option key={conversation.member_id} value={conversation.member_id}>{conversation.path}</option>)}
        </select>
      </label>
    </div>
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function FamilySection({ title, families, session, sessionAction, sessionActionBusy, onConfigure }: { title: string; families: AdaptiveImportFamily[]; session: AdaptiveImportSession; sessionAction: SessionActionControls; sessionActionBusy: boolean; onConfigure: (id: string) => void }) {
  if (!families.length) return null;
  return <section aria-labelledby={`family-section-${title}`}><h4 id={`family-section-${title}`} className="mb-1 text-sm font-semibold text-primary">{title}</h4><div className="divide-y divide-ui border-y border-ui">{families.map((family) => <FamilyRow key={family.id} session={session} family={family} sessionAction={sessionAction} sessionActionBusy={sessionActionBusy} onConfigure={() => onConfigure(family.id)} />)}</div></section>;
}

function FamilyRow({ session, family, sessionAction, sessionActionBusy, onConfigure }: {
  session: AdaptiveImportSession;
  family: AdaptiveImportFamily;
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
  onConfigure: () => void;
}) {
  const tr = useImportCopy();
  const selectMutation = useAdaptiveSessionAction(
    (revisionId: string) => selectAdaptiveFamilyProfile(session.import_id, family.id, revisionId),
    sessionAction,
  );
  const handling = family.handling_class;
  const actionable = handling === "MAPPABLE";
  const candidates = asArray(family.match_evidence.candidates).map(asObject);
  const displayName = handling === "NOT_MAPPABLE" ? invalidFamilyTitle(family, tr) : familyDisplayName(family, tr);
  return (
    <article className="py-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FormatIcon mode={family.source_mode} />
            <h4 className="truncate text-sm font-semibold text-primary">{displayName}</h4>
            <HandlingBadge handling={handling} />
          </div>
          <p className="mt-1 text-sm text-secondary">{family.group_count} {tr("个对话 ·")}{modeLabel(family.source_mode, tr)}</p>
          {family.resolution_status === "DRIFTED" ? <p className="mt-1 text-xs text-[var(--warning)]">{tr("检测到来源结构变化，需要保存一个新版本。")}</p> : null}
          {handling !== "NOT_MAPPABLE" && family.diagnostics[0] ? <DiagnosticLine diagnostic={family.diagnostics[0]} locatable={false} /> : null}
          {family.resolution_status === "AMBIGUOUS" && candidates.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((candidate) => (
                <button key={String(candidate.revision_id)} type="button" disabled={sessionActionBusy || selectMutation.isPending} onClick={() => selectMutation.run(String(candidate.revision_id))} className="btn-secondary min-h-9 px-3 text-xs">
                  {tr("使用")}{String(candidate.name)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {actionable ? (
          <button type="button" disabled={sessionActionBusy} onClick={onConfigure} className="btn-secondary inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
            {family.resolution_status === "DRIFTED" ? tr("修复格式") : tr("设置格式")}<ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {handling === "NOT_MAPPABLE" ? <NotMappableRecovery session={session} family={family} sessionAction={sessionAction} sessionActionBusy={sessionActionBusy} /> : null}
      {handling !== "NOT_MAPPABLE" ? <FormatHealthCheck session={session} family={family} disabled={sessionActionBusy} sessionAction={sessionAction} onRepair={actionable ? onConfigure : undefined} /> : null}
      {selectMutation.isError ? <div className="mt-3"><ErrorLine message={selectMutation.error} action="mutation" /></div> : null}
    </article>
  );
}

function NotMappableRecovery({ session, family, sessionAction, sessionActionBusy }: {
  session: AdaptiveImportSession;
  family: AdaptiveImportFamily;
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
}) {
  const tr = useImportCopy();
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);
  const [rescueArtifact, setRescueArtifact] = useState<{ id: string; filename: string } | null>(null);
  const groups = session.groups.filter((group) => family.group_ids.includes(group.id));
  const replaceMutation = useAdaptiveSessionAction(
    ({ artifactId, file }: { artifactId: string; file: File }) => replaceAdaptiveImportArtifact(session.import_id, artifactId, file),
    sessionAction,
  );
  const excludeMutation = useAdaptiveSessionAction(
    (groupId: string) => excludeAdaptiveImportGroup(session.import_id, groupId),
    sessionAction,
    () => setConfirmGroupId(null),
  );

  return (
    <div className="mt-4 border-t border-ui pt-3">
      {family.handling_reason.detail ? (
        <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs leading-5 text-secondary">
          <p className="font-semibold text-primary">{tr(family.handling_reason.title || "暂不可映射")}</p>
          <p>{tr(family.handling_reason.detail)}</p>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="grid gap-3 py-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-secondary">{tr("需要处理的输入")}</p>
            <div className="mt-2 space-y-2">
              {group.files.map((file) => (
                <div key={file.artifact_id} className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-[var(--warning)] pl-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary" title={file.filename}>{file.filename}</p>
                    <p className="text-xs text-secondary">{file.extension} · {formatBytes(file.byte_size)}</p>
                  </div>
                  <ReplaceFileButton
                    artifactId={file.artifact_id}
                    filename={file.filename}
                    disabled={sessionActionBusy || replaceMutation.isPending || excludeMutation.isPending}
                    pending={replaceMutation.isPending}
                    onSelect={(replacement) => replaceMutation.run({ artifactId: file.artifact_id, file: replacement })}
                  />
                  <button type="button" disabled={sessionActionBusy} onClick={() => setRescueArtifact({ id: file.artifact_id, filename: file.filename })} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50">
                    <ShieldAlert className="h-4 w-4" />{tr("使用格式转换 Skill")}</button>
                </div>
              ))}
            </div>
            {group.diagnostics.map((diagnostic, index) => <DiagnosticLine key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} locatable={false} />)}
          </div>
          <div className="flex items-center justify-end gap-2">
            {confirmGroupId === group.id ? (
              <>
                <button type="button" onClick={() => setConfirmGroupId(null)} className="btn-secondary min-h-9 px-3 text-xs font-medium">{tr("保留")}</button>
                <button type="button" disabled={sessionActionBusy || excludeMutation.isPending} onClick={() => { excludeMutation.run(group.id); setConfirmGroupId(null); }} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--danger)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {excludeMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{tr("确认不导入")}</button>
              </>
            ) : (
              <button
                type="button"
                disabled={session.group_count <= 1 || sessionActionBusy || replaceMutation.isPending || excludeMutation.isPending}
                onClick={() => setConfirmGroupId(group.id)}
                className="inline-flex min-h-9 items-center gap-2 px-2 text-xs font-medium text-[var(--danger)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                title={session.group_count <= 1 ? tr("最后一项不能排除，请替换文件或重新选择。") : tr("从本次导入中排除这一项")}
              >
                <Trash2 className="h-4 w-4" />{tr("不导入此项")}</button>
            )}
          </div>
        </div>
      ))}
      {replaceMutation.isError ? <div className="mt-3"><ErrorLine message={replaceMutation.error} action="mutation" /></div> : null}
      {excludeMutation.isError ? <div className="mt-3"><ErrorLine message={excludeMutation.error} action="mutation" /></div> : null}
      {rescueArtifact ? <FormatConversionDialog filename={rescueArtifact.filename} onClose={() => setRescueArtifact(null)} onReplace={(file) => { setRescueArtifact(null); replaceMutation.run({ artifactId: rescueArtifact.id, file }); }} /> : null}
    </div>
  );
}

function ReplaceFileButton({ artifactId, filename, disabled, pending, onSelect }: {
  artifactId: string;
  filename: string;
  disabled: boolean;
  pending: boolean;
  onSelect: (file: File) => void;
}) {
  const tr = useImportCopy();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} aria-label={tr("替换 {0}", filename)} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}{tr("替换文件")}</button>
      <input
        ref={inputRef}
        type="file"
        data-testid={`replace-import-file-${artifactId}`}
        accept=".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm,.zip,application/zip,application/json,text/markdown,text/plain,text/html"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const replacement = event.target.files?.[0];
          event.currentTarget.value = "";
          if (replacement) onSelect(replacement);
        }}
      />
    </>
  );
}

function LegacyBlockedRecovery({ session, sessionAction, sessionActionBusy, onRegroup }: {
  session: AdaptiveImportSession;
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
  onRegroup: () => void;
}) {
  const tr = useImportCopy();
  const mutation = useAdaptiveSessionAction(
    () => reanalyzeAdaptiveImportSession(session.import_id),
    sessionAction,
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3" role="alert">
      <div>
        <p className="text-sm font-semibold text-primary">{tr("这个导入会话需要恢复")}</p>
        <p className="mt-1 text-xs leading-5 text-secondary">{tr("源文件仍然保留。可以使用当前分析器重新检查，或先调整文件组合。")}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={sessionActionBusy} onClick={onRegroup} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"><FolderCog className="h-4 w-4" />{tr("调整组合")}</button>
        <button type="button" disabled={sessionActionBusy || mutation.isPending} onClick={() => mutation.run(undefined)} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
          {mutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}{tr("重新分析")}</button>
      </div>
      {mutation.isError ? <div className="w-full"><ErrorLine message={mutation.error} action="mutation" /></div> : null}
    </div>
  );
}

function GroupResolver({ session, sessionAction, sessionActionBusy, forced, onClose, onResolved }: {
  session: AdaptiveImportSession;
  sessionAction: SessionActionControls;
  sessionActionBusy: boolean;
  forced: boolean;
  onClose: () => void;
  onResolved: () => void;
}) {
  const tr = useImportCopy();
  const artifactSignature = useMemo(
    () => session.groups.flatMap((group, index) => group.files.map((file) => `${index}:${file.artifact_id}`)).join("|"),
    [session.groups],
  );
  const initial = useMemo(
    () => Object.fromEntries(artifactSignature.split("|").filter(Boolean).map((item) => {
      const [groupIndex, artifactId] = item.split(":");
      return [artifactId, String(Number(groupIndex) + 1)];
    })),
    [artifactSignature],
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(initial);
  useEffect(() => {
    setAssignments(initial);
  }, [artifactSignature, initial]);
  const files = session.groups.flatMap((group) => group.files);
  const groupingIssue = validateGrouping(files, assignments, tr);
  const mutation = useAdaptiveSessionAction(
    () => {
      const buckets = new Map<string, string[]>();
      for (const [artifactId, group] of Object.entries(assignments)) buckets.set(group, [...(buckets.get(group) ?? []), artifactId]);
      return resolveAdaptiveImportGroups(
        session.import_id,
        Array.from(buckets.entries()).map(([name, artifact_ids]) => ({ artifact_ids, display_name: tr("对话组合 {0}", name) })),
      );
    },
    sessionAction,
    onResolved ? () => onResolved() : undefined,
  );
  return (
    <section className="space-y-5" aria-labelledby="group-resolver-title">
      <header className="border-b border-ui pb-4">
        <button type="button" disabled={sessionActionBusy || mutation.isPending} onClick={onClose} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
          <ArrowLeft className="h-3.5 w-3.5" />{forced ? tr("取消本次导入") : tr("返回导入概览")}
        </button>
        <h3 id="group-resolver-title" className="text-lg font-semibold text-primary">{tr("确认文件组合")}</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">{tr("把属于同一段对话的 JSON 与 Markdown 设为相同组合编号。一个组合最多包含一个 JSON 和一个 Markdown；单文件也可以独立导入。")}</p>
      </header>
      <div className="divide-y divide-ui border-y border-ui">
        {files.map((file) => (
          <div key={file.artifact_id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{file.filename}</p><p className="text-xs text-secondary">{file.extension} · {formatBytes(file.byte_size)}</p></div>
            <label className="text-xs font-medium text-secondary">{tr("组合")}<input disabled={sessionActionBusy || mutation.isPending} value={assignments[file.artifact_id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [file.artifact_id]: event.target.value.trim() }))} className="mt-1 h-9 w-full rounded-md border border-ui bg-surface px-2 text-sm text-primary disabled:opacity-60" aria-label={tr("{0} 的组合编号", file.filename)} />
            </label>
          </div>
        ))}
      </div>
      {groupingIssue ? <ErrorLine message={groupingIssue} /> : null}
      {mutation.isError ? <ErrorLine message={mutation.error} action="mutation" /> : null}
      <div className="flex justify-end">
        <button type="button" disabled={sessionActionBusy || mutation.isPending || Boolean(groupingIssue)} onClick={() => mutation.run(undefined)} className="btn-primary min-h-10 px-5 text-sm font-medium">
          {mutation.isPending ? tr("正在重新分析") : tr("确认组合并继续")}
        </button>
      </div>
    </section>
  );
}

function validateGrouping(files: AdaptiveImportGroup["files"], assignments: Record<string, string>, tr: ImportCopy): string | null {
  if (files.some((file) => !assignments[file.artifact_id])) return tr("请为每个文件填写组合编号。");
  const buckets = new Map<string, AdaptiveImportGroup["files"]>();
  for (const file of files) {
    const key = assignments[file.artifact_id];
    buckets.set(key, [...(buckets.get(key) ?? []), file]);
  }
  for (const [key, grouped] of buckets) {
    const jsonCount = grouped.filter((file) => [".json", ".jsonl", ".gz"].includes(file.extension.toLowerCase())).length;
    const markdownCount = grouped.filter((file) => [".md", ".markdown"].includes(file.extension.toLowerCase())).length;
    if (grouped.length > 2 || jsonCount > 1 || markdownCount > 1) return tr("组合 {0} 不是有效组合：最多放入一个 JSON 和一个 Markdown。", key);
  }
  return null;
}

function StateBadge({ state, pendingCount }: { state: AdaptiveImportSession["state"]; pendingCount: number }) {
  const tr = useImportCopy();
  const ready = state === "READY";
  const blocked = state === "BLOCKED";
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${ready ? "bg-[var(--accent-soft)] text-accent" : blocked ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
      {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
      {ready ? tr("准备导入") : blocked ? tr("需要恢复") : tr("{0} 项待处理", pendingCount || 1)}
    </span>
  );
}

export function ResolutionBadge({ status }: { status: AdaptiveImportFamily["resolution_status"] }) {
  const tr = useImportCopy();
  const labels: Record<string, string> = { EXACT_MATCH: tr("已支持"), COMPATIBLE: tr("兼容"), DRIFTED: tr("结构变化"), AMBIGUOUS: tr("需要选择"), UNKNOWN: tr("需要设置"), INVALID: tr("需要修复") };
  const tone = ["EXACT_MATCH", "COMPATIBLE"].includes(status) ? "bg-[var(--accent-soft)] text-accent" : status === "INVALID" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{labels[status]}</span>;
}

function HandlingBadge({ handling }: { handling: AdaptiveImportFamily["handling_class"] }) {
  const tr = useImportCopy();
  const labels = { SUPPORTED: tr("已支持"), MAPPABLE: tr("可设置格式"), NOT_MAPPABLE: tr("暂不可映射") } as const;
  const tone = handling === "SUPPORTED" ? "bg-[var(--accent-soft)] text-accent" : handling === "NOT_MAPPABLE" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{labels[handling]}</span>;
}

export function DiagnosticLine({ diagnostic, locatable = true }: { diagnostic: Pick<AdaptiveImportDiagnostic, "code" | "message" | "pointer" | "action">; locatable?: boolean }) {
  const tr = useImportCopy();
  function locate() {
    const targetId = diagnostic.action === "map_roles"
      ? "mapping-role-values"
      : diagnostic.action === "review_relation"
        ? "mapping-relation"
        : diagnostic.action === "inspect_source"
          ? "mapping-source-structure"
          : "mapping-message-locator";
    const target = document.getElementById(targetId) ?? document.getElementById("mapping-message-boundary");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }
  return (
    <div className="mt-2 border-l-2 border-[var(--warning)] pl-3 text-xs leading-5 text-secondary">
      <p className="font-medium text-primary">{diagnosticMessage(diagnostic, tr)}</p>
      {diagnostic.pointer ? locatable
        ? <button type="button" onClick={locate} className="mt-1 text-accent underline">{tr("定位：")}{diagnostic.pointer}</button>
        : <p className="mt-1 text-secondary">{tr("位置：")}{pointerLabel(diagnostic.pointer, tr)}</p>
        : null}
    </div>
  );
}

function diagnosticMessage(diagnostic: Pick<AdaptiveImportDiagnostic, "code" | "message">, tr: ImportCopy): string {
  const messages: Record<string, string> = {
    JSON_INVALID: tr("JSON 文件不完整、编码错误或语法无效。请替换为修正后的文件，或不导入这一项。"),
    NO_MESSAGE_STRUCTURE: tr("没有找到可确认的消息结构。可以替换文件，或调整文件组合后重试。"),
    MARKDOWN_ENCODING_INVALID: tr("Markdown 不是有效的 UTF-8 文本。请转换编码后替换文件。"),
    MARKDOWN_EMPTY: tr("Markdown 文件没有可导入内容。请替换文件，或不导入这一项。"),
    MARKDOWN_FENCE_UNCLOSED: tr("Markdown 中有未闭合的代码块。请修正后替换文件。"),
    GROUP_AMBIGUOUS: tr("这些文件不能安全组成一个对话。请调整文件组合。"),
    SOURCE_MISSING: tr("临时源文件已丢失。请替换该文件或重新选择。"),
  };
  return messages[diagnostic.code] ?? diagnostic.message;
}

function invalidFamilyTitle(family: AdaptiveImportFamily, tr: ImportCopy): string {
  return family.source_mode === "JSON_MARKDOWN" ? tr("无法分析的 JSON + Markdown") : family.source_mode === "MARKDOWN" ? tr("无法分析的 Markdown") : tr("无法分析的 JSON");
}

function familyDisplayName(family: AdaptiveImportFamily, tr: ImportCopy): string {
  if (!family.display_name.startsWith("Unknown ")) return family.display_name;
  return family.source_mode === "JSON_MARKDOWN" ? tr("未知 JSON + Markdown 格式") : family.source_mode === "MARKDOWN" ? tr("未知 Markdown 格式") : tr("未知 JSON 格式");
}

function pointerLabel(pointer: string, tr: ImportCopy): string {
  const line = /^line:(\d+)$/i.exec(pointer);
  return line ? tr("第 {0} 行", line[1]) : pointer;
}

export function FormatIcon({ mode }: { mode: string }) {
  return mode === "JSON_MARKDOWN" ? <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : mode === "MARKDOWN" || mode === "UNKNOWN" ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : <Braces className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />;
}

export function modeLabel(mode: string, tr: ImportCopy): string { return mode === "JSON_MARKDOWN" ? "JSON + Markdown" : mode === "MARKDOWN" ? "Markdown" : mode === "JSON" ? "JSON" : tr("文本文件"); }
export function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
export function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function ErrorLine({ message, action = "read", onRetry, retrying = false }: {
  message: unknown;
  action?: ImportErrorAction;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const tr = useImportCopy();
  return (
    <div role="alert" className={`border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)] ${onRetry ? "flex flex-wrap items-center justify-between gap-3" : ""}`}>
      <span>{importErrorMessage(message, tr, action)}</span>
      {onRetry ? <button type="button" disabled={retrying} onClick={onRetry} className="btn-secondary inline-flex min-h-9 shrink-0 items-center gap-2 px-3 text-xs font-medium">
        {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{tr("重试")}
      </button> : null}
    </div>
  );
}
