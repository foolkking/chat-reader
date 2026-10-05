"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminApi, type SystemSkill } from "../lib/admin-client";
import { SkillBundleFiles } from "./skill-bundle-files";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";

export function AdminSkillSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const { confirm } = useInteractionDialog();
  const [dirtyMembers, setDirtyMembers] = useState<Record<string, boolean>>({});
  const [busyMembers, setBusyMembers] = useState<Record<string, boolean>>({});
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-system-skills"], queryFn: adminApi.systemSkills });
  const refresh = async () => {
    await Promise.all(["admin-system-skills", "skills", "resolved-skill"].map(queryKey => client.invalidateQueries({ queryKey: [queryKey] })));
  };
  const changeDefault = useMutation({ mutationFn: (item: SystemSkill) => adminApi.updateSystemSkill(item.id, { default_enabled: true, base_revision: item.bundle_revision ?? 0 }), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (id: string) => adminApi.restoreSystemSkill(id), onSuccess: refresh });
  const dirty = Object.values(dirtyMembers).some(Boolean);
  const busy = changeDefault.isPending || restore.isPending || Object.values(busyMembers).some(Boolean);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  return <section className="space-y-3">
    {query.isPending ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {query.isError ? <button type="button" onClick={() => void query.refetch()}>{zh ? "读取失败，重试" : "Could not load; retry"}</button> : null}
    {query.data?.map(item => <article key={item.id} className="border-b border-ui py-4 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-primary">{({ EXPORT_CONTEXT: zh ? "接续上下文" : "Context acquisition", CONVERSATION_RESCUE: zh ? "转换格式" : "Format conversion", CONTEXT_MAINTENANCE: zh ? "维护上下文" : "Context maintenance" })[item.category]}</h4>
          <p className="mt-1 break-words text-xs text-secondary">{item.is_customized || item.source_kind !== "BUNDLED" ? item.name : ({ EXPORT_CONTEXT: "context-acquisition.zip", CONVERSATION_RESCUE: "chat-transcript-normalizer-skill.zip", CONTEXT_MAINTENANCE: "context-continuation-maintainer.zip" })[item.category]}</p>
        </div>
        {item.bundle_url ? <a href={item.bundle_url} download className="inline-flex min-h-11 items-center text-sm text-accent">{zh ? "下载 Skill ZIP" : "Download Skill ZIP"}</a> : null}
      </div>
      {item.legacy_default_conflict ? <div className="mt-2 text-sm text-secondary"><p>{zh ? "这个用途曾保存不同的默认文件，请选择统一使用哪一份。" : "Different default files were previously saved for this purpose. Choose which one to use."}</p><button type="button" disabled={busy || dirty} className="min-h-11 text-accent" onClick={() => changeDefault.mutate(item)}>{zh ? "统一使用此文件" : "Use this file for everyone"}</button></div> : null}
      <SkillBundleFiles system skill={{ ...item, source: "SYSTEM", is_selected: item.default_enabled, content_url: item.builtin_content_url }}
        onSaved={refresh}
        onBusyChange={value => setBusyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })}
        onDirtyChange={value => setDirtyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })} />
      {item.source_kind === "BUNDLED" && item.is_customized ? <button type="button" disabled={busy || dirty} className="min-h-11 text-xs text-secondary" onClick={async () => {
        if (await confirm({ title: zh ? "恢复内置 Skill？" : "Restore the built-in Skill?", description: zh ? "将恢复这个用途的系统文件。用户自己的 Skill 和首选保持不变。" : "Restore the system file for this purpose. Personal Skills and preferences stay unchanged." })) restore.mutate(item.id);
      }}>{zh ? "恢复内置" : "Restore built-in"}</button> : null}
    </article>)}
    {changeDefault.error || restore.error ? <p role="alert" className="text-sm text-[var(--danger)]">{(changeDefault.error ?? restore.error)?.message}</p> : null}
  </section>;
}
