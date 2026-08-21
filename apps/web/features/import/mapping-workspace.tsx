"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { previewAdaptiveFamilyMapping, saveAdaptiveFamilyMapping } from "../../lib/api";
import type { AdaptiveImportDiagnostic, AdaptiveImportFamily, AdaptiveImportGroup, AdaptiveImportSession, AdaptiveMappingPreview } from "../../lib/types";
import { asArray, asObject, DiagnosticLine, FormatIcon, formatBytes, modeLabel, ResolutionBadge } from "./adaptive-import-workspace";

type MappingSpec = Record<string, unknown>;

export function MappingWorkspace({ session, family, onBack, onSession }: { session: AdaptiveImportSession; family: AdaptiveImportFamily; onBack: () => void; onSession: (session: AdaptiveImportSession) => void }) {
  const [mapping, setMapping] = useState<MappingSpec>(() => structuredClone(family.mapping_draft));
  const [profileName, setProfileName] = useState(family.resolution_status === "DRIFTED" ? family.display_name : suggestedProfileName(family));
  const [preview, setPreview] = useState<AdaptiveMappingPreview | null>(null);
  const familyGroups = session.groups.filter((item) => family.group_ids.includes(item.id));
  const [sampleGroupId, setSampleGroupId] = useState(familyGroups[0]?.id ?? "");
  const group = familyGroups.find((item) => item.id === sampleGroupId) ?? familyGroups[0];
  const analysis = asObject(asObject(group?.profile_resolution).analysis);
  const candidates = asObject(analysis.mapping_candidates);
  const previewMutation = useMutation({ mutationFn: () => previewAdaptiveFamilyMapping(session.import_id, family.id, { profileName, mappingSpec: mapping, sampleGroupId }), onSuccess: setPreview });
  const saveMutation = useMutation({ mutationFn: () => saveAdaptiveFamilyMapping(session.import_id, family.id, { profileName, mappingSpec: mapping }), onSuccess: onSession });
  function update(next: MappingSpec) { setMapping(next); setPreview(null); }
  return (
    <section className="flex min-h-[680px] flex-col" aria-labelledby="mapping-workspace-title">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ui pb-4">
        <div><button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" />返回导入概览</button><h3 id="mapping-workspace-title" className="text-lg font-semibold text-primary">{family.resolution_status === "DRIFTED" ? "修复导入格式" : "设置新的导入格式"}</h3><p className="mt-1 text-sm text-secondary">此设置会应用于当前结构的 {family.group_count} 个对话。</p></div>
        <div className="flex items-end gap-3">
          {familyGroups.length > 1 ? <label className="text-xs font-medium text-secondary">示例对话<select value={sampleGroupId} onChange={(event) => { setSampleGroupId(event.target.value); setPreview(null); }} className="mt-1 block h-9 max-w-56 rounded-md border border-ui bg-surface px-2 text-sm text-primary" aria-label="切换当前结构的示例对话">{familyGroups.map((item, index) => <option key={item.id} value={item.id}>{index + 1} / {familyGroups.length} · {item.display_name}</option>)}</select></label> : <p className="text-xs text-secondary">示例：{group?.display_name ?? "当前文件"}</p>}
          <ResolutionBadge status={family.resolution_status} />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(230px,.75fr)_minmax(360px,1.1fr)_minmax(300px,.9fr)]">
        <SourceStructurePane family={family} group={group} candidates={candidates} />
        <div className="border-ui py-5 lg:border-x lg:px-5"><h4 className="text-sm font-semibold text-primary">规范字段映射</h4><p className="mt-1 text-xs leading-5 text-secondary">只保存结构、字段映射与角色字典，不保存示例正文。</p><div className="mt-5 space-y-5">
          {family.source_mode === "JSON" ? <JsonMappingForm mapping={mapping} candidates={candidates} onChange={update} /> : null}
          {family.source_mode === "MARKDOWN" ? <MarkdownMappingForm mapping={mapping} candidates={candidates} onChange={update} /> : null}
          {family.source_mode === "JSON_MARKDOWN" ? <PairedMappingForm mapping={mapping} candidates={candidates} onChange={update} /> : null}
          <label className="block text-xs font-semibold text-secondary">保存为导入格式<input value={profileName} onChange={(event) => { setProfileName(event.target.value); setPreview(null); }} className="mt-1 h-10 w-full rounded-md border border-ui bg-surface px-3 text-sm text-primary" /></label>
        </div></div>
        <CanonicalPreviewPane preview={preview} loading={previewMutation.isPending} />
      </div>
      {previewMutation.isError ? <ErrorLine message={previewMutation.error.message} /> : null}
      {saveMutation.isError ? <ErrorLine message={saveMutation.error.message} /> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ui pt-4"><p className="text-xs text-secondary">验证会运行此格式的全部 {family.group_count} 个对话，不只检查示例。</p><div className="flex gap-2"><button type="button" disabled={previewMutation.isPending || !profileName.trim()} onClick={() => previewMutation.mutate()} className="btn-secondary min-h-10 px-4 text-sm font-medium">{previewMutation.isPending ? "正在验证" : "验证映射"}</button><button type="button" disabled={!preview?.validation.valid || saveMutation.isPending || !profileName.trim()} onClick={() => saveMutation.mutate()} className="btn-primary min-h-10 px-4 text-sm font-medium">{saveMutation.isPending ? "正在保存" : family.resolution_status === "DRIFTED" ? "保存新版本并继续" : "保存映射并继续"}</button></div></footer>
    </section>
  );
}

