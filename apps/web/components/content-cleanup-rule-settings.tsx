"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  createCleanupRule,
  deleteCleanupRule,
  getCleanupRules,
  getPendingCleanupScans,
  scanExistingConversations,
  updateCleanupRule,
} from "../lib/api";
import { cleanupRuleLabel } from "../lib/content-cleanup";
import type { CleanupRuleRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

export function ContentCleanupRuleSettings({
  embedded = false,
  onBack,
}: {
  embedded?: boolean;
  onBack?: () => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ["content-cleanup-rules"],
    queryFn: getCleanupRules,
    staleTime: 30_000,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [matchValue, setMatchValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [matcherMode, setMatcherMode] = useState<
    "EXACT" | "NORMALIZED" | "APPROXIMATE"
  >("EXACT");
  const [boundaryMode, setBoundaryMode] = useState<
    "ANYWHERE" | "WHOLE_LINE" | "BLOCK_END"
  >("ANYWHERE");
  const [confirmScan, setConfirmScan] = useState(false);
  const pendingScansQuery = useQuery({
    queryKey: ["content-cleanup-pending"],
    queryFn: getPendingCleanupScans,
    refetchInterval: 5_000,
  });
  const scanMutation = useMutation({
    mutationFn: scanExistingConversations,
    onSuccess: () => {
      setConfirmScan(false);
      void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
    },
  });
  const invalidate = () =>
    void client.invalidateQueries({ queryKey: ["content-cleanup-rules"] });
  const createMutation = useMutation({
    mutationFn: () =>
      createCleanupRule({
        name: name.trim(),
        match_value: matchValue,
        case_sensitive: caseSensitive,
        role_filter: roleFilter || null,
        matcher_mode: matcherMode,
        boundary_mode: boundaryMode,
      }),
    onSuccess: () => {
      setName("");
      setMatchValue("");
      setCaseSensitive(true);
      setRoleFilter("");
      setMatcherMode("EXACT");
      setBoundaryMode("ANYWHERE");
      setShowCreate(false);
      invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      status?: "ACTIVE" | "DISABLED";
      matcher_mode?: "EXACT" | "NORMALIZED" | "APPROXIMATE";
      boundary_mode?: "ANYWHERE" | "WHOLE_LINE" | "BLOCK_END";
    }) =>
      updateCleanupRule(input.id, {
        name: input.name,
        status: input.status,
        matcher_mode: input.matcher_mode,
        boundary_mode: input.boundary_mode,
      }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCleanupRule,
    onSuccess: invalidate,
  });
  const rules = rulesQuery.data ?? [];
  const builtInRules = useMemo(
    () => rules.filter((rule) => rule.kind === "BUILTIN"),
    [rules],
  );
  const userRules = useMemo(
    () => rules.filter((rule) => rule.kind !== "BUILTIN"),
    [rules],
  );

  return (
    <section
      className={
        embedded ? "min-h-0" : "rounded-xl border border-ui bg-surface p-4"
      }
      aria-label={zh ? "噪声规则库" : "Noise rule library"}
    >
      <header className="flex items-start gap-3 border-b border-ui pb-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle"
            aria-label={zh ? "返回清理审查" : "Back to cleanup review"}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {!embedded ? (
            <h3 className="text-base font-semibold text-primary">
              {zh ? "噪声规则库" : "Noise rule library"}
            </h3>
          ) : null}
          <p
            className={`${embedded ? "" : "mt-1"} text-xs leading-5 text-secondary`}
          >
            {zh
              ? "内置检测器不可删除；自定义规则支持精确、规范化和受限近似识别。规则从不跳过审查直接修改正文。"
              : "Built-ins cannot be deleted. Custom rules support exact, normalized, and bounded approximate detection. Rules never edit content without review."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle"
          aria-expanded={showCreate}
        >
          {showCreate ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {showCreate ? (zh ? "取消" : "Cancel") : zh ? "新建规则" : "New rule"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmScan(true)}
          disabled={scanMutation.isPending}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--text)] px-3 text-xs font-medium text-[var(--surface)] disabled:opacity-50"
        >
          {scanMutation.isPending
            ? zh ? "正在排队…" : "Queuing…"
            : zh ? "扫描现有对话" : "Scan existing conversations"}
        </button>
      </header>
      {confirmScan ? (
        <div className="mt-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4 text-sm text-primary">
          <p className="font-medium">{zh ? "扫描现有对话" : "Scan existing conversations"}</p>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {zh
              ? "将使用当前启用的规则扫描项目内和未分类的活动对话。归档对话不会处理。扫描只生成候选，不会自动修改正文。"
              : "Enabled rules will scan active project and unclassified conversations. Archived conversations are excluded. The scan only creates review candidates and never edits content automatically."}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmScan(false)} className="min-h-9 rounded-lg border border-ui px-3 text-xs text-secondary hover:bg-subtle">
              {zh ? "取消" : "Cancel"}
            </button>
            <button type="button" onClick={() => scanMutation.mutate()} className="min-h-9 rounded-lg bg-[var(--text)] px-3 text-xs font-medium text-[var(--surface)]">
              {zh ? "开始后台扫描" : "Start background scan"}
            </button>
          </div>
          {scanMutation.isError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{scanMutation.error.message}</p> : null}
        </div>
      ) : null}
      {pendingScansQuery.data?.some((scan) => scan.source === "BATCH" && ["QUEUED", "SCANNING"].includes(scan.status)) ? (
        <p className="mt-3 text-xs text-secondary">{zh ? "已有全库扫描在后台运行，前台可以继续使用。" : "An existing-conversation scan is running in the background."}</p>
      ) : null}

      {showCreate ? (
        <div className="border-b border-ui py-4">
          <h4 className="text-sm font-semibold text-primary">
            {zh ? "新增文本规则" : "Add a text rule"}
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-secondary">
              {zh ? "规则名称" : "Rule name"}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--focus)]"
              />
            </label>
            <label className="text-xs font-medium text-secondary">
              {zh ? "匹配角色" : "Message role"}
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary outline-none focus:border-[var(--focus)]"
              >
                <option value="">{zh ? "全部消息" : "All messages"}</option>
                <option value="user">{zh ? "我" : "You"}</option>
                <option value="assistant">ChatGPT</option>
                <option value="system">System</option>
                <option value="tool">Tool</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs font-medium text-secondary">
            {zh ? "需要识别的完整文本" : "Exact text to detect"}
            <textarea
              value={matchValue}
              onChange={(event) => setMatchValue(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-ui bg-page px-3 py-2 text-sm leading-6 text-primary outline-none focus:border-[var(--focus)]"
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-secondary">
            {zh ? "识别方式" : "Detection mode"}
            <select
              value={matcherMode}
              onChange={(event) =>
                setMatcherMode(event.target.value as typeof matcherMode)
              }
              className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary"
            >
              <option value="EXACT">{zh ? "精确匹配" : "Exact match"}</option>
              <option value="NORMALIZED">
                {zh ? "规范化匹配" : "Normalized text"}
              </option>
              <option value="APPROXIMATE">
                {zh
                  ? "近似建议（仅提示）"
                  : "Approximate suggestion (review only)"}
              </option>
            </select>
            <span className="mt-1 block text-[11px] font-normal leading-5 text-secondary">
              {zh
                ? "近似识别会把所有候选交给你逐项确认，不会自动处理。"
                : "Approximate matching shows every candidate for explicit review."}
            </span>
          </label>
          <label className="mt-3 block text-xs font-medium text-secondary">
            {zh ? "出现位置" : "Text boundary"}
            <select
              value={boundaryMode}
              onChange={(event) =>
                setBoundaryMode(event.target.value as typeof boundaryMode)
              }
              className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-page px-3 text-sm text-primary"
            >
              <option value="ANYWHERE">
                {zh ? "消息任意位置" : "Anywhere"}
              </option>
              <option value="WHOLE_LINE">
                {zh ? "独占一行" : "Whole line"}
              </option>
              <option value="BLOCK_END">
                {zh ? "消息末尾" : "End of message"}
              </option>
            </select>
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-9 items-center gap-2 text-xs text-secondary">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {zh ? "区分大小写" : "Case-sensitive"}
            </label>
            <button
              type="button"
              disabled={
                !name.trim() ||
                !matchValue.trim() ||
                (matcherMode === "APPROXIMATE" &&
                  matchValue.trim().length < 6) ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--text)] px-3 text-xs font-medium text-[var(--surface)] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {createMutation.isPending
                ? zh
                  ? "正在保存…"
                  : "Saving…"
                : zh
                  ? "保存规则"
                  : "Save rule"}
            </button>
          </div>
          {createMutation.isError ? (
            <p className="mt-2 text-xs text-[var(--danger)]" role="alert">
              {createMutation.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {rulesQuery.isLoading ? (
        <p className="py-8 text-center text-sm text-secondary">
          {zh ? "正在加载规则…" : "Loading rules…"}
        </p>
      ) : null}
      {rulesQuery.isError ? (
        <p className="py-4 text-sm text-[var(--danger)]" role="alert">
          {rulesQuery.error.message}
        </p>
      ) : null}
      {!rulesQuery.isLoading && !rulesQuery.isError ? (
        <div className="space-y-5 py-4">
          <RuleSection
            title={zh ? "内置规则" : "Built-in rules"}
            count={builtInRules.length}
          >
            {builtInRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                zh={zh}
                onUpdate={(input) =>
                  updateMutation.mutate({ id: rule.id, ...input })
                }
              />
            ))}
          </RuleSection>
          <RuleSection
            title={zh ? "我的规则" : "My rules"}
            count={userRules.length}
            empty={zh ? "还没有自定义规则。" : "No custom rules yet."}
          >
            {userRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                zh={zh}
                deleting={
                  deleteMutation.isPending &&
                  deleteMutation.variables === rule.id
                }
                onUpdate={(input) =>
                  updateMutation.mutate({ id: rule.id, ...input })
                }
                onDelete={() => deleteMutation.mutate(rule.id)}
              />
            ))}
          </RuleSection>
          {deleteMutation.isError ? (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {deleteMutation.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RuleSection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold text-secondary">{title}</h4>
        <span className="text-[11px] text-secondary">{count}</span>
      </div>
      <div className="divide-y divide-ui border-y border-ui">
        {count ? (
          children
        ) : (
          <p className="py-4 text-xs leading-5 text-secondary">{empty}</p>
        )}
      </div>
    </section>
  );
}

function RuleRow({
  rule,
  zh,
  deleting = false,
  onUpdate,
  onDelete,
}: {
  rule: CleanupRuleRead;
  zh: boolean;
  deleting?: boolean;
  onUpdate: (input: {
    name?: string;
    status?: "ACTIVE" | "DISABLED";
    matcher_mode?: "EXACT" | "NORMALIZED" | "APPROXIMATE";
    boundary_mode?: "ANYWHERE" | "WHOLE_LINE" | "BLOCK_END";
  }) => void;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState(rule.name);
  return (
    <article className="py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-subtle"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-secondary transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
            {cleanupRuleLabel(rule.name, rule.detector_id, zh)}
          </span>
          <span
            className={`shrink-0 text-[11px] ${rule.status === "ACTIVE" ? "text-accent" : "text-secondary"}`}
          >
            {rule.status === "ACTIVE"
              ? zh
                ? "启用"
                : "Active"
              : zh
                ? "停用"
                : "Disabled"}
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdate({
              status: rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
            })
          }
          className="min-h-8 shrink-0 rounded-md px-2 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary"
        >
          {rule.status === "ACTIVE"
            ? zh
              ? "停用"
              : "Disable"
            : zh
              ? "启用"
              : "Enable"}
        </button>
      </div>
      {expanded ? (
        <div className="ml-6 mt-2 border-l border-ui pl-3">
          {rule.kind !== "BUILTIN" ? (
            <label className="block text-[11px] font-medium text-secondary">
              {zh ? "名称" : "Name"}
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => {
                  const next = draftName.trim();
                  if (next && next !== rule.name) onUpdate({ name: next });
                }}
                className="mt-1 min-h-9 w-full rounded-md border border-ui bg-page px-2 text-sm text-primary"
              />
            </label>
          ) : null}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-secondary">
            <dt>{zh ? "类型" : "Type"}</dt>
            <dd>
              {rule.kind === "BUILTIN"
                ? zh
                  ? "内置检测器"
                  : "Built-in detector"
                : cleanupMatcherLabel(rule.matcher_mode, zh)}
            </dd>
            {rule.kind !== "BUILTIN" ? (
              <>
                <dt>{zh ? "璇嗗埆" : "Detection"}</dt>
                <dd>
                  <select
                    value={rule.matcher_mode}
                    onChange={(event) =>
                      onUpdate({
                        matcher_mode: event.target.value as
                          | "EXACT"
                          | "NORMALIZED"
                          | "APPROXIMATE",
                      })
                    }
                    className="min-h-8 w-full rounded-md border border-ui bg-page px-2 text-xs text-primary"
                  >
                    <option value="EXACT">
                      {cleanupMatcherLabel("EXACT", zh)}
                    </option>
                    <option value="NORMALIZED">
                      {cleanupMatcherLabel("NORMALIZED", zh)}
                    </option>
                    <option value="APPROXIMATE">
                      {cleanupMatcherLabel("APPROXIMATE", zh)}
                    </option>
                  </select>
                </dd>
              </>
            ) : null}
            {rule.match_value ? (
              <>
                <dt>{zh ? "匹配" : "Match"}</dt>
                <dd className="break-words text-primary">{rule.match_value}</dd>
              </>
            ) : null}
            <dt>{zh ? "范围" : "Scope"}</dt>
            <dd>{rule.role_filter ?? (zh ? "全部消息" : "All messages")}</dd>
            <dt>{zh ? "位置" : "Boundary"}</dt>
            <dd>
              {rule.kind === "BUILTIN" ? (
                cleanupBoundaryLabel(rule.boundary_mode, zh)
              ) : (
                <select
                  value={rule.boundary_mode}
                  onChange={(event) =>
                    onUpdate({
                      boundary_mode: event.target.value as
                        | "ANYWHERE"
                        | "WHOLE_LINE"
                        | "BLOCK_END",
                    })
                  }
                  className="min-h-8 w-full rounded-md border border-ui bg-page px-2 text-xs text-primary"
                >
                  <option value="ANYWHERE">
                    {cleanupBoundaryLabel("ANYWHERE", zh)}
                  </option>
                  <option value="WHOLE_LINE">
                    {cleanupBoundaryLabel("WHOLE_LINE", zh)}
                  </option>
                  <option value="BLOCK_END">
                    {cleanupBoundaryLabel("BLOCK_END", zh)}
                  </option>
                </select>
              )}
            </dd>
            <dt>{zh ? "版本" : "Revision"}</dt>
            <dd>{rule.revision}</dd>
            <dt>{zh ? "最近命中" : "Last matched"}</dt>
            <dd>
              {rule.last_used_at
                ? new Date(rule.last_used_at).toLocaleString()
                : zh
                  ? "尚未命中"
                  : "Never"}
            </dd>
          </dl>
          {onDelete ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              {confirmDelete ? (
                <span className="text-[11px] text-[var(--danger)]">
                  {zh
                    ? "删除后不会恢复已处理的正文。"
                    : "This does not restore previously edited content."}
                </span>
              ) : null}
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  onDelete();
                }}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmDelete
                  ? zh
                    ? "确认删除"
                    : "Confirm delete"
                  : zh
                    ? "删除规则"
                    : "Delete rule"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function cleanupMatcherLabel(mode: string, zh: boolean): string {
  if (mode === "NORMALIZED") return zh ? "规范化文本" : "Normalized text";
  if (mode === "APPROXIMATE") return zh ? "近似建议" : "Approximate suggestion";
  return zh ? "精确文本" : "Exact text";
}

function cleanupBoundaryLabel(mode: string, zh: boolean): string {
  if (mode === "WHOLE_LINE") return zh ? "独占一行" : "Whole line";
  if (mode === "BLOCK_END") return zh ? "消息末尾" : "End of message";
  return zh ? "任意位置" : "Anywhere";
}
