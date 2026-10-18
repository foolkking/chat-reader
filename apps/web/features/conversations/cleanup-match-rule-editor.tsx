"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CleanupRuleEditor } from "../../components/cleanup-rule-editor";
import { usePreferences } from "../../components/preferences-provider";
import { getCleanupRules, updateCleanupRule } from "../../lib/api";
import type { CleanupOccurrenceRead } from "../../lib/types";

export function CleanupMatchRuleEditor({ item, onDirtyChange, onDone }: {
  item: CleanupOccurrenceRead; onDirtyChange?: (dirty: boolean) => void; onDone: (saved: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const rules = useQuery({ queryKey: ["content-cleanup-rules"], queryFn: ({ signal }) => getCleanupRules({ signal }), staleTime: 0, retry: false });
  const rule = rules.data?.find(value => value.id === item.rule_id);
  const disable = useMutation({ mutationFn: () => updateCleanupRule(rule!.id, { status: "DISABLED", base_edit_token: rule!.edit_token ?? undefined }),
    onSuccess: () => onDone(true) });
  if (rules.isLoading) return <p role="status">{zh ? "正在读取规则，扫描结果保持不变…" : "Loading the rule; scan results remain unchanged…"}</p>;
  if (rules.isError || !rule) return <section className="space-y-3"><p role="alert">{zh ? "暂时无法读取当前规则；本次匹配仍使用下方显示的固定版本。" : "Cannot load the current rule. This match still uses its displayed pinned revision."}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void rules.refetch()}>{zh ? "重试" : "Retry"}</button><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => onDone(false)}>{zh ? "返回候选" : "Back to candidates"}</button></section>;
  const builtin = rule.kind === "BUILTIN";
  return <div className="space-y-3">
    <p className="text-xs leading-5 text-secondary">{zh ? `本结果由规则版本 ${item.rule_revision ?? "未知"} 生成；服务器当前版本 ${rule.revision}。保存规则不会修改旧结果或已有选择，需另行重扫原范围。` : `This result uses revision ${item.rule_revision ?? "unknown"}; current rule revision is ${rule.revision}. Saving does not modify old results or choices. Rescan the original scope separately.`}</p>
    {builtin ? <section className="space-y-2 border-l-2 border-ui pl-3 text-xs leading-5">
      <p>{zh ? "这是内置结构检测器。下面根据命中文本创建个人字面规则，并不复制内置算法，也不会默认停用原规则。" : "This is a built-in structural detector. The editor creates a personal literal rule from the sample, not a copy of its algorithm. The built-in rule is not disabled automatically."}</p>
      <button type="button" disabled={disable.isPending || rule.status === "DISABLED"} className="btn-secondary min-h-11 px-3" onClick={() => disable.mutate()}>{zh ? "仅为我的账户停用此内置规则" : "Disable this built-in rule for my account"}</button>
      {disable.isError ? <p role="alert">{zh ? "停用结果未确认，请返回后刷新规则状态再操作。" : "Disable result is unconfirmed. Reload the saved rule state before retrying."}</p> : null}
    </section> : null}
    <CleanupRuleEditor key={`${rule.id}:${rule.revision_id}`} rule={builtin ? undefined : rule}
      initialText={builtin ? item.match_text : ""} initialRole={item.role} conversationId={item.conversation_id}
      onDirtyChange={onDirtyChange} onDone={onDone} />
  </div>;
}
