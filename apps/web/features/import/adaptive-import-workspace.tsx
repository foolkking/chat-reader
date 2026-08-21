"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Braces, CheckCircle2, ChevronRight, FileText, Layers3, LoaderCircle, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { resolveAdaptiveImportGroups, selectAdaptiveFamilyProfile } from "../../lib/api";
import type { AdaptiveImportFamily, AdaptiveImportSession } from "../../lib/types";
import { MappingWorkspace } from "./mapping-workspace";

export function AdaptiveImportWorkspace({ session, onSession, onBack, onImport, importing, error }: {
  session: AdaptiveImportSession;
  onSession: (session: AdaptiveImportSession) => void;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
  error: string | null;
}) {
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const activeFamily = session.families.find((family) => family.id === activeFamilyId) ?? null;
  if (activeFamily) return <MappingWorkspace session={session} family={activeFamily} onBack={() => setActiveFamilyId(null)} onSession={(next) => { setActiveFamilyId(null); onSession(next); }} />;
  if (session.state === "NEEDS_GROUPING") return <GroupResolver session={session} onCancel={onBack} onResolved={onSession} />;
  return (
    <section className="space-y-5" aria-labelledby="adaptive-import-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ui pb-4">
        <div>
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" />重新选择文件</button>
          <h3 id="adaptive-import-title" className="text-lg font-semibold text-primary">导入概览</h3>
          <p className="mt-1 text-sm text-secondary">发现 {session.group_count} 个对话，识别出 {session.family_count} 种格式</p>
        </div>
        <StateBadge state={session.state} />
      </div>
      <div className="divide-y divide-ui border-y border-ui">
        {session.families.map((family) => <FamilyRow key={family.id} session={session} family={family} onConfigure={() => setActiveFamilyId(family.id)} onSession={onSession} />)}
      </div>
      {session.state === "BLOCKED" ? <ErrorLine message="部分源文件无法形成可映射的对话。请根据诊断修复文件后重新选择。" /> : null}
      {error ? <ErrorLine message={error} /> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ui pt-4">
        <p className="text-sm text-secondary">{session.state === "READY" ? `准备导入 ${session.conversation_count} 个对话、${session.message_count} 条消息。` : "先处理所有需要设置、修复或确认的格式。"}</p>
        <button type="button" data-testid="commit-import-button" disabled={!session.can_import || importing} onClick={onImport} className="btn-primary min-h-10 px-5 text-sm font-medium">{importing ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在导入</> : `导入 ${session.conversation_count || session.group_count} 个对话`}</button>
      </footer>
    </section>
  );
}

function FamilyRow({ session, family, onConfigure, onSession }: { session: AdaptiveImportSession; family: AdaptiveImportFamily; onConfigure: () => void; onSession: (session: AdaptiveImportSession) => void }) {
  const selectMutation = useMutation({ mutationFn: (revisionId: string) => selectAdaptiveFamilyProfile(session.import_id, family.id, revisionId), onSuccess: onSession });
  const actionable = ["UNKNOWN", "DRIFTED"].includes(family.resolution_status);
  const candidates = asArray(family.match_evidence.candidates).map(asObject);
  return (
    <article className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><FormatIcon mode={family.source_mode} /><h4 className="truncate text-sm font-semibold text-primary">{family.display_name}</h4><ResolutionBadge status={family.resolution_status} /></div>
        <p className="mt-1 text-sm text-secondary">{family.group_count} 个对话 · {modeLabel(family.source_mode)}</p>
        {family.resolution_status === "DRIFTED" ? <p className="mt-1 text-xs text-[var(--warning)]">检测到来源结构变化，需要保存一个新版本。</p> : null}
        {family.diagnostics[0] ? <DiagnosticLine diagnostic={family.diagnostics[0]} /> : null}
        {family.resolution_status === "AMBIGUOUS" && candidates.length ? <div className="mt-3 flex flex-wrap gap-2">{candidates.map((candidate) => <button key={String(candidate.revision_id)} type="button" disabled={selectMutation.isPending} onClick={() => selectMutation.mutate(String(candidate.revision_id))} className="btn-secondary min-h-9 px-3 text-xs">使用 {String(candidate.name)}</button>)}</div> : null}
      </div>
      {actionable ? <button type="button" onClick={onConfigure} className="btn-secondary inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium">{family.resolution_status === "DRIFTED" ? "修复格式" : "设置格式"}<ChevronRight className="h-4 w-4" /></button> : null}
    </article>
  );
}

function GroupResolver({ session, onCancel, onResolved }: { session: AdaptiveImportSession; onCancel: () => void; onResolved: (session: AdaptiveImportSession) => void }) {
  const initial = useMemo(() => Object.fromEntries(session.groups.flatMap((group, index) => group.files.map((file) => [file.artifact_id, String(index + 1)]))), [session.groups]);
  const [assignments, setAssignments] = useState<Record<string, string>>(initial);
  const mutation = useMutation({
    mutationFn: () => {
      const buckets = new Map<string, string[]>();
      for (const [artifactId, group] of Object.entries(assignments)) buckets.set(group, [...(buckets.get(group) ?? []), artifactId]);
      return resolveAdaptiveImportGroups(session.import_id, Array.from(buckets.entries()).map(([name, artifact_ids]) => ({ artifact_ids, display_name: `对话组合 ${name}` })));
    },
    onSuccess: onResolved,
  });
  const files = session.groups.flatMap((group) => group.files);
  return (
    <section className="space-y-5" aria-labelledby="group-resolver-title">
      <header className="border-b border-ui pb-4"><button type="button" onClick={onCancel} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" />取消本次导入</button><h3 id="group-resolver-title" className="text-lg font-semibold text-primary">确认文件组合</h3><p className="mt-1 text-sm text-secondary">文件名只用于建议。把属于同一段对话的 JSON 与 Markdown 设为相同组合编号。</p></header>
      <div className="divide-y divide-ui border-y border-ui">{files.map((file) => <div key={file.artifact_id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{file.filename}</p><p className="text-xs text-secondary">{file.extension} · {formatBytes(file.byte_size)}</p></div><label className="text-xs font-medium text-secondary">组合<input value={assignments[file.artifact_id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [file.artifact_id]: event.target.value.trim() }))} className="mt-1 h-9 w-full rounded-md border border-ui bg-surface px-2 text-sm text-primary" aria-label={`${file.filename} 的组合编号`} /></label></div>)}</div>
      {mutation.isError ? <ErrorLine message={mutation.error.message} /> : null}
      <div className="flex justify-end"><button type="button" disabled={mutation.isPending || Object.values(assignments).some((value) => !value)} onClick={() => mutation.mutate()} className="btn-primary min-h-10 px-5 text-sm font-medium">{mutation.isPending ? "正在重新分析" : "确认组合并继续"}</button></div>
    </section>
  );
}

