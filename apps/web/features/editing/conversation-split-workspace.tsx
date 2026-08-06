"use client";

import { CheckSquare2, LoaderCircle, Scissors, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { executeConversationSplit, getConversationDialogueIndex, previewConversationSplit } from "../../lib/api";
import type { ConversationSplitMode, ConversationSplitWorkspaceInput, ConversationSplitWorkspacePreview, ConversationSplitWorkspaceResponse, DialogueIndexItem } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";

const modes: Array<{ id: ConversationSplitMode; zh: string; en: string }> = [
  { id: "range_copy", zh: "连续区间", en: "Range" },
  { id: "boundary_copy", zh: "边界双份", en: "Boundary" },
  { id: "discrete_copy", zh: "离散消息", en: "Discrete" },
];

export function ConversationSplitWorkspace({ open, conversationId, conversationTitle, selectedMessageIds, onClose, onCompleted }: {
  open: boolean;
  conversationId: string;
  conversationTitle: string;
  selectedMessageIds: string[];
  onClose: () => void;
  onCompleted: (response: ConversationSplitWorkspaceResponse) => Promise<void> | void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [items, setItems] = useState<DialogueIndexItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ConversationSplitMode>("range_copy");
  const [startId, setStartId] = useState("");
  const [endId, setEndId] = useState("");
  const [boundaryId, setBoundaryId] = useState("");
  const [discreteIds, setDiscreteIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ConversationSplitWorkspacePreview | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [result, setResult] = useState<ConversationSplitWorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setResult(null);
    setError(null);
    void loadDialogueIndex(conversationId).then((nextItems) => {
      if (cancelled) return;
      setItems(nextItems);
      const selected = nextItems.filter((item) => selectedMessageIds.includes(item.message_id));
      setStartId(selected[0]?.message_id ?? nextItems[0]?.message_id ?? "");
      setEndId(selected[selected.length - 1]?.message_id ?? nextItems[nextItems.length - 1]?.message_id ?? "");
      setBoundaryId(selected[selected.length - 1]?.message_id ?? nextItems[Math.max(0, Math.floor(nextItems.length / 2) - 1)]?.message_id ?? "");
      setDiscreteIds(new Set(selected.map((item) => item.message_id)));
    }).catch((reason) => {
      if (!cancelled) setError(errorMessage(reason, zh ? "无法加载完整对话索引。" : "Unable to load the complete dialogue index."));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, open, selectedMessageIds, zh]);

  const indexById = useMemo(() => new Map(items.map((item, index) => [item.message_id, index])), [items]);
  const includedIds = useMemo(() => {
    if (mode === "discrete_copy") return discreteIds;
    if (mode === "boundary_copy") return new Set(items.map((item) => item.message_id));
    const start = indexById.get(startId);
    const end = indexById.get(endId);
    if (start === undefined || end === undefined) return new Set<string>();
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return new Set(items.slice(low, high + 1).map((item) => item.message_id));
  }, [boundaryId, discreteIds, endId, indexById, items, mode, startId]);

  if (!open) return null;

  function input(): ConversationSplitWorkspaceInput {
    if (mode === "range_copy") return { mode, startMessageId: startId, endMessageId: endId, titles };
    if (mode === "boundary_copy") return { mode, boundaryMessageId: boundaryId, titles };
    return { mode, messageIds: items.filter((item) => discreteIds.has(item.message_id)).map((item) => item.message_id), titles };
  }

  function changeMode(nextMode: ConversationSplitMode) {
    setMode(nextMode);
    setPreview(null);
    setResult(null);
    setTitles([]);
    setError(null);
  }

  async function requestPreview() {
    setBusy(true);
    setError(null);
    try {
      const next = await previewConversationSplit(conversationId, input());
      setPreview(next);
      setTitles(next.groups.map((group) => group.suggested_title));
    } catch (reason) {
      setError(errorMessage(reason, zh ? "无法生成拆分预览。" : "Unable to preview the split."));
    } finally { setBusy(false); }
  }

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      const response = await executeConversationSplit(conversationId, input());
      setResult(response);
      await onCompleted(response);
    } catch (reason) {
      setError(errorMessage(reason, zh ? "拆分失败，请重试。" : "Split failed. Please try again."));
    } finally { setBusy(false); }
  }

  const invalid = mode === "range_copy" ? !startId || !endId : mode === "boundary_copy" ? !boundaryId : discreteIds.size === 0;

  return (
    <div className="fixed inset-0 z-[230] flex items-end justify-center bg-[var(--overlay)] p-0 md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="conversation-split-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label={zh ? "关闭拆分工作区" : "Close split workspace"} />
      <section className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui bg-raised shadow-2xl md:max-w-5xl md:rounded-xl">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <Scissors className="h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><h2 id="conversation-split-title" className="text-base font-semibold text-primary">{zh ? "拆分对话" : "Split conversation"}</h2><p className="truncate text-xs text-secondary">{conversationTitle}</p></div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-h-0 flex-col border-b border-ui md:border-b-0 md:border-r">
            <div className="grid grid-cols-3 gap-1 border-b border-ui p-2" aria-label={zh ? "拆分模式" : "Split mode"}>
              {modes.map((option) => <button key={option.id} type="button" onClick={() => changeMode(option.id)} className={`min-h-10 rounded-lg px-2 text-sm font-medium ${mode === option.id ? "bg-[var(--text)] text-[var(--surface)]" : "text-secondary hover:bg-subtle"}`}>{zh ? option.zh : option.en}</button>)}
            </div>

            <div className="space-y-3 border-b border-ui p-3">
              {mode === "range_copy" ? <div className="grid gap-2 sm:grid-cols-2"><MessageSelect label={zh ? "起始消息" : "Start"} value={startId} items={items} onChange={(value) => { setStartId(value); setPreview(null); }} /><MessageSelect label={zh ? "结束消息" : "End"} value={endId} items={items} onChange={(value) => { setEndId(value); setPreview(null); }} /></div> : null}
              {mode === "boundary_copy" ? <MessageSelect label={zh ? "前半段结束于" : "First result ends at"} value={boundaryId} items={items.slice(0, -1)} onChange={(value) => { setBoundaryId(value); setPreview(null); }} /> : null}
              <p className="text-xs leading-5 text-secondary">{mode === "range_copy" ? (zh ? "复制起止之间的全部消息；时间线中高亮的中间消息也会被包含。" : "Copies every message between the endpoints, including highlighted messages in between.") : mode === "boundary_copy" ? (zh ? "以边界生成前、后两个新对话，原对话保持不变。" : "Creates two new conversations around the boundary; the source stays unchanged.") : (zh ? "只复制明确勾选的消息，不会自动补齐问答轮次。" : "Copies only checked messages without completing turns.")}</p>
            </div>

            <div className="min-h-[15rem] flex-1 overflow-y-auto p-2" aria-label={zh ? "消息时间线" : "Message timeline"}>
              {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin" />{zh ? "正在加载完整对话…" : "Loading full conversation…"}</div> : items.map((item) => {
                const included = includedIds.has(item.message_id);
                const boundary = mode === "boundary_copy" && item.message_id === boundaryId;
                return <button key={item.message_id} type="button" onClick={() => {
                  if (mode === "discrete_copy") { setDiscreteIds((current) => { const next = new Set(current); if (next.has(item.message_id)) next.delete(item.message_id); else next.add(item.message_id); return next; }); setPreview(null); }
                  if (mode === "boundary_copy" && item.message_id !== items[items.length - 1]?.message_id) { setBoundaryId(item.message_id); setPreview(null); }
                }} className={`mb-1 grid w-full grid-cols-[2rem_3.5rem_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-2 text-left ${included ? "bg-[var(--accent-soft)]" : "hover:bg-subtle"}`}>
                  <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg ${included ? "text-accent" : "text-secondary"}`}>{mode === "discrete_copy" ? (included ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />) : <span className="text-xs font-semibold">{item.ordinal}</span>}</span>
                  <span className="pt-1.5 text-[11px] font-semibold uppercase text-secondary">{item.role === "user" ? (zh ? "你" : "You") : "AI"}</span>
                  <span className="min-w-0 pt-1 text-sm leading-5 text-primary"><span className="line-clamp-2">{item.preview || (zh ? "空消息" : "Empty message")}</span>{boundary ? <span className="mt-1 inline-block text-[11px] font-semibold text-accent">{zh ? "边界：此消息属于前半段" : "Boundary: included in first result"}</span> : null}</span>
                </button>;
              })}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-surface p-4">
            <h3 className="text-sm font-semibold text-primary">{zh ? "结果预览" : "Result preview"}</h3>
            <p className="mt-1 text-xs leading-5 text-secondary">{zh ? `当前计划包含 ${includedIds.size} 条消息。提交前由服务端再次校验范围与权限。` : `${includedIds.size} messages are currently included. The server validates the final plan before execution.`}</p>
            {preview ? <div className="mt-4 space-y-3">{preview.groups.map((group, index) => <label key={`${index}-${group.message_count}`} className="block rounded-lg border border-ui bg-raised p-3 text-xs text-secondary"><span className="font-semibold text-primary">{zh ? `结果 ${index + 1}` : `Result ${index + 1}`} · {group.message_count} {zh ? "条消息" : "messages"}</span><input value={titles[index] ?? ""} onChange={(event) => setTitles((current) => current.map((value, position) => position === index ? event.target.value : value))} className="mt-2 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /></label>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-ui p-4 text-sm leading-6 text-secondary">{zh ? "选择范围后生成预览，这里会显示最终创建的一个或两个对话。" : "Preview the selection to see the one or two conversations that will be created."}</div>}
            {result ? <div className="mt-4 space-y-2" role="status">{result.conversations.map((conversation) => <a key={conversation.conversation_id} href={`/conversations/${conversation.conversation_id}`} className="block rounded-lg border border-ui bg-raised p-3 text-sm font-medium text-accent hover:bg-subtle">{conversation.display_title} · {conversation.message_count}</a>)}</div> : null}
            {error ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-5">
              <button type="button" disabled={busy || loading || invalid} onClick={() => void requestPreview()} className="min-h-10 rounded-lg border border-ui bg-raised px-4 text-sm font-medium text-primary hover:bg-subtle disabled:opacity-50">{zh ? "生成预览" : "Preview"}</button>
              <button type="button" disabled={busy || !preview || result !== null || titles.some((title) => !title.trim())} onClick={() => void execute()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}{zh ? "创建新对话" : "Create"}</button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function MessageSelect({ label, value, items, onChange }: { label: string; value: string; items: DialogueIndexItem[]; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-primary">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]">{items.map((item) => <option key={item.message_id} value={item.message_id}>#{item.ordinal} · {item.role} · {item.preview.slice(0, 70)}</option>)}</select></label>;
}

async function loadDialogueIndex(conversationId: string): Promise<DialogueIndexItem[]> {
  const items: DialogueIndexItem[] = [];
  let offset = 0;
  while (true) {
    const page = await getConversationDialogueIndex(conversationId, { offset, limit: 5000 });
    items.push(...page.items);
    if (!page.has_more || page.items.length === 0) return items;
    offset += page.items.length;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
