"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, getSkill, getSkillRevisions, replaceSkillBundle } from "../lib/api";
import { adminApi } from "../lib/admin-client";
import { authenticationGeneration } from "../lib/offline-access";
import { acknowledgeSkillReplacement } from "../lib/skill-cache";
import type { SkillRead } from "../lib/types";
import { usePreferences } from "./preferences-provider";

export function SkillBundleFiles({ skill, onDirtyChange, system = false, onBusyChange }: { skill: SkillRead; onDirtyChange?: (dirty: boolean) => void; system?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null), recovery = useRef<HTMLButtonElement>(null), latestDownload = useRef<HTMLAnchorElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [base, setBase] = useState(skill.bundle_revision ?? 0);
  const [latest, setLatest] = useState<{ revision: number; url: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const latestRead = useRef<AbortController | null>(null);
  const alive = useRef(true), generation = useRef(authenticationGeneration());
  const active = () => alive.current && generation.current === authenticationGeneration();
  useEffect(() => { alive.current = true; return () => { alive.current = false; latestRead.current?.abort(); }; }, []);
  const client = useQueryClient();
  const replace = useMutation({ mutationFn: (revision: number) => {
    if (!file || !/\.(zip|md)$/i.test(file.name)) throw new ApiRequestError("Choose a Skill ZIP or Markdown.", 422, "");
    return replaceSkillBundle(skill.id, revision, file, system);
  }, onMutate: (revision) => { setBase(revision); latestRead.current?.abort(); setReading(false); setReadFailed(false); setLatest(null); },
  onSuccess: async (value) => {
    if (!active()) return;
    setBase(value.bundle_revision ?? 0); setFile(null); if (input.current) input.current.value = "";
    await acknowledgeSkillReplacement(client, value, active);
  } });
  const status = replace.error instanceof ApiRequestError ? replace.error.status : null;
  const conflict = status === 409 && /Skill changed/i.test(replace.error?.message ?? "");
  const retryable = !status || status >= 500 || status === 429;
  const busy = replace.isPending || reading;
  useEffect(() => { onDirtyChange?.(Boolean(file)); }, [file, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const target = replace.isSuccess ? choose.current : replace.isError && !reading ? (latest !== null ? latestDownload.current : recovery.current ?? choose.current) : null;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest" }); }
  }, [replace.isSuccess, replace.isError, reading, latest]);

  const readLatest = async () => {
    latestRead.current?.abort();
    const controller = new AbortController(); latestRead.current = controller;
    setReading(true); setReadFailed(false); setLatest(null);
    try {
      const rows = await getSkillRevisions(skill.id, 0, system, controller.signal);
      const revision = rows.find(row => row.is_current)?.revision;
      let current;
      if (revision !== undefined) current = { revision, url: system ? "/api/admin/system-skills/" + skill.id + "/revisions/" + revision + "/bundle" : "/api/skills/" + skill.id + "/bundle?revision=" + revision };
      else {
        // Restoring a built-in points back to revision 0, outside saved history.
        const item = system ? await adminApi.systemSkill(skill.id, controller.signal) : await getSkill(skill.id, controller.signal);
        if (!item.bundle_url) throw new Error("Current Bundle unavailable");
        current = { revision: item.bundle_revision ?? 0, url: item.bundle_url };
      }
      if (active() && !controller.signal.aborted) setLatest(current);
    } catch { if (active() && !controller.signal.aborted) setReadFailed(true); }
    finally { if (active() && latestRead.current === controller) setReading(false); }
  };
  const reset = () => {
    latestRead.current?.abort(); setLatest(null); setReadFailed(false); setReading(false); replace.reset();
  };
  const errorText = conflict
    ? (zh ? "Skill 已在别处更新，所选文件已保留。" : "This Skill changed elsewhere. Your selected file is kept.")
    : status === 413 || status === 422 ? (zh ? "文件大小或格式不符合要求。请选择有效的 Skill ZIP 或 Markdown。" : "The file size or format is not supported. Choose a valid Skill ZIP or Markdown.")
    : status === 401 ? (zh ? "登录已过期，请重新登录后替换。" : "Your session expired. Sign in again before replacing.")
    : status === 403 ? (zh ? "当前不允许替换此 Skill。文件已保留，请联系管理员。" : "Replacing this Skill is not allowed. Your file is kept; contact the administrator.")
    : status === 404 ? (zh ? "此 Skill 已不可用。所选文件已保留。" : "This Skill is no longer available. Your selected file is kept.")
    : status === 409 ? (zh ? "已有相同 Skill，未替换。请选择其他文件。" : "An identical Skill already exists. Choose a different file.")
    : status === 429 ? (zh ? "操作过于频繁。文件已保留，请稍后重试。" : "Too many requests. Your file is kept; retry shortly.")
    : (zh ? "尚未确认替换结果。文件已保留，可重试核对；不会重复创建相同版本。" : "Replacement is not confirmed. Retry with the retained file; an identical version will not be created twice.");
  return <div className="mt-2 space-y-2">
    <button ref={choose} type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => input.current?.click()}>{zh ? "替换文件" : "Replace file"}</button>
    <input ref={input} type="file" accept=".zip,.md" aria-label={zh ? "替换 Skill ZIP / Markdown" : "Replace Skill ZIP / Markdown"} disabled={busy} hidden onChange={event => { setFile(event.target.files?.[0] ?? null); setBase(skill.bundle_revision ?? 0); reset(); }} />
    {file ? <p className="break-all text-xs text-secondary">{file.name}</p> : null}
    {file ? <div className="flex flex-wrap gap-2">
      {!conflict && (!replace.error || retryable) ? <button ref={recovery} type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => replace.mutate(base)}>{replace.isPending ? (zh ? "正在替换…" : "Replacing…") : replace.error ? (zh ? "重试替换" : "Retry replacement") : (zh ? "确认替换" : "Replace")}</button> : null}
      <button type="button" disabled={busy} className="min-h-11 px-3 text-xs" onClick={() => { setFile(null); if (input.current) input.current.value = ""; reset(); }}>{zh ? "取消替换" : "Discard replacement"}</button>
    </div> : null}
    {replace.error ? <div role="alert" className="space-y-2 text-xs text-[var(--danger)]"><p>{errorText}</p>
      {conflict && latest === null ? <button ref={recovery} type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => void readLatest()}>{reading ? (zh ? "正在读取…" : "Reading…") : (zh ? "读取最新版本" : "Read latest version")}</button> : null}
      {readFailed ? <p>{zh ? "最新版本读取失败，请重试；所选文件未改变。" : "The latest version could not load. Retry; your selected file is unchanged."}</p> : null}
    </div> : null}
    {conflict && latest !== null ? <div className="space-y-2 border-l-2 border-ui pl-3 text-xs">
      <p className="text-secondary">{latest.revision === 0
        ? (zh ? "当前使用原始文件。请下载比较，再决定是否替换。" : "The original file is current. Download it to compare before deciding to replace it.")
        : (zh ? "当前为版本 " + latest.revision + "。下载比较后，可用所选文件替换；旧版本仍保留。" : "Version " + latest.revision + " is current. Download it to compare before replacing with your file; the old version is retained.")}</p>
      <div className="flex flex-wrap items-center gap-2"><a ref={latestDownload} href={latest.url} download className="inline-flex min-h-11 items-center text-accent">{zh ? "下载最新版本" : "Download latest version"}</a>
        <button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-xs" onClick={() => replace.mutate(latest.revision)}>{zh ? "用所选文件替换此版本" : "Replace this version with my file"}</button></div>
    </div> : null}
    {replace.isSuccess ? <p role="status" className="text-xs text-accent">{zh ? "已替换" : "Replaced"}</p> : null}
  </div>;
}
