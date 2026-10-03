"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { replaceSkillBundle } from "../lib/api";
import type { SkillRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

export function SkillBundleFiles({ skill, onDirtyChange, system = false, onSaved, onBusyChange }: { skill: SkillRead; onDirtyChange?: (dirty: boolean) => void; system?: boolean; onSaved?: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [base, setBase] = useState(skill.bundle_revision ?? 0);
  const client = useQueryClient();
  const replace = useMutation({ mutationFn: () => {
    if (!file || !/\.(zip|md)$/i.test(file.name)) throw new Error(zh ? "请选择 Skill ZIP 或 Markdown。" : "Choose a Skill ZIP or Markdown.");
    return replaceSkillBundle(skill.id, base, file, system);
  }, onSuccess: async () => {
    setFile(null); if (input.current) input.current.value = "";
    await client.invalidateQueries({ queryKey: ["skills"] });
    await client.invalidateQueries({ queryKey: ["resolved-skill"] });
    await onSaved?.();
  } });
  useEffect(() => { onDirtyChange?.(Boolean(file)); }, [file, onDirtyChange]);
  useEffect(() => { onBusyChange?.(replace.isPending); }, [replace.isPending, onBusyChange]);
  return <div className="mt-3 space-y-2 border-t border-ui pt-3">
    <button type="button" disabled={replace.isPending} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => input.current?.click()}>{zh ? "替换文件" : "Replace file"}</button>
    <input ref={input} type="file" accept=".zip,.md" aria-label={zh ? "替换 Skill ZIP / Markdown" : "Replace Skill ZIP / Markdown"} disabled={replace.isPending} hidden onChange={event => { setFile(event.target.files?.[0] ?? null); setBase(skill.bundle_revision ?? 0); replace.reset(); }} />
    {file ? <p className="break-all text-xs text-secondary">{file.name}</p> : null}
    {file ? <button type="button" disabled={replace.isPending} className="btn-secondary min-h-9 px-3 text-xs" onClick={() => replace.mutate()}>{replace.isPending ? (zh ? "正在替换…" : "Replacing…") : (zh ? "确认替换" : "Replace")}</button> : null}
    {file ? <button type="button" disabled={replace.isPending} className="min-h-9 px-3 text-xs" onClick={() => { setFile(null); if (input.current) input.current.value = ""; replace.reset(); }}>{zh ? "取消替换" : "Discard replacement"}</button> : null}
    {replace.error ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "替换失败，文件已保留。请刷新后重选文件并重试。" : "Replacement failed. Your file is retained. Reload, reselect it and retry."}</p> : null}
    {replace.isSuccess ? <p role="status" className="text-xs text-accent">{zh ? "已替换" : "Replaced"}</p> : null}
  </div>;
}
