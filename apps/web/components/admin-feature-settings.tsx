"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { adminApi, type FeaturePolicy } from "../lib/admin-client";
import { ACCOUNT_CAPABILITIES_CHANGED_EVENT } from "../lib/auth-client";
import { usePreferences } from "./preferences-provider";

export function AdminFeaturesPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [policy, setPolicy] = useState<FeaturePolicy | null>(null);
  const [saved, setSaved] = useState<FeaturePolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(policy) !== JSON.stringify(saved);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const value = await adminApi.features(); setPolicy(value); setSaved(value); }
    catch { setError(zh ? "无法读取功能策略，请重试。" : "Unable to load feature policy. Retry."); }
    finally { setBusy(false); }
  }, [zh]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!policy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await adminApi.saveFeatures(policy); setSaved(value); setPolicy(value);
      await client.invalidateQueries({ queryKey: ["account-capabilities"] });
      window.dispatchEvent(new Event(ACCOUNT_CAPABILITIES_CHANGED_EVENT));
      setNotice(zh ? "功能策略已保存。" : "Feature policy saved.");
    } catch { setError(zh ? "保存失败，输入已保留，请重试。" : "Save failed. Your input is preserved; retry."); }
    finally { setBusy(false); }
  };
  const fields = [
    ["allow_share_links", "允许创建分享链接", "Allow new share links"],
    ["allow_public_share", "允许公开分享", "Allow public sharing"],
    ["allow_share_password", "允许分享密码", "Allow share passwords"],
    ["allow_user_skills", "允许用户 Skill", "Allow user Skills"],
    ["allow_skill_import", "允许导入 Skill", "Allow Skill import"],
    ["allow_user_import", "允许用户导入", "Allow user import"],
  ] as const;
  const valid = policy && Number.isInteger(policy.maximum_import_size_mb) && policy.maximum_import_size_mb >= 1 && policy.maximum_import_size_mb <= 10240 && Number.isInteger(policy.maximum_merge_message_count) && policy.maximum_merge_message_count >= 2 && policy.maximum_merge_message_count <= 100000;
  return <section className="space-y-4" aria-label={zh ? "功能与默认值" : "Features & defaults"}>
    <p className="text-sm text-secondary">{zh ? "实例级分享、导入与处理上限；实际导入上限还受部署配置限制。" : "Instance sharing, import and processing limits. The deployment limit can further restrict import size."}</p>
    {!policy && busy ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {policy ? <fieldset disabled={busy} className="space-y-4">
      {fields.map(([key, cn, en]) => <label key={key} className="flex min-h-11 items-center justify-between gap-3 border-b border-ui py-2 text-sm text-primary"><span>{zh ? cn : en}</span><input type="checkbox" checked={policy[key]} onChange={(event) => { setNotice(""); setPolicy({ ...policy, [key]: event.target.checked }); }} /></label>)}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-secondary">{zh ? "单文件导入上限（MiB，1–10240）" : "Import limit per file (MiB, 1–10240)"}<input type="number" min={1} max={10240} value={policy.maximum_import_size_mb} onChange={(event) => { setNotice(""); setPolicy({ ...policy, maximum_import_size_mb: Number(event.target.value) }); }} className="input-base mt-2 min-h-11 w-full px-3 text-base" /></label>
        <label className="text-sm text-secondary">{zh ? "合并消息上限（2–100000）" : "Merge message limit (2–100000)"}<input type="number" min={2} max={100000} value={policy.maximum_merge_message_count} onChange={(event) => { setNotice(""); setPolicy({ ...policy, maximum_merge_message_count: Number(event.target.value) }); }} className="input-base mt-2 min-h-11 w-full px-3 text-base" /></label>
      </div>
      {!valid ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "请输入范围内的整数。" : "Enter whole numbers within the stated ranges."}</p> : null}
      <button type="button" disabled={!dirty || !valid || busy} onClick={() => void save()} className="btn-primary min-h-11 px-4 text-sm">{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "保存功能策略" : "Save feature policy")}</button>
    </fieldset> : null}
    {error ? <div role="alert" className="space-y-2 text-sm text-[var(--danger)]"><p>{error}</p>{!policy ? <button type="button" disabled={busy} onClick={() => void load()} className="btn-secondary min-h-11 px-4">{zh ? "重试" : "Retry"}</button> : null}</div> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
  </section>;
}