function SourceStructurePane({ family, group, candidates }: { family: AdaptiveImportFamily; group?: AdaptiveImportGroup; candidates: Record<string, unknown> }) {
  const jsonCandidates = asArray(candidates.message_locators).length
    ? asArray(candidates.message_locators).map(asObject).map((item) => String(item.locator))
    : asArray(asObject(candidates.json).message_locators).map(asObject).map((item) => String(item.locator));
  const markdownCandidates = asArray(candidates.boundaries).length
    ? asArray(candidates.boundaries).map(asObject)
    : asArray(asObject(candidates.markdown).boundaries).map(asObject);
  const count = jsonCandidates.length + markdownCandidates.length;
  return <aside id="mapping-source-structure" tabIndex={-1} className="py-5 outline-none lg:pr-5" aria-label="来源结构"><h4 className="text-sm font-semibold text-primary">来源结构</h4><p className="mt-1 text-xs text-secondary">{modeLabel(family.source_mode)}</p><div className="mt-4 space-y-2">{group?.files.map((file) => <div key={file.artifact_id} className="flex items-start gap-2 border-l-2 border-ui pl-3"><FormatIcon mode={file.extension.includes("md") ? "MARKDOWN" : "JSON"} /><div className="min-w-0"><p className="truncate text-sm font-medium text-primary" title={file.filename}>{file.filename}</p><p className="text-xs text-secondary">{formatBytes(file.byte_size)}</p></div></div>)}</div><div className="mt-5 border-t border-ui pt-4"><p className="text-xs font-semibold text-secondary">结构分析</p><p className="mt-2 text-xs leading-5 text-secondary">{count} 个候选结构。点击诊断可定位到对应字段。</p>{count ? <ul className="mt-3 space-y-1.5 text-xs text-primary">{jsonCandidates.map((locator) => <li key={`json-${locator}`} className="break-all rounded bg-subtle px-2 py-1.5 font-mono">{locator}</li>)}{markdownCandidates.map((item, index) => <li key={`markdown-${index}`} className="rounded bg-subtle px-2 py-1.5">{boundaryLabel(item)}</li>)}</ul> : null}</div>{family.diagnostics.length ? <div className="mt-5 space-y-2">{family.diagnostics.map((diagnostic) => <DiagnosticLine key={`${diagnostic.code}-${diagnostic.pointer ?? ""}`} diagnostic={diagnostic} />)}</div> : null}</aside>;
}

function JsonMappingForm({ mapping, candidates, onChange }: FormProps) {
  const options = asArray(candidates.message_locators).map(asObject);
  const messages = asObject(mapping.messages);
  const conversation = asObject(mapping.conversation);
  const currentLocator = String(messages.locator ?? "");
  function chooseLocator(locator: string) {
    const candidate = options.find((item) => String(item.locator) === locator) ?? {};
    onChange({ ...mapping, conversation: { ...conversation, title: candidate.title ?? conversation.title ?? null }, messages: { locator, role: candidate.role ?? null, content: candidate.content ?? null, external_id: candidate.external_id ?? null, timestamp: candidate.timestamp ?? null }, role_mapping: roleSuggestions(candidate.role_values) });
  }
  const current = options.find((item) => String(item.locator) === currentLocator);
  return <section className="space-y-4" aria-label="JSON 字段映射"><MappingSelect id="mapping-message-locator" label="消息列表" value={currentLocator} options={options.map((item) => ({ value: String(item.locator), label: String(item.locator) }))} onChange={chooseLocator} /><ReadOnlyMapping label="角色来源" value={String(messages.role ?? "未设置")} /><ReadOnlyMapping label="正文来源" value={String(messages.content ?? "未设置")} /><ReadOnlyMapping label="标题来源" value={String(conversation.title ?? "使用文件名")} /><RoleMappingEditor mapping={mapping} values={asArray(current?.role_values).map(String)} onChange={onChange} /></section>;
}

