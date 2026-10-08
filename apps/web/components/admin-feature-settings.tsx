"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useLayoutEffect, useRef } from "react";
import { adminApi, AdminRequestError, type FeaturePolicy, type FeaturePolicyPatch } from "../lib/admin-client";
import { ACCOUNT_CAPABILITIES_CHANGED_EVENT } from "../lib/auth-client";
import { authenticationGeneration } from "../lib/offline-access";
import { usePreferences } from "./preferences-provider";

const fields = [
  ["allow_share_links", "允许创建分享链接", "Allow new share links"],
  ["allow_public_share", "允许公开分享", "Allow public sharing"],
  ["allow_share_password", "允许分享密码", "Allow share passwords"],
  ["allow_user_skills", "允许用户 Skill", "Allow user Skills"],
  ["allow_skill_import", "允许导入 Skill", "Allow Skill import"],
  ["allow_user_import", "允许用户导入", "Allow user import"],
] as const;
const labels = [...fields,
  ["maximum_import_size_mb", "单文件导入上限（MiB）", "Import limit per file (MiB)"],
  ["maximum_merge_message_count", "合并消息上限", "Merge message limit"],
  ["export_retention_minutes", "保留时间（分钟）", "Keep for (minutes)"],
  ["export_release_on_close", "关闭导出面板后提前清理", "Release when the export panel closes"],
] as const;
function changedPolicy(value: FeaturePolicy | null, base: FeaturePolicy | null): FeaturePolicyPatch {
  if (!value || !base) return {};
  return Object.fromEntries(labels.filter(([key]) => value[key] !== base[key]).map(([key]) => [key, value[key]]));
}

