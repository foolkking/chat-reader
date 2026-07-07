"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  getReadingPosition,
  recordRecentConversation,
  saveReadingPosition,
} from "../../lib/api";
import type { MessageListItem } from "../../lib/types";

export function ReadingPositionClient({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: MessageListItem[];
}) {
  const restoredRef = useRef(false);
  const lastSaveRef = useRef(0);
  const positionQuery = useQuery({
    queryKey: ["reading-position", conversationId],
    queryFn: () => getReadingPosition(conversationId),
  });
  const saveMutation = useMutation({
    mutationFn: (payload: { message_id: string | null; scroll_offset: number; order_key?: string }) =>
      saveReadingPosition(conversationId, {
        message_id: payload.message_id,
        scroll_offset: payload.scroll_offset,
        anchor_data: payload.order_key ? { order_key: payload.order_key } : {},
      }),
  });

  useEffect(() => {
    void recordRecentConversation(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (restoredRef.current || !positionQuery.isSuccess || messages.length === 0) {
      return;
    }
    restoredRef.current = true;
    const position = positionQuery.data.position;
    if (position?.message_id) {
      document.querySelector(`[data-message-id="${position.message_id}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (position?.scroll_offset) {
      window.scrollTo({ top: position.scroll_offset });
    }
  }, [messages.length, positionQuery.data, positionQuery.isSuccess]);

  useEffect(() => {
    function saveCurrentPosition(force = false) {
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 2500) {
        return;
      }
      lastSaveRef.current = now;
      const current = currentMessageElement();
      saveMutation.mutate({
        message_id: current?.getAttribute("data-message-id") ?? null,
        order_key: current?.getAttribute("data-order-key") ?? undefined,
        scroll_offset: Math.max(0, Math.round(window.scrollY)),
      });
    }

    function onScroll() {
      saveCurrentPosition(false);
    }

    function onBeforeUnload() {
      saveCurrentPosition(true);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      saveCurrentPosition(true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveMutation]);

  return null;
}

function currentMessageElement(): HTMLElement | null {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"));
  let current: HTMLElement | null = elements[0] ?? null;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.top <= 120) {
      current = element;
    } else {
      break;
    }
  }
  return current;
}
