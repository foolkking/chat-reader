"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AdminRequestError, adminApi, type SystemSkill } from "../lib/admin-client";
import { SkillBundleFiles } from "./skill-bundle-files";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

export function AdminSkillSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const [dirtyMembers, setDirtyMembers] = useState<Record<string, boolean>>({});
  const [busyMembers, setBusyMembers] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<"default" | "restore" | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const mounted = useRef(false);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-system-skills"], queryFn: ({ signal }) => adminApi.systemSkills(signal), retry: false });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refresh = async () => {
    setRefreshError(false);
    try {
      await Promise.all(["admin-system-skills", "skills", "resolved-skill"].map(queryKey => client.invalidateQueries({ queryKey: [queryKey] })));
    } catch {
      if (mounted.current) setRefreshError(true);
    }
  };
  const changeDefault = useMutation({
    mutationFn: (item: SystemSkill) => adminApi.updateSystemSkill(item.id, { default_enabled: true, base_revision: item.bundle_revision ?? 0 }),
    onSuccess: () => {
      if (mounted.current) { setNotice("default"); setRefreshError(false); }
      void refresh();
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => adminApi.restoreSystemSkill(id),
    onSuccess: () => {
      if (mounted.current) { setNotice("restore"); setRefreshError(false); }
      void refresh();
    },
  });
  const dirty = Object.values(dirtyMembers).some(Boolean);
  const busy = changeDefault.isPending || restore.isPending || Object.values(busyMembers).some(Boolean);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (notice && query.isError) setRefreshError(true);
  }, [notice, query.isError]);
  const clearActionFeedback = () => {
    changeDefault.reset();
    restore.reset();
    setNotice(null);
    setRefreshError(false);
  };
  const runChangeDefault = (item: SystemSkill) => {
    clearActionFeedback();
    changeDefault.mutate(item);
  };
  const runRestore = (id: string) => {
    clearActionFeedback();
    restore.mutate(id);
  };
  return <section className="space-y-3">
    {query.isPending ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {query.isError ? <div role="alert" className="text-sm text-[var(--danger)]"><p>{zh ? "系统 Skill 列表读取失败，已确认的操作仍然有效。" : "The system Skill list could not load. Confirmed changes still apply."}</p><button type="button" disabled={query.isFetching} className="btn-secondary mt-2 min-h-11 px-3 text-xs" onClick={() => void query.refetch()}>{zh ? "读取失败，重试" : "Could not load; retry"}</button></div> : null}
    {query.data?.map(item => <article key={item.id} className="border-b border-ui py-4 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-primary">{({ EXPORT_CONTEXT: zh ? "接续上下文" : "Context acquisition", CONVERSATION_RESCUE: zh ? "转换格式" : "Format conversion", CONTEXT_MAINTENANCE: zh ? "维护上下文" : "Context maintenance" })[item.category]}</h4>
          <p className="mt-1 break-words text-xs text-secondary">{item.is_customized || item.source_kind !== "BUNDLED" ? item.name : ({ EXPORT_CONTEXT: "context-acquisition.zip", CONVERSATION_RESCUE: "chat-transcript-normalizer-skill.zip", CONTEXT_MAINTENANCE: "context-continuation-maintainer.zip" })[item.category]}</p>
        </div>
        {item.bundle_url ? <a href={item.bundle_url} download className="inline-flex min-h-11 items-center text-sm text-accent">{zh ? "下载 Skill ZIP" : "Download Skill ZIP"}</a> : null}
      </div>
      {item.legacy_default_conflict ? <div className="mt-2 text-sm text-secondary"><p>{zh ? "这个用途曾保存不同的默认文件，请选择统一使用哪一份。" : "Different default files were previously saved for this purpose. Choose which one to use."}</p><button type="button" disabled={busy || dirty} className="min-h-11 text-accent" onClick={() => runChangeDefault(item)}>{zh ? "统一使用此文件" : "Use this file for everyone"}</button></div> : null}
      <SkillBundleFiles system skill={{ ...item, source: "SYSTEM", is_selected: item.default_enabled, content_url: item.builtin_content_url }}
        onBusyChange={value => setBusyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })}
        onDirtyChange={value => setDirtyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })} />
      {item.source_kind === "BUNDLED" && item.is_customized ? <button type="button" disabled={busy || dirty} className="min-h-11 text-xs text-secondary" onClick={async () => {
        if (await confirm({ title: zh ? "恢复内置 Skill？" : "Restore the built-in Skill?", description: zh ? "将恢复这个用途的系统文件。用户自己的 Skill 和首选保持不变。" : "Restore the system file for this purpose. Personal Skills and preferences stay unchanged." })) runRestore(item.id);
      }}>{zh ? "恢复内置" : "Restore built-in"}</button> : null}
    </article>)}
    {notice ? <p role="status" className="text-sm text-accent">{notice === "default"
      ? (zh ? "系统默认已统一；正在更新列表。" : "The system default was unified; updating the list.")
      : (zh ? "内置 Skill 已恢复；正在更新列表。" : "The built-in Skill was restored; updating the list.")}</p> : null}
    {refreshError ? <div role="alert" className="space-y-2 text-sm text-[var(--danger)]"><p>{zh ? "操作已完成，但 Skill 列表未能刷新；请重新读取核对。" : "The action completed, but the Skill list could not refresh. Reload it to verify."}</p><button type="button" disabled={busy || query.isFetching} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void refresh()}>{zh ? "重新读取列表" : "Reload Skill list"}</button></div> : null}
    {changeDefault.error || restore.error ? <p role="alert" className="text-sm text-[var(--danger)]">{adminSkillMutationError(changeDefault.error ?? restore.error, changeDefault.error ? "default" : "restore", zh)}</p> : null}
  </section>;
}

function adminSkillMutationError(error: unknown, action: "default" | "restore", zh: boolean): string {
  if (error instanceof AdminRequestError) {
    if (error.status === 401) return zh ? "管理员会话已失效，请重新登录后再试。" : "The administrator session expired. Sign in again, then retry.";
    if (error.status === 403) return zh ? "当前账户没有执行此管理员操作的权限。" : "This administrator account is not allowed to perform this action.";
    if (error.status === 404) return zh ? "这个系统 Skill 已不存在，请重新读取列表。" : "This system Skill is no longer available. Reload the list.";
    if (error.status === 409) return zh ? "系统 Skill 已被其他变更更新，请重新读取后再操作。" : "The system Skill changed elsewhere. Reload the list before continuing.";
    if (error.status === 413 || error.status === 422) return zh ? "系统 Skill 内容或版本不符合要求，请检查后重试。" : "The system Skill content or revision is not valid. Check it and retry.";
    if (error.status === 408 || error.status >= 500) return zh ? "服务暂时不可用，请稍后重试。" : "The service is temporarily unavailable. Try again shortly.";
    if (error.status === 429) return zh ? "操作过于频繁，请稍后重试。" : "Too many attempts. Try again shortly.";
  }
  return action === "restore"
    ? (zh ? "恢复结果尚未确认，请重新读取列表核对后再决定是否重试。" : "The restore result is not confirmed. Reload the list before deciding whether to retry.")
    : (zh ? "默认设置结果尚未确认，请重新读取列表核对后再决定是否重试。" : "The default-setting result is not confirmed. Reload the list before deciding whether to retry.");
}
