"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-client";
import { SkillBundleFiles } from "./skill-bundle-files";
import { usePreferences } from "./preferences-provider";

export function AdminSkillSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [locale, setLocale] = useState("zh-CN");
  const [dirtyMembers, setDirtyMembers] = useState<Record<string, boolean>>({});
  const [busyMembers, setBusyMembers] = useState<Record<string, boolean>>({});
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-system-skills"], queryFn: adminApi.systemSkills });
  const dirty = Object.values(dirtyMembers).some(Boolean), busy = Object.values(busyMembers).some(Boolean);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  return <section className="space-y-4">

    <div className="flex gap-2">{["zh-CN", "en"].map(value => <button type="button" key={value} disabled={dirty || busy} aria-pressed={locale === value} className="min-h-9 rounded border border-ui px-3 text-sm" onClick={() => setLocale(value)}>{value === "zh-CN" ? "中文" : "English"}</button>)}</div>
    {query.isPending ? <p role="status">{zh ? "正在读取…" : "Loading…"}</p> : null}
    {query.isError ? <button type="button" onClick={() => void query.refetch()}>{zh ? "读取失败，重试" : "Could not load; retry"}</button> : null}
    {query.data?.filter(item => item.source_kind === "BUNDLED" && item.locale === locale).map(item => <article key={item.id} className="rounded-lg border border-ui p-4">
      <h4 className="text-sm font-semibold">{item.name}</h4>
      {item.bundle_url ? <a href={item.bundle_url} download className="mt-2 inline-block py-2 text-sm text-accent">{zh ? "下载 Skill ZIP" : "Download Skill ZIP"}</a> : null}
      <SkillBundleFiles system skill={{ ...item, source: "SYSTEM", is_selected: item.default_enabled, content_url: item.builtin_content_url }}
        onSaved={async () => { await client.invalidateQueries({ queryKey: ["admin-system-skills"] }); }}
        onBusyChange={value => setBusyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })}
        onDirtyChange={value => setDirtyMembers(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })} />
    </article>)}
  </section>;
}
