"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";

export type ContinuationReference = { messageId?: string; messageVersionId?: string; sequence?: number; blockIndex?: number };
export type ContinuationNavigate = (reference: ContinuationReference) => Promise<boolean>;
export type ContinuationViewState = { member: "current" | "index"; indexQuery: string };
const control = "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-secondary hover:bg-subtle disabled:opacity-50";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

function reference(value: unknown): ContinuationReference | undefined {
  const item = object(value);
  const messageId = typeof item.message_id === "string" && item.message_id.length > 0 && item.message_id.length <= 128 ? item.message_id : undefined;
  const sequence = positive(item.sequence ?? item.seq ?? item.seq_start);
  if (!messageId && !sequence) return;
  return { messageId, sequence,
    messageVersionId: typeof (item.version_id ?? item.message_version_id) === "string" ? String(item.version_id ?? item.message_version_id) : undefined,
    blockIndex: typeof item.block_index === "number" && Number.isSafeInteger(item.block_index) && item.block_index >= 0 ? item.block_index : undefined };
}

export function IndexReading({ text, zh, onNavigate, viewState }: { text: string; zh: boolean; onNavigate?: ContinuationNavigate; viewState?: ContinuationViewState }) {
  const [query, setQuery] = useState(viewState?.indexQuery ?? "");
  const [count, setCount] = useState(25);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const parsed = useMemo(() => { try { return object(JSON.parse(text)); } catch { return null; } }, [text]);
  const entries = useMemo(() => {
    if (!parsed) return [];
    const items = Array.isArray(parsed.segments) || Array.isArray(parsed.chapters)
      ? [...(Array.isArray(parsed.chapters) ? parsed.chapters : []), ...(Array.isArray(parsed.segments) ? parsed.segments : [])] : null;
    return items ? items.map((value, index) => ({ value, key: String(index), title: typeof object(value).title === "string" ? String(object(value).title) : typeof object(value).id === "string" ? String(object(value).id) : `${zh ? "片段" : "Segment"} ${index + 1}`, search: JSON.stringify(value).toLocaleLowerCase() }))
      : Object.entries(parsed).map(([key, value]) => ({ value, key, title: key, search: `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`.toLocaleLowerCase() }));
  }, [parsed, zh]);
  const filtered = useMemo(() => entries.filter(entry => entry.search.includes(query.trim().toLocaleLowerCase())), [entries, query]);
  if (!parsed) return <pre className="whitespace-pre-wrap break-all text-sm">{text}</pre>;
  const grouped = Array.isArray(parsed.segments) || Array.isArray(parsed.chapters);
  const changeQuery = (value: string) => { setQuery(value); setCount(25); if (viewState) viewState.indexQuery = value; };
  const navigate = async (target: ContinuationReference, key: string) => {
    if (!onNavigate || pending) return;
    setPending(key); setError("");
    try { if (!await onNavigate(target)) setError(zh ? "当前对话中无法定位此引用，索引已保留。" : "This reference could not be located in this conversation. The index is retained."); }
    catch { setError(zh ? "定位失败，请重试。" : "Could not locate the reference. Retry."); }
    finally { setPending(null); }
  };
  return <div className="min-w-0 space-y-4">
    <div className="flex min-h-11 items-center gap-2 rounded-md border border-ui bg-surface px-3 focus-within:ring-2 focus-within:ring-[var(--focus)]">
      <Search className="h-4 w-4 shrink-0 text-secondary" />
      <input type="search" aria-label={zh ? "搜索全部索引" : "Search entire index"} placeholder={zh ? "查找主题、描述或引用" : "Find a topic, description or reference"} value={query} onChange={event => changeQuery(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none" />
      {query ? <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-subtle" aria-label={zh ? "清除索引搜索" : "Clear index search"} onClick={() => changeQuery("")}><X className="h-4 w-4" /></button> : null}
    </div>
    {query ? <p role="status" className="text-xs text-secondary">{zh ? `${filtered.length} 项匹配，共 ${entries.length} 项` : `${filtered.length} matches across ${entries.length} entries`}</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {filtered.length === 0 ? <p className="py-8 text-sm text-secondary">{zh ? "没有找到匹配内容。" : "No matching entries."}</p> : null}
    <div className="divide-y divide-[var(--border)]">{filtered.slice(0, count).map(entry => {
      const item = object(entry.value);
      const refs = Array.isArray(item.key_refs) ? item.key_refs : [];
      const direct = reference(item);
      const links = [...(direct ? [{ value: item, target: direct }] : []), ...refs.map(value => ({ value: object(value), target: reference(value) }))].filter(link => link.target);
      return <details key={`${entry.key}:${query}`} open={query || !grouped ? true : undefined} className="min-w-0 border-b border-ui py-3">
        <summary className="min-h-11 cursor-pointer break-words py-2 text-base font-medium">{entry.title}</summary>
        {typeof item.about === "string" ? <p className="py-3 text-sm leading-7 text-secondary">{item.about}</p> : null}
        {onNavigate && links.length ? <div className="my-2 flex flex-wrap gap-1">{links.map((link, i) => {
          const target = link.target!;
          const key = `${entry.key}:${i}`;
          const label = target.messageId ? (zh ? "查看引用消息" : "View referenced message") : (zh ? `查看当前第 ${target.sequence} 条` : `View current message ${target.sequence}`);
          return <button key={i} className={control} disabled={Boolean(pending)} onClick={() => void navigate(target, key)}><ArrowUpRight className="h-4 w-4 shrink-0" />{pending === key ? (zh ? "正在定位…" : "Locating…") : label}{typeof link.value.purpose === "string" ? <span className="max-w-48 truncate text-xs">· {link.value.purpose}</span> : null}</button>;
        })}</div> : null}
        {grouped ? <details className="mt-2 text-xs text-secondary"><summary className="min-h-11 cursor-pointer py-3">{zh ? "查看字段" : "View fields"}</summary><pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-3 leading-6">{JSON.stringify(entry.value, null, 2)}</pre></details>
          : <pre className="mt-2 whitespace-pre-wrap break-all text-sm leading-6 text-secondary">{typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value, null, 2)}</pre>}
      </details>;
    })}</div>
    {filtered.length > count ? <button className={control} onClick={() => setCount(n => n + 25)}>{zh ? `显示更多（剩余 ${filtered.length - count} 项）` : `Show more (${filtered.length - count} remaining)`}</button> : null}
    {grouped ? <details className="text-sm text-secondary"><summary className="min-h-11 cursor-pointer py-3">{zh ? "索引元数据" : "Index metadata"}</summary><pre className="whitespace-pre-wrap break-all text-xs leading-6">{JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "segments" && key !== "chapters")), null, 2)}</pre></details> : null}
  </div>;
}
