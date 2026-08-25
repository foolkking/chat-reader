"use client";

import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  Clipboard,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  FileUp,
  FolderCog,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  excludeAdaptiveImportGroup,
  reanalyzeAdaptiveImportSession,
  replaceAdaptiveImportArtifact,
  resolveAdaptiveImportGroups,
  selectAdaptiveFamilyProfile,
} from "../../lib/api";
import type {
  AdaptiveImportDiagnostic,
  AdaptiveImportFamily,
  AdaptiveImportGroup,
  AdaptiveImportSession,
} from "../../lib/types";
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
  const [groupingOpen, setGroupingOpen] = useState(false);
  const activeFamily = session.families.find((family) => family.id === activeFamilyId) ?? null;
  const supportedFamilies = session.families.filter((family) => handlingClass(family) === "SUPPORTED");
  const mappableFamilies = session.families.filter((family) => handlingClass(family) === "MAPPABLE");
  const notMappableFamilies = session.families.filter((family) => handlingClass(family) === "NOT_MAPPABLE");
  const supportedCount = supportedFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const mappableCount = mappableFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const notMappableCount = notMappableFamilies.reduce((sum, family) => sum + family.group_count, 0);
  const invalidCount = notMappableCount;
  const pendingCount = mappableCount + notMappableCount;

  if (activeFamily) {
    return (
      <MappingWorkspace
        session={session}
        family={activeFamily}
        onBack={() => setActiveFamilyId(null)}
        onSession={(next) => {
          setActiveFamilyId(null);
          onSession(next);
        }}
      />
    );
  }
  if (session.state === "NEEDS_GROUPING" || groupingOpen) {
    return (
      <GroupResolver
        session={session}
        forced={session.state === "NEEDS_GROUPING"}
        onClose={session.state === "NEEDS_GROUPING" ? onBack : () => setGroupingOpen(false)}
        onResolved={(next) => {
          setGroupingOpen(false);
          onSession(next);
        }}
      />
    );
  }
  return (
    <section className="space-y-5" aria-labelledby="adaptive-import-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ui pb-4">
        <div>
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />重新选择文件
          </button>
          <h3 id="adaptive-import-title" className="text-lg font-semibold text-primary">导入概览</h3>
          <p className="mt-1 text-sm text-secondary">发现 {session.group_count} 个对话，识别出 {session.family_count} 种格式</p>
        </div>
        <StateBadge state={session.state} pendingCount={pendingCount} />
      </div>

      {session.state === "BLOCKED" && invalidCount > 0 ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3">
          <div className="flex min-w-0 gap-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-primary">{invalidCount} 个对话需要修复输入</p>
              <p className="mt-1 text-xs leading-5 text-secondary">其他已识别格式仍可继续设置。替换、排除或重新组合这些文件后，系统会自动重新分析。</p>
            </div>
          </div>
          <button type="button" onClick={() => setGroupingOpen(true)} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
            <FolderCog className="h-4 w-4" />调整文件组合
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-y border-ui py-3 text-xs" aria-label="导入格式处理状态">
        <StatusSummary icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="已支持" count={supportedCount} tone="success" />
        <StatusSummary icon={<Settings2 className="h-3.5 w-3.5" />} label="可设置格式" count={mappableCount} tone="warning" />
        <StatusSummary icon={<ShieldAlert className="h-3.5 w-3.5" />} label="暂不可映射" count={notMappableCount} tone="danger" />
      </div>
      <FamilySection title="已支持 · 可直接导入" families={supportedFamilies} session={session} onConfigure={(id) => setActiveFamilyId(id)} onSession={onSession} />
      <FamilySection title="可设置格式 · 需要确认一次" families={mappableFamilies} session={session} onConfigure={(id) => setActiveFamilyId(id)} onSession={onSession} />
      <FamilySection title="暂不可映射 · 需要先转换" families={notMappableFamilies} session={session} onConfigure={() => undefined} onSession={onSession} />

      {session.state === "BLOCKED" ? <LegacyBlockedRecovery session={session} onSession={onSession} onRegroup={() => setGroupingOpen(true)} /> : null}
      {error ? <ErrorLine message={error} /> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ui pt-4">
        <div>
          <p className="text-sm text-secondary">
            {session.state === "READY"
              ? `准备导入 ${session.conversation_count} 个对话、${session.message_count} 条消息。`
              : pendingCount
                ? `还有 ${pendingCount} 个对话需要设置或修复。已完成的处理会保留。`
                : "正在整理导入计划。"}
          </p>
          {!invalidCount && session.state !== "READY" ? (
            <button type="button" onClick={() => setGroupingOpen(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary">
              <FolderCog className="h-3.5 w-3.5" />调整文件组合
            </button>
          ) : null}
        </div>
        <button type="button" data-testid="commit-import-button" disabled={!session.can_import || importing} onClick={onImport} className="btn-primary min-h-10 px-5 text-sm font-medium">
          {importing ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在导入</> : `导入 ${session.conversation_count || session.group_count} 个对话`}
        </button>
      </footer>
    </section>
  );
}

function StatusSummary({ icon, label, count, tone }: { icon: ReactNode; label: string; count: number; tone: "success" | "warning" | "danger" }) {
  const styles = tone === "success" ? "bg-[var(--accent-soft)] text-accent" : tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold ${styles}`}>{icon}{label} {count}</span>;
}

function FamilySection({ title, families, session, onConfigure, onSession }: { title: string; families: AdaptiveImportFamily[]; session: AdaptiveImportSession; onConfigure: (id: string) => void; onSession: (session: AdaptiveImportSession) => void }) {
  if (!families.length) return null;
  return <section aria-labelledby={`family-section-${title}`}><h4 id={`family-section-${title}`} className="mb-1 text-sm font-semibold text-primary">{title}</h4><div className="divide-y divide-ui border-y border-ui">{families.map((family) => <FamilyRow key={family.id} session={session} family={family} onConfigure={() => onConfigure(family.id)} onSession={onSession} />)}</div></section>;
}

function FamilyRow({ session, family, onConfigure, onSession }: {
  session: AdaptiveImportSession;
  family: AdaptiveImportFamily;
  onConfigure: () => void;
  onSession: (session: AdaptiveImportSession) => void;
}) {
  const selectMutation = useMutation({
    mutationFn: (revisionId: string) => selectAdaptiveFamilyProfile(session.import_id, family.id, revisionId),
    onSuccess: onSession,
  });
  const handling = handlingClass(family);
  const actionable = handling === "MAPPABLE";
  const candidates = asArray(family.match_evidence.candidates).map(asObject);
  return (
    <article className="py-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FormatIcon mode={family.source_mode} />
            <h4 className="truncate text-sm font-semibold text-primary">{handling === "NOT_MAPPABLE" ? "无法安全映射" : familyDisplayName(family)}</h4>
            <HandlingBadge handling={handling} />
          </div>
          <p className="mt-1 text-sm text-secondary">{family.group_count} 个对话 · {modeLabel(family.source_mode)}</p>
          {family.resolution_status === "DRIFTED" ? <p className="mt-1 text-xs text-[var(--warning)]">检测到来源结构变化，需要保存一个新版本。</p> : null}
          {handling !== "NOT_MAPPABLE" && family.diagnostics[0] ? <DiagnosticLine diagnostic={family.diagnostics[0]} /> : null}
          {family.resolution_status === "AMBIGUOUS" && candidates.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((candidate) => (
                <button key={String(candidate.revision_id)} type="button" disabled={selectMutation.isPending} onClick={() => selectMutation.mutate(String(candidate.revision_id))} className="btn-secondary min-h-9 px-3 text-xs">
                  使用 {String(candidate.name)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {actionable ? (
          <button type="button" onClick={onConfigure} className="btn-secondary inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium">
            {family.resolution_status === "DRIFTED" ? "修复格式" : "设置格式"}<ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {handling === "NOT_MAPPABLE" ? <NotMappableRecovery session={session} family={family} onSession={onSession} /> : null}
      {selectMutation.isError ? <div className="mt-3"><ErrorLine message={selectMutation.error.message} /></div> : null}
    </article>
  );
}

function NotMappableRecovery({ session, family, onSession }: {
  session: AdaptiveImportSession;
  family: AdaptiveImportFamily;
  onSession: (session: AdaptiveImportSession) => void;
}) {
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);
  const [rescueArtifact, setRescueArtifact] = useState<{ id: string; filename: string } | null>(null);
  const groups = session.groups.filter((group) => family.group_ids.includes(group.id));
  const replaceMutation = useMutation({
    mutationFn: ({ artifactId, file }: { artifactId: string; file: File }) => replaceAdaptiveImportArtifact(session.import_id, artifactId, file),
    onSuccess: onSession,
  });
  const excludeMutation = useMutation({
    mutationFn: (groupId: string) => excludeAdaptiveImportGroup(session.import_id, groupId),
    onSuccess: (next) => {
      setConfirmGroupId(null);
      onSession(next);
    },
  });

  return (
    <div className="mt-4 border-t border-ui pt-3">
      {family.handling_reason.detail ? (
        <div className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs leading-5 text-secondary">
          <p className="font-semibold text-primary">无法安全映射</p>
          <p>{family.handling_reason.detail}</p>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="grid gap-3 py-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-secondary">需要处理的输入</p>
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
                    disabled={replaceMutation.isPending || excludeMutation.isPending}
                    pending={replaceMutation.isPending}
                    onSelect={(replacement) => replaceMutation.mutate({ artifactId: file.artifact_id, file: replacement })}
                  />
                  <button type="button" onClick={() => setRescueArtifact({ id: file.artifact_id, filename: file.filename })} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
                    <ShieldAlert className="h-4 w-4" />使用 Conversation Rescue
                  </button>
                </div>
              ))}
            </div>
            {group.diagnostics.map((diagnostic, index) => <DiagnosticLine key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} locatable={false} />)}
          </div>
          <div className="flex items-center justify-end gap-2">
            {confirmGroupId === group.id ? (
              <>
                <button type="button" onClick={() => setConfirmGroupId(null)} className="btn-secondary min-h-9 px-3 text-xs font-medium">保留</button>
                <button type="button" disabled={excludeMutation.isPending} onClick={() => excludeMutation.mutate(group.id)} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--danger)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {excludeMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}确认不导入
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={session.group_count <= 1 || replaceMutation.isPending || excludeMutation.isPending}
                onClick={() => setConfirmGroupId(group.id)}
                className="inline-flex min-h-9 items-center gap-2 px-2 text-xs font-medium text-[var(--danger)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                title={session.group_count <= 1 ? "最后一项不能排除，请替换文件或重新选择。" : "从本次导入中排除这一项"}
              >
                <Trash2 className="h-4 w-4" />不导入此项
              </button>
            )}
          </div>
        </div>
      ))}
      {replaceMutation.isError ? <div className="mt-3"><ErrorLine message={replaceMutation.error.message} /></div> : null}
      {excludeMutation.isError ? <div className="mt-3"><ErrorLine message={excludeMutation.error.message} /></div> : null}
      {rescueArtifact ? <RescueDialog filename={rescueArtifact.filename} onClose={() => setRescueArtifact(null)} onReplace={(file) => { setRescueArtifact(null); replaceMutation.mutate({ artifactId: rescueArtifact.id, file }); }} /> : null}
    </div>
  );
}

function RescueDialog({ filename, onClose, onReplace }: { filename: string; onClose: () => void; onReplace: (file: File) => void }) {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resources = {
    zh: "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_zh.md",
    en: "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_en.md",
  } as const;
  const request = language === "zh"
    ? "请严格按照附带的 Chat Reader Conversation Rescue Skill，将源文件恢复为一个 Chat Reader Native Markdown Export v2 文件。不要总结、改写、补造或回答原对话内容。输出一个可重新上传的 .md 文件。"
    : "Use the attached Chat Reader Conversation Rescue Skill to recover this source as one Chat Reader Native Markdown Export v2 file. Do not summarize, rewrite, invent, or answer the transcript. Output one .md file that can be uploaded again.";
  async function copy(label: string, value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }
  async function copySkill() {
    const response = await fetch(resources[language]);
    await copy("skill", await response.text());
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="rescue-dialog-title" className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[740px] flex-col overflow-hidden rounded-lg border border-ui bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-ui px-5 py-4">
          <div><h2 id="rescue-dialog-title" className="text-base font-semibold text-primary">使用 Conversation Rescue</h2><p className="mt-1 text-xs leading-5 text-secondary">将不可映射的源文件恢复为 Chat Reader 可导入的 Markdown。Chat Reader 不会自动上传原文。</p></div>
          <button type="button" onClick={onClose} className="btn-ghost" aria-label="关闭"><span aria-hidden="true">×</span></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <details className="border border-ui px-3 py-2 text-xs text-secondary"><summary className="cursor-pointer font-medium text-primary">查看 Skill 摘要</summary><p className="mt-2 leading-5">Skill 只负责把无法安全映射的源文件整理为 Chat Reader Native Markdown Export v2；不会回答、总结或改写原对话。</p></details>
          <div className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-3 text-sm"><p className="font-semibold text-primary">当前文件：{filename}</p><p className="mt-1 text-secondary">当前结构没有可靠的消息边界。继续设置角色或内容字段无法安全得到 Conversation。</p></div>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-secondary"><li>复制或下载 Rescue Skill。</li><li>将源文件和 Skill 提供给你选择的大模型。</li><li>要求输出 Chat Reader Native Markdown Export v2。</li><li>回到这里替换当前文件，再重新分析。</li></ol>
          <div className="border border-ui bg-subtle p-3"><div className="flex flex-wrap gap-2" role="tablist" aria-label="Rescue Skill language"><button type="button" role="tab" aria-selected={language === "zh"} onClick={() => setLanguage("zh")} className={`min-h-9 px-3 text-sm ${language === "zh" ? "bg-surface font-semibold text-primary shadow-sm" : "text-secondary"}`}>中文 Skill</button><button type="button" role="tab" aria-selected={language === "en"} onClick={() => setLanguage("en")} className={`min-h-9 px-3 text-sm ${language === "en" ? "bg-surface font-semibold text-primary shadow-sm" : "text-secondary"}`}>English Skill</button></div><div className="mt-3 flex flex-wrap gap-2"><a href={resources[language]} download className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs"><Download className="h-4 w-4" />下载 Skill</a><button type="button" onClick={() => void copySkill()} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs"><Clipboard className="h-4 w-4" />复制 Skill</button></div><p className="mt-2 text-xs text-secondary">{copied === "skill" ? "已复制，可粘贴到大模型。" : "下载文件后，与源文件一起提供给外部大模型。"}</p></div>
          <div className="border border-ui p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-primary">转换请求模板</p><button type="button" onClick={() => void copy("request", request)} className="btn-secondary inline-flex min-h-8 items-center gap-2 px-2.5 text-xs"><Clipboard className="h-3.5 w-3.5" />复制模板</button></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-secondary">{request}</p><p className="mt-2 text-xs text-accent">{copied === "request" ? "已复制。" : "输出后请重新上传生成的 .md 文件。"}</p></div>
          <p className="text-xs leading-5 text-secondary">隐私提示：外部大模型可能会读取源文件中的对话内容。Chat Reader 不会代替你向第三方服务上传文件，请自行确认隐私范围。</p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-ui px-5 py-3"><button type="button" onClick={() => inputRef.current?.click()} className="btn-primary min-h-10 px-4 text-sm">替换当前文件</button><button type="button" onClick={onClose} className="btn-secondary min-h-10 px-4 text-sm">稍后处理</button><input ref={inputRef} type="file" accept=".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onReplace(file); }} /></footer>
      </section>
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
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} aria-label={`替换 ${filename}`} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}替换文件
      </button>
      <input
        ref={inputRef}
        type="file"
        data-testid={`replace-import-file-${artifactId}`}
        accept=".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm,application/json,text/markdown,text/plain,text/html"
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

function LegacyBlockedRecovery({ session, onSession, onRegroup }: {
  session: AdaptiveImportSession;
  onSession: (session: AdaptiveImportSession) => void;
  onRegroup: () => void;
}) {
  const mutation = useMutation({ mutationFn: () => reanalyzeAdaptiveImportSession(session.import_id), onSuccess: onSession });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3" role="alert">
      <div>
        <p className="text-sm font-semibold text-primary">这个导入会话需要恢复</p>
        <p className="mt-1 text-xs leading-5 text-secondary">源文件仍然保留。可以使用当前分析器重新检查，或先调整文件组合。</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onRegroup} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium"><FolderCog className="h-4 w-4" />调整组合</button>
        <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium">
          {mutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}重新分析
        </button>
      </div>
      {mutation.isError ? <div className="w-full"><ErrorLine message={mutation.error.message} /></div> : null}
    </div>
  );
}

function GroupResolver({ session, forced, onClose, onResolved }: {
  session: AdaptiveImportSession;
  forced: boolean;
  onClose: () => void;
  onResolved: (session: AdaptiveImportSession) => void;
}) {
  const initial = useMemo(
    () => Object.fromEntries(session.groups.flatMap((group, index) => group.files.map((file) => [file.artifact_id, String(index + 1)]))),
    [session.groups],
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(initial);
  const files = session.groups.flatMap((group) => group.files);
  const groupingIssue = validateGrouping(files, assignments);
  const mutation = useMutation({
    mutationFn: () => {
      const buckets = new Map<string, string[]>();
      for (const [artifactId, group] of Object.entries(assignments)) buckets.set(group, [...(buckets.get(group) ?? []), artifactId]);
      return resolveAdaptiveImportGroups(
        session.import_id,
        Array.from(buckets.entries()).map(([name, artifact_ids]) => ({ artifact_ids, display_name: `对话组合 ${name}` })),
      );
    },
    onSuccess: onResolved,
  });
  return (
    <section className="space-y-5" aria-labelledby="group-resolver-title">
      <header className="border-b border-ui pb-4">
        <button type="button" onClick={onClose} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />{forced ? "取消本次导入" : "返回导入概览"}
        </button>
        <h3 id="group-resolver-title" className="text-lg font-semibold text-primary">确认文件组合</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">把属于同一段对话的 JSON 与 Markdown 设为相同组合编号。一个组合最多包含一个 JSON 和一个 Markdown；单文件也可以独立导入。</p>
      </header>
      <div className="divide-y divide-ui border-y border-ui">
        {files.map((file) => (
          <div key={file.artifact_id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-primary">{file.filename}</p><p className="text-xs text-secondary">{file.extension} · {formatBytes(file.byte_size)}</p></div>
            <label className="text-xs font-medium text-secondary">组合
              <input value={assignments[file.artifact_id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [file.artifact_id]: event.target.value.trim() }))} className="mt-1 h-9 w-full rounded-md border border-ui bg-surface px-2 text-sm text-primary" aria-label={`${file.filename} 的组合编号`} />
            </label>
          </div>
        ))}
      </div>
      {groupingIssue ? <ErrorLine message={groupingIssue} /> : null}
      {mutation.isError ? <ErrorLine message={mutation.error.message} /> : null}
      <div className="flex justify-end">
        <button type="button" disabled={mutation.isPending || Boolean(groupingIssue)} onClick={() => mutation.mutate()} className="btn-primary min-h-10 px-5 text-sm font-medium">
          {mutation.isPending ? "正在重新分析" : "确认组合并继续"}
        </button>
      </div>
    </section>
  );
}

function validateGrouping(files: AdaptiveImportGroup["files"], assignments: Record<string, string>): string | null {
  if (files.some((file) => !assignments[file.artifact_id])) return "请为每个文件填写组合编号。";
  const buckets = new Map<string, AdaptiveImportGroup["files"]>();
  for (const file of files) {
    const key = assignments[file.artifact_id];
    buckets.set(key, [...(buckets.get(key) ?? []), file]);
  }
  for (const [key, grouped] of buckets) {
    const jsonCount = grouped.filter((file) => [".json", ".jsonl", ".gz"].includes(file.extension.toLowerCase())).length;
    const markdownCount = grouped.filter((file) => [".md", ".markdown"].includes(file.extension.toLowerCase())).length;
    if (grouped.length > 2 || jsonCount > 1 || markdownCount > 1) return `组合 ${key} 不是有效组合：最多放入一个 JSON 和一个 Markdown。`;
  }
  return null;
}

function StateBadge({ state, pendingCount }: { state: AdaptiveImportSession["state"]; pendingCount: number }) {
  const ready = state === "READY";
  const blocked = state === "BLOCKED";
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${ready ? "bg-[var(--accent-soft)] text-accent" : blocked ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
      {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
      {ready ? "准备导入" : blocked ? "需要恢复" : `${pendingCount || 1} 项待处理`}
    </span>
  );
}

export function ResolutionBadge({ status }: { status: AdaptiveImportFamily["resolution_status"] }) {
  const labels: Record<string, string> = { EXACT_MATCH: "已支持", COMPATIBLE: "兼容", DRIFTED: "结构变化", AMBIGUOUS: "需要选择", UNKNOWN: "需要设置", INVALID: "需要修复" };
  const tone = ["EXACT_MATCH", "COMPATIBLE"].includes(status) ? "bg-[var(--accent-soft)] text-accent" : status === "INVALID" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{labels[status]}</span>;
}

function HandlingBadge({ handling }: { handling: AdaptiveImportFamily["handling_class"] }) {
  const labels = { SUPPORTED: "已支持", MAPPABLE: "可设置格式", NOT_MAPPABLE: "暂不可映射" } as const;
  const tone = handling === "SUPPORTED" ? "bg-[var(--accent-soft)] text-accent" : handling === "NOT_MAPPABLE" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{labels[handling]}</span>;
}

function handlingClass(family: AdaptiveImportFamily): AdaptiveImportFamily["handling_class"] {
  if (family.handling_class) return family.handling_class;
  return ["EXACT_MATCH", "COMPATIBLE"].includes(family.resolution_status) ? "SUPPORTED" : family.resolution_status === "INVALID" ? "NOT_MAPPABLE" : "MAPPABLE";
}

export function DiagnosticLine({ diagnostic, locatable = true }: { diagnostic: Pick<AdaptiveImportDiagnostic, "code" | "message" | "pointer" | "action">; locatable?: boolean }) {
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
      <p className="font-medium text-primary">{diagnosticMessage(diagnostic)}</p>
      {diagnostic.pointer ? locatable
        ? <button type="button" onClick={locate} className="mt-1 text-accent underline">定位：{diagnostic.pointer}</button>
        : <p className="mt-1 text-secondary">位置：{pointerLabel(diagnostic.pointer)}</p>
        : null}
    </div>
  );
}

function diagnosticMessage(diagnostic: Pick<AdaptiveImportDiagnostic, "code" | "message">): string {
  const messages: Record<string, string> = {
    JSON_INVALID: "JSON 文件不完整、编码错误或语法无效。请替换为修正后的文件，或不导入这一项。",
    NO_MESSAGE_STRUCTURE: "没有找到可确认的消息结构。可以替换文件，或调整文件组合后重试。",
    MARKDOWN_ENCODING_INVALID: "Markdown 不是有效的 UTF-8 文本。请转换编码后替换文件。",
    MARKDOWN_EMPTY: "Markdown 文件没有可导入内容。请替换文件，或不导入这一项。",
    MARKDOWN_FENCE_UNCLOSED: "Markdown 中有未闭合的代码块。请修正后替换文件。",
    GROUP_AMBIGUOUS: "这些文件不能安全组成一个对话。请调整文件组合。",
    SOURCE_MISSING: "临时源文件已丢失。请替换该文件或重新选择。",
  };
  return messages[diagnostic.code] ?? diagnostic.message;
}

function _invalidFamilyTitle(family: AdaptiveImportFamily): string {
  return family.source_mode === "JSON_MARKDOWN" ? "无法分析的 JSON + Markdown" : family.source_mode === "MARKDOWN" ? "无法分析的 Markdown" : "无法分析的 JSON";
}

function familyDisplayName(family: AdaptiveImportFamily): string {
  if (!family.display_name.startsWith("Unknown ")) return family.display_name;
  return family.source_mode === "JSON_MARKDOWN" ? "未知 JSON + Markdown 格式" : family.source_mode === "MARKDOWN" ? "未知 Markdown 格式" : "未知 JSON 格式";
}

function pointerLabel(pointer: string): string {
  const line = /^line:(\d+)$/i.exec(pointer);
  return line ? `第 ${line[1]} 行` : pointer;
}

export function FormatIcon({ mode }: { mode: string }) {
  return mode === "JSON_MARKDOWN" ? <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : mode === "MARKDOWN" || mode === "UNKNOWN" ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : <Braces className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />;
}

export function modeLabel(mode: string): string { return mode === "JSON_MARKDOWN" ? "JSON + Markdown" : mode === "MARKDOWN" ? "Markdown" : mode === "JSON" ? "JSON" : "文本文件"; }
export function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
export function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function ErrorLine({ message }: { message: string }) { return <div role="alert" className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</div>; }