function MarkdownMappingForm({ mapping, candidates, onChange }: FormProps) {
  const options = asArray(candidates.boundaries).map(asObject);
  const messages = asObject(mapping.messages);
  const boundary = asObject(messages.boundary);
  const selected = options.find((item) => String(item.kind) === String(boundary.kind) && String(item.level ?? "") === String(boundary.level ?? ""));
  const preamble = String(asArray(mapping.noise_rules).map(asObject).find((item) => item.region === "PREAMBLE")?.action ?? "IGNORE");
  function chooseBoundary(value: string) {
    const [kind, level] = value.split(":");
    const item = options.find((option) => String(option.kind) === kind && String(option.level ?? "") === level);
    onChange({ ...mapping, messages: { ...messages, boundary: { kind, level: level ? Number(level) : null } }, role_mapping: roleSuggestions(Object.keys(asObject(item?.roles))) });
  }
  return <section className="space-y-4" aria-label="Markdown 字段映射"><MappingSelect id="mapping-message-boundary" label="消息分界" value={`${String(boundary.kind ?? "")}:${String(boundary.level ?? "")}`} options={options.map((item) => ({ value: `${String(item.kind)}:${String(item.level ?? "")}`, label: item.kind === "HEADING" ? `H${String(item.level)} 角色标题` : "角色标签行" }))} onChange={chooseBoundary} /><RoleMappingEditor mapping={mapping} values={Object.keys(asObject(selected?.roles))} onChange={onChange} /><div><p className="mb-1 text-xs font-semibold text-secondary">Markdown 前置内容</p><div className="grid grid-cols-2 rounded-lg bg-subtle p-1"><Segment active={preamble === "IGNORE"} onClick={() => onChange({ ...mapping, noise_rules: [{ region: "PREAMBLE", action: "IGNORE" }] })}>忽略并提示</Segment><Segment active={preamble === "KEEP"} onClick={() => onChange({ ...mapping, noise_rules: [{ region: "PREAMBLE", action: "KEEP" }] })}>保留到首条</Segment></div></div></section>;
}

function PairedMappingForm({ mapping, candidates, onChange }: FormProps) {
  const json = asObject(mapping.json); const markdown = asObject(mapping.markdown); const relation = asObject(mapping.relation);
  return <section className="space-y-6" aria-label="JSON 与 Markdown 字段映射"><div><p className="mb-3 text-xs font-semibold text-secondary">JSON 来源</p><JsonMappingForm mapping={json} candidates={asObject(candidates.json)} onChange={(next) => onChange({ ...mapping, json: next })} /></div><div className="border-t border-ui pt-5"><p className="mb-3 text-xs font-semibold text-secondary">Markdown 来源</p><MarkdownMappingForm mapping={markdown} candidates={asObject(candidates.markdown)} onChange={(next) => onChange({ ...mapping, markdown: next })} /></div><div id="mapping-relation" tabIndex={-1} className="border-t border-ui pt-5 outline-none"><p className="mb-2 text-xs font-semibold text-secondary">JSON 与 Markdown 对应关系</p><div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{["ORDER", "ID", "ROLE_TIMESTAMP"].map((value) => <Segment key={value} active={relation.type === value} onClick={() => onChange({ ...mapping, relation: { ...relation, type: value } })}>{value === "ROLE_TIMESTAMP" ? "角色 + 时间" : value === "ORDER" ? "顺序" : "ID"}</Segment>)}</div><p className="mt-2 text-xs leading-5 text-secondary">默认使用 Markdown 正文、JSON 角色和时间。完整文件组合必须通过关系校验。</p></div></section>;
}