export function AdminFeaturesPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [policy, setPolicy] = useState<FeaturePolicy | null>(null);
  const [saved, setSaved] = useState<FeaturePolicy | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<"load" | "conflict" | "unknown" | "read" | "invalid" | "access" | null>(null);
  const [recovery, setRecovery] = useState<"review" | "check" | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);
  const [notice, setNotice] = useState<"saved" | "matches" | "server" | "" >("");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  const feedback = useRef<HTMLDivElement>(null);
  const active = useCallback(() => mounted.current && generation.current === authenticationGeneration(), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const dirty = Object.keys(changedPolicy(policy, saved)).length > 0;
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { if (error || comparison.length || notice) feedback.current?.focus(); }, [error, comparison, notice]);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy("read"); setError(null);
    try {
      const value = await adminApi.features(controller.signal);
      if (active() && !controller.signal.aborted) { setPolicy(value); setSaved(value); }
    } catch { if (active() && !controller.signal.aborted) setError("load"); }
    finally { if (active() && request.current === controller) { setBusy(null); request.current = null; } }
  }, [active]);
  useEffect(() => { void load(); }, [load]);

  const announcePolicy = () => {
    void client.invalidateQueries({ queryKey: ["account-capabilities"] });
    window.dispatchEvent(new Event(ACCOUNT_CAPABILITIES_CHANGED_EVENT));
  };
  const readLatest = async () => {
    if (request.current || !recovery || !policy || !saved) return;
    const patch = changedPolicy(policy, saved);
    const controller = new AbortController(); request.current = controller;
    setBusy("read"); setError(null);
    try {
      const value = await adminApi.features(controller.signal);
      if (!active() || controller.signal.aborted) return;
      const matches = Object.entries(patch).every(([key, val]) => value[key as keyof FeaturePolicyPatch] === val);
      setComparison(matches ? [] : labels.filter(([key]) => key in patch || saved[key] !== value[key]).map(([key]) => key));
      setSaved(value); setPolicy(matches ? value : { ...value, ...patch });
      setRecovery(null); setNotice(matches ? "matches" : "");
      announcePolicy();
    } catch (cause) {
      if (!active() || controller.signal.aborted) return;
      if (cause instanceof AdminRequestError && [401, 403, 404].includes(cause.status)) {
        setPolicy(null); setSaved(null); setRecovery(null); setComparison([]); setError("access");
      } else setError("read");
    } finally { if (active() && request.current === controller) { setBusy(null); request.current = null; } }
  };
  const save = async () => {
    if (!policy || !saved || !dirty || recovery || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy("save"); setError(null); setNotice(""); setComparison([]);
    try {
      const value = await adminApi.saveFeatures({ ...changedPolicy(policy, saved), base_revision: saved.revision }, controller.signal);
      if (!active() || controller.signal.aborted) return;
      setSaved(value); setPolicy(value); setNotice("saved"); announcePolicy();
    } catch (cause) {
      if (!active() || controller.signal.aborted) return;
      if (cause instanceof AdminRequestError && cause.status === 409) { setRecovery("review"); setError("conflict"); }
      else if (cause instanceof AdminRequestError && [401, 403, 404].includes(cause.status)) {
        setPolicy(null); setSaved(null); setError("access");
      } else if (cause instanceof AdminRequestError && cause.status === 422) setError("invalid");
      else { setRecovery("check"); setError("unknown"); }
    } finally { if (active() && request.current === controller) { setBusy(null); request.current = null; } }
  };
  const errorCopy = {
    load: zh ? "无法读取功能策略，请重试。" : "Unable to load feature policy. Retry.",
    conflict: zh ? "策略已在其他窗口更改。输入已保留，请读取最新策略后再保存。" : "Policy changed in another window. Your input is preserved. Read the latest policy before saving.",
    unknown: zh ? "尚未确认保存结果。输入已保留，请先检查当前策略。" : "Save is not confirmed. Your input is preserved. Check the current policy first.",
    read: zh ? "读取失败，输入已保留。请重试，尚未再次提交。" : "Read failed. Your input is preserved. Retry; no changes were resubmitted.",
    invalid: zh ? "设置未被接受，请检查输入后再保存。" : "Settings were not accepted. Check your input before saving.",
    access: zh ? "当前账户无法管理功能策略。" : "This account cannot manage feature policy.",
  };
  const display = (value: boolean | number) => typeof value === "boolean" ? (value ? (zh ? "允许" : "On") : (zh ? "关闭" : "Off")) : String(value);
  const valid = policy && Number.isInteger(policy.maximum_import_size_mb) && policy.maximum_import_size_mb >= 1 && policy.maximum_import_size_mb <= 10240 && Number.isInteger(policy.maximum_merge_message_count) && policy.maximum_merge_message_count >= 2 && policy.maximum_merge_message_count <= 100000 && Number.isInteger(policy.export_retention_minutes) && policy.export_retention_minutes >= 1 && policy.export_retention_minutes <= 60;
  return <section className="space-y-4" aria-label={zh ? "功能与默认值" : "Features & defaults"}>

    {!policy && busy ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {policy ? <fieldset disabled={Boolean(busy || recovery)} className="space-y-4">
      {fields.map(([key, cn, en]) => <label key={key} className="flex min-h-11 items-center justify-between gap-3 border-b border-ui py-2 text-sm text-primary"><span>{zh ? cn : en}</span><input type="checkbox" checked={policy[key]} onChange={(event) => { setNotice(""); setPolicy({ ...policy, [key]: event.target.checked }); }} /></label>)}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-secondary">{zh ? "单文件导入上限（MiB，1–10240）" : "Import limit per file (MiB, 1–10240)"}<input type="number" min={1} max={10240} value={policy.maximum_import_size_mb} onChange={(event) => { setNotice(""); setPolicy({ ...policy, maximum_import_size_mb: Number(event.target.value) }); }} className="input-base mt-2 min-h-11 w-full px-3 text-base" /></label>
        <label className="text-sm text-secondary">{zh ? "合并消息上限（2–100000）" : "Merge message limit (2–100000)"}<input type="number" min={2} max={100000} value={policy.maximum_merge_message_count} onChange={(event) => { setNotice(""); setPolicy({ ...policy, maximum_merge_message_count: Number(event.target.value) }); }} className="input-base mt-2 min-h-11 w-full px-3 text-base" /></label>
      </div>
      <div className="space-y-3 border-t border-ui pt-4">
        <h3 className="text-sm font-medium text-primary">{zh ? "临时导出文件" : "Temporary exports"}</h3>
        <label className="flex min-h-11 flex-wrap items-center justify-between gap-3 text-sm text-secondary">
          <span>{zh ? "保留时间（分钟，1–60）" : "Keep for (minutes, 1–60)"}</span>
          <input type="number" min={1} max={60} step={1} value={policy.export_retention_minutes} onChange={(event) => { setNotice(""); setPolicy({ ...policy, export_retention_minutes: Number(event.target.value) }); }} className="input-base min-h-11 w-24 px-3 text-base" />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-primary">
          <span>{zh ? "关闭导出面板后提前清理" : "Release when the export panel closes"}</span>
          <input type="checkbox" checked={policy.export_release_on_close} onChange={(event) => { setNotice(""); setPolicy({ ...policy, export_release_on_close: event.target.checked }); }} />
        </label>
        <p className="text-xs leading-5 text-secondary">{zh ? "适用于新生成的文件；正在下载的文件会保留到传输结束。" : "Applies to new exports. Downloads already in progress can finish."}</p>
      </div>
      {!valid ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "请输入范围内的整数。" : "Enter whole numbers within the stated ranges."}</p> : null}
    </fieldset> : null}
    <div ref={feedback} tabIndex={-1} className="space-y-3 outline-none">
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{errorCopy[error]}</p> : null}
      {error === "load" ? <button type="button" disabled={Boolean(busy)} onClick={() => void load()} className="btn-secondary min-h-11 px-4 text-sm">{zh ? "重试" : "Retry"}</button> : null}
      {recovery ? <button type="button" disabled={Boolean(busy)} onClick={() => void readLatest()} className="btn-secondary min-h-11 px-4 text-sm">{busy === "read" ? (zh ? "正在读取…" : "Loading…") : recovery === "check" ? (zh ? "检查保存结果" : "Check save result") : (zh ? "读取最新策略" : "Read latest policy")}</button> : null}
      {comparison.length && policy && saved ? <section aria-label={zh ? "比较功能策略" : "Compare feature policy"} className="space-y-3 border-t border-ui pt-3 text-sm">
        <p className="text-primary">{zh ? "已读取最新策略；仅保留本次修改，确认后再保存。" : "Latest policy loaded. Only your edits are retained; review them before saving."}</p>
        <dl>{labels.filter(([key]) => comparison.includes(key)).map(([key, cn, en]) => <div key={key} className="space-y-1 border-b border-ui py-2">
          <dt className="text-primary">{zh ? cn : en}</dt>
          <dd className="flex flex-wrap gap-x-5 gap-y-1 text-secondary"><span>{zh ? "服务器：" : "Server: "}{display(saved[key])}</span><span>{zh ? "待保存：" : "Pending: "}{display(policy[key])}</span></dd>
        </div>)}</dl>
      </section> : null}
      {notice ? <p role="status" className="text-sm text-primary">{notice === "saved" ? (zh ? "功能策略已保存。" : "Feature policy saved.") : notice === "matches" ? (zh ? "当前策略与本次提交一致。" : "Current policy matches your submitted changes.") : (zh ? "已使用读取到的服务器策略。" : "Using the server policy you just read.")}</p> : null}
      {policy ? <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!dirty || !valid || Boolean(busy || recovery)} onClick={() => void save()} className="btn-primary min-h-11 px-4 text-sm">{busy === "save" ? (zh ? "保存中…" : "Saving…") : (zh ? "保存功能策略" : "Save feature policy")}</button>
        {comparison.length && saved ? <button type="button" disabled={Boolean(busy)} className="btn-secondary min-h-11 px-4 text-sm" onClick={() => { setPolicy(saved); setComparison([]); setNotice("server"); setError(null); }}>{zh ? "使用服务器策略" : "Use server policy"}</button> : null}
      </div> : null}
    </div>
  </section>;
}
