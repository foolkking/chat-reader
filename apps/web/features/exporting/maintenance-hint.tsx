"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { continuationApi } from "../../lib/api";
import { usePreferences } from "../../components/preferences-provider";
import { useGuidanceSetting } from "../../components/use-guidance-setting";

export type MaintenanceDismissal = { index: string | null; messages: number; characters: number; muted?: boolean };
export function MaintenanceHint({ conversationId, onOpen }: { conversationId: string; onOpen: () => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const setting = useGuidanceSetting<MaintenanceDismissal>(`maintenance:${conversationId}`);
  const [closed, setClosed] = useState(false);
  const { data } = useQuery({ queryKey: ["continuation", conversationId, "guidance"], queryFn: () => continuationApi.guidance(conversationId), staleTime: 0 });
  const previous = setting.value;
  if (closed || !setting.ready || !data?.suggest_maintenance || data.unindexed_messages === null || data.unindexed_characters === null || previous?.muted) return null;
  if (previous && previous.index === data.index_digest && data.unindexed_messages - previous.messages < data.message_threshold && data.unindexed_characters - previous.characters < data.character_threshold) return null;
  const dismiss = (muted = false) => {
    setClosed(true);
    void setting.save({ index: data.index_digest, messages: data.unindexed_messages!, characters: data.unindexed_characters!, muted }).catch(() => undefined);
  };
  return <aside aria-label={zh ? "接续维护建议" : "Continuation suggestion"} className="flex items-start gap-1 border-l-2 border-[var(--accent)] pl-3 text-sm">
    <div className="min-w-0 flex-1"><p className="leading-6 text-secondary">{zh ? `有 ${data.unindexed_messages.toLocaleString()} 条消息尚未纳入 Index，可先整理接续要点。` : `${data.unindexed_messages.toLocaleString()} messages are outside the Index ranges. Consider updating your continuation.`}</p>
      <div className="flex flex-wrap gap-x-4"><button type="button" className="inline-flex min-h-11 items-center gap-1 text-accent" onClick={() => { dismiss(); onOpen(); }}>{zh ? "前往 Current / Index" : "Open Current / Index"}<ArrowRight className="h-3.5 w-3.5" /></button><button type="button" className="min-h-11 text-xs text-secondary" onClick={() => dismiss(true)}>{zh ? "此对话不再提示" : "Don't remind for this conversation"}</button></div>
    </div><button type="button" aria-label={zh ? "关闭维护建议" : "Dismiss maintenance suggestion"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" onClick={() => dismiss()}><X className="h-4 w-4" /></button>
  </aside>;
}
