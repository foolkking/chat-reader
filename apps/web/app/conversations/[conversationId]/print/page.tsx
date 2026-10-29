"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getConversation, getConversationMessages } from "../../../../lib/api";
import type { ConversationDetail, MessageListItem } from "../../../../lib/types";
import { usePreferences } from "../../../../components/preferences-provider";
import { MessageItem } from "../../../../features/conversations/message-item";

const PAGE_SIZE = 200;
const MAX_PRINT_MESSAGES = 2_000;

export default function ConversationPrintPage() {
  const params = useParams<{ conversationId: string }>();
  const router = useRouter();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const conversationId = params?.conversationId ?? "";
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    setState("loading");
    void (async () => {
      try {
        const detail = await getConversation(conversationId, controller.signal);
        const loaded: MessageListItem[] = [];
        for (let offset = 0; offset < MAX_PRINT_MESSAGES; offset += PAGE_SIZE) {
          const page = await getConversationMessages(conversationId, {
            includeBlocks: true,
            limit: PAGE_SIZE,
            offset,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          loaded.push(...page);
          if (page.length < PAGE_SIZE) break;
        }
        if (controller.signal.aborted) return;
        setConversation(detail);
        setMessages(loaded);
        setTruncated(detail.message_count > loaded.length);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    })();
    return () => controller.abort();
  }, [conversationId]);

  if (state === "loading") {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-secondary">{zh ? "正在准备打印稿…" : "Preparing print view…"}</main>;
  }
  if (state === "error" || !conversation) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-8">
        <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "无法读取完整阅读稿。" : "The full reading draft could not be loaded."}</p>
        <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => router.back()}>{zh ? "返回" : "Back"}</button>
      </main>
    );
  }

  const title = conversation.display_title || conversation.title;
  return (
    <main className="print-reading-draft mx-auto max-w-5xl bg-page px-4 py-6 text-primary sm:px-8">
      <header className="print-reading-draft-toolbar mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-ui pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-secondary">{zh ? "完整阅读稿" : "Full reading draft"}</p>
          <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-xs text-secondary">
            {zh ? `${messages.length} / ${conversation.message_count} 条消息` : `${messages.length} / ${conversation.message_count} messages`}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => router.push(`/conversations/${conversationId}`)}>{zh ? "返回阅读" : "Back to reader"}</button>
          <button type="button" className="btn-primary min-h-11 px-4" onClick={() => window.print()}>{zh ? "打印" : "Print"}</button>
        </div>
      </header>
      {truncated ? (
        <p role="status" className="print-reading-draft-warning mb-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {zh ? `对话超过 ${MAX_PRINT_MESSAGES} 条消息，本次打印稿仅包含前 ${MAX_PRINT_MESSAGES} 条。` : `This conversation exceeds ${MAX_PRINT_MESSAGES} messages; only the first ${MAX_PRINT_MESSAGES} are included.`}
        </p>
      ) : null}
      <section aria-label={zh ? "对话正文" : "Conversation body"} className="space-y-5">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            readOnly
            scrollRootMode="window"
            conversationTitle={title}
            attachmentAccess={{ kind: "owner" }}
          />
        ))}
      </section>
    </main>
  );
}
