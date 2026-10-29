"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GitBranch, LoaderCircle } from "lucide-react";
import { ApiRequestError, getConversation, getConversationEvents } from "../../lib/api";
import type { ConversationDetail, ConversationEventRead } from "../../lib/types";

type RelatedConversation = {
  id: string;
  relation: string;
  eventId: string;
  createdAt: string;
};

export function ConversationLineagePanel({
  conversationId,
  locale,
  onClose,
}: {
  conversationId: string;
  locale: "zh-CN" | "en-US";
  onClose: () => void;
}) {
  const router = useRouter();
  const zh = locale === "zh-CN";
  const [events, setEvents] = useState<ConversationEventRead[]>([]);
  const [conversations, setConversations] = useState<Record<string, ConversationDetail | null>>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [page, setPage] = useState({ conversationId, offset: 0 });
  const offset = page.conversationId === conversationId ? page.offset : 0;
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setEvents([]);
    setConversations({});
    void (async () => {
      try {
        const response = await getConversationEvents(conversationId, { limit: 25, offset, lineageOnly: true, signal: controller.signal });
        const ids = new Set<string>();
        for (const event of response.items) {
          for (const id of relatedIds(event)) ids.add(id);
        }
        const pendingIds = [...ids].filter((id) => id !== conversationId);
        const entries: Array<readonly [string, ConversationDetail | null]> = [];
        // Bound network concurrency even when a merge has many sources.
        for (let start = 0; start < pendingIds.length; start += 4) {
          if (controller.signal.aborted) return;
          entries.push(...await Promise.all(pendingIds.slice(start, start + 4).map(async (id) => {
            try {
              return [id, await getConversation(id, controller.signal)] as const;
            } catch (cause) {
              if (cause instanceof ApiRequestError && [403, 404, 410].includes(cause.status)) return [id, null] as const;
              throw cause;
            }
          })));
        }
        if (controller.signal.aborted) return;
        setEvents(response.items);
        setConversations(Object.fromEntries(entries));
        setTotal(response.total);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    })();
    return () => controller.abort();
  }, [conversationId, offset, attempt]);

  const related = useMemo(() => {
    const rows: RelatedConversation[] = [];
    for (const event of events) {
      for (const id of relatedIds(event)) {
        if (id === conversationId) continue;
        rows.push({
          id,
          eventId: event.id,
          createdAt: event.created_at,
          relation: relationLabel(event, zh),
        });
      }
    }
    return [...new Map(rows.map((row) => [`${row.id}:${row.relation}`, row])).values()];
  }, [conversationId, events, zh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-3 text-sm text-secondary">
          <div className="flex items-start gap-2">
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{zh ? "只显示当前账户可访问的来源关系；已删除或无权访问的节点不会泄露标题。" : "Only lineage visible to this account is shown. Deleted or inaccessible nodes do not reveal titles."}</span>
          </div>
        </div>
        {state === "loading" ? (
          <div role="status" className="flex items-center gap-2 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin" />{zh ? "正在读取来源关系…" : "Loading lineage…"}</div>
        ) : state === "error" ? (
          <div role="alert" className="space-y-2 text-sm text-[var(--danger)]">
            <p>{zh ? "来源关系读取失败。" : "Could not load lineage."}</p>
            <button type="button" className="min-h-11 underline" onClick={() => setAttempt((value) => value + 1)}>{zh ? "重试" : "Retry"}</button>
          </div>
        ) : related.length === 0 ? (
          <p className="text-sm text-secondary">{zh ? "暂未记录拆分或合并来源。" : "No split or merge lineage has been recorded."}</p>
        ) : (
          <ol className="space-y-3">
            {related.map((row) => {
              const detail = conversations[row.id];
              const title = detail ? (detail.display_title || detail.title) : (zh ? "相关对话不可用" : "Related conversation unavailable");
              return (
                <li key={`${row.id}:${row.relation}`} className="rounded-lg border border-ui bg-surface p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-secondary">{row.relation}</p>
                      <p className="mt-1 truncate text-sm font-medium text-primary">{title}</p>
                      <p className="mt-1 text-xs text-secondary">{formatDate(row.createdAt, locale)}</p>
                    </div>
                    {detail ? (
                      <button type="button" className="min-h-9 shrink-0 rounded-lg border border-ui px-2.5 text-xs font-medium text-primary hover:bg-subtle" onClick={() => router.push(`/conversations/${detail.id}`)}>
                        {zh ? "打开" : "Open"}
                      </button>
                    ) : <span className="shrink-0 text-xs text-secondary">{zh ? "不可访问" : "Unavailable"}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {state === "ready" && (offset > 0 || offset + events.length < total) ? (
          <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={zh ? "来源关系分页" : "Lineage pagination"}>
            <button type="button" className="btn-secondary min-h-11 px-3 text-xs disabled:opacity-50" disabled={offset === 0} onClick={() => setPage({ conversationId, offset: Math.max(0, offset - 25) })}>{zh ? "上一页" : "Previous"}</button>
            <span className="text-xs text-secondary">{zh ? `第 ${Math.floor(offset / 25) + 1} 页` : `Page ${Math.floor(offset / 25) + 1}`}</span>
            <button type="button" className="btn-secondary min-h-11 px-3 text-xs disabled:opacity-50" disabled={offset + events.length >= total} onClick={() => setPage({ conversationId, offset: offset + 25 })}>{zh ? "下一页" : "Next"}</button>
          </nav>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-ui p-3">
        <button type="button" className="btn-secondary min-h-10 w-full" onClick={onClose}>{zh ? "关闭" : "Close"}</button>
      </div>
    </div>
  );
}

function relatedIds(event: ConversationEventRead): string[] {
  const payload = event.payload;
  const values: unknown[] = [];
  if (event.event_type === "conversation_merged") values.push(payload.source_conversation_ids);
  if (event.event_type === "conversation_merged_into" || event.event_type === "conversation_created_from_split") {
    values.push(payload.target_conversation_id, payload.source_conversation_id);
  }
  if (event.event_type === "conversation_split") values.push(payload.target_conversation_id, payload.target_conversation_ids);
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function relationLabel(event: ConversationEventRead, zh: boolean): string {
  if (event.event_type === "conversation_merged") return zh ? "合并来源" : "Merge source";
  if (event.event_type === "conversation_merged_into") return zh ? "合并目标" : "Merged into";
  if (event.event_type === "conversation_created_from_split") return zh ? "拆分来源" : "Split source";
  if (event.event_type === "conversation_split") return zh ? "拆分目标" : "Split target";
  return zh ? "来源关系" : "Lineage relation";
}

function formatDate(value: string, locale: "zh-CN" | "en-US"): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