function StateBadge({ state }: { state: AdaptiveImportSession["state"] }) {
  const ready = state === "READY";
  return <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${ready ? "bg-[var(--accent-soft)] text-accent" : state === "BLOCKED" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>{ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}{ready ? "准备导入" : state === "BLOCKED" ? "存在阻断" : "需要处理"}</span>;
}

export function ResolutionBadge({ status }: { status: AdaptiveImportFamily["resolution_status"] }) {
  const labels: Record<string, string> = { EXACT_MATCH: "已支持", COMPATIBLE: "兼容", DRIFTED: "结构变化", AMBIGUOUS: "需要选择", UNKNOWN: "需要设置", INVALID: "无效" };
  const tone = ["EXACT_MATCH", "COMPATIBLE"].includes(status) ? "bg-[var(--accent-soft)] text-accent" : status === "INVALID" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{labels[status]}</span>;
}

export function DiagnosticLine({ diagnostic }: { diagnostic: { code: string; message: string; pointer?: string | null; action?: string | null } }) {
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
  return <div className="mt-2 border-l-2 border-[var(--warning)] pl-3 text-xs leading-5 text-secondary"><p className="font-medium text-primary">{diagnostic.message}</p>{diagnostic.pointer ? <button type="button" onClick={locate} className="mt-1 text-accent underline">定位：{diagnostic.pointer}</button> : null}</div>;
}

export function FormatIcon({ mode }: { mode: string }) {
  return mode === "JSON_MARKDOWN" ? <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : mode === "MARKDOWN" ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : <Braces className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />;
}

export function modeLabel(mode: string): string { return mode === "JSON_MARKDOWN" ? "JSON + Markdown" : mode === "MARKDOWN" ? "Markdown" : "JSON"; }
export function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
export function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function ErrorLine({ message }: { message: string }) { return <div role="alert" className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</div>; }