function RoleMappingEditor({ mapping, values, onChange }: { mapping: MappingSpec; values: string[]; onChange: (mapping: MappingSpec) => void }) {
  const roleMapping = asObject(mapping.role_mapping); const observed = values.length ? values : Object.keys(roleMapping);
  return <div id="mapping-role-values" tabIndex={-1} className="outline-none"><p className="mb-2 text-xs font-semibold text-secondary">角色值</p><div className="space-y-2">{observed.map((value) => <label key={value} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3 text-xs text-secondary"><span className="truncate rounded bg-subtle px-2 py-2 font-mono" title={value}>{value}</span><select value={String(roleMapping[value] ?? roleMapping[value.toLowerCase()] ?? "")} onChange={(event) => onChange({ ...mapping, role_mapping: { ...roleMapping, [value]: event.target.value } })} className="h-9 rounded-md border border-ui bg-surface px-2 text-sm text-primary" aria-label={`${value} 对应的标准角色`}><option value="">需要确认</option>{["user", "assistant", "system", "developer", "tool"].map((role) => <option key={role} value={role}>{role}</option>)}</select></label>)}</div></div>;
}

function CanonicalPreviewPane({ preview, loading }: { preview: AdaptiveMappingPreview | null; loading: boolean }) {
  const issues = preview
    ? [...preview.validation.issues, ...preview.validation.groups.flatMap((group) => asArray(group.issues) as AdaptiveImportDiagnostic[])]
    : [];
  return <aside className="py-5 lg:pl-5" aria-label="导入预览"><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-primary">导入预览</h4>{preview ? preview.validation.valid ? <span className="inline-flex items-center gap-1 text-xs font-medium text-accent"><Check className="h-3.5 w-3.5" />全部对话通过</span> : <span className="text-xs font-medium text-[var(--danger)]">验证失败</span> : null}</div>{loading ? <div className="mt-6 flex items-center gap-2 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin" />正在验证所有对话</div> : null}{!loading && !preview ? <div className="mt-6 border-l-2 border-ui pl-3 text-sm leading-6 text-secondary">确认字段后运行“验证映射”，这里会显示 Chat Reader 实际将要导入的对话。</div> : null}{preview?.preview ? <div className="mt-4"><h5 className="text-sm font-semibold text-primary">{preview.preview.title}</h5><p className="mt-1 text-xs text-secondary">{preview.preview.message_count} 条消息</p><div className="mt-4 divide-y divide-ui border-y border-ui">{preview.preview.messages.map((message, index) => <div key={index} className="py-3"><p className="text-xs font-semibold text-secondary">{roleLabel(message.role)}</p><p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-primary">{message.content}</p></div>)}</div></div> : null}{preview && !preview.validation.valid ? <div className="mt-4 space-y-2">{issues.map((issue, index) => <DiagnosticLine key={`${issue.code}-${issue.pointer ?? ""}-${index}`} diagnostic={issue} />)}</div> : null}</aside>;
}

type FormProps = { mapping: MappingSpec; candidates: Record<string, unknown>; onChange: (mapping: MappingSpec) => void };
function MappingSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <label htmlFor={id} className="block text-xs font-semibold text-secondary">{label}<select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-ui bg-surface px-3 font-mono text-xs text-primary">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function ReadOnlyMapping({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-semibold text-secondary">{label}</p><p className="mt-1 rounded-md bg-subtle px-3 py-2 font-mono text-xs text-primary">{value}</p></div>; }
function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-9 rounded-md px-2 text-xs ${active ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary hover:text-primary"}`}>{children}</button>; }
function ErrorLine({ message }: { message: string }) { return <div role="alert" className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</div>; }
function suggestedProfileName(family: AdaptiveImportFamily): string { return family.source_mode === "JSON_MARKDOWN" ? "自定义 JSON + Markdown" : family.source_mode === "MARKDOWN" ? "自定义 Markdown" : "自定义 JSON"; }
function roleLabel(role: string): string { return role === "user" ? "你" : role === "assistant" ? "ChatGPT" : role; }
function roleSuggestions(values: unknown): Record<string, string> { const aliases: Record<string, string> = { user: "user", human: "user", you: "user", prompt: "user", "我": "user", "用户": "user", assistant: "assistant", ai: "assistant", chatgpt: "assistant", response: "assistant", "助手": "assistant", system: "system", developer: "developer", tool: "tool" }; return asArray(values).reduce<Record<string, string>>((result, value) => { const source = String(value); if (aliases[source.toLowerCase()]) result[source] = aliases[source.toLowerCase()]; return result; }, {}); }
function boundaryLabel(item: Record<string, unknown>): string { return item.kind === "HEADING" ? `H${String(item.level)} 角色标题` : "角色标签行"; }
