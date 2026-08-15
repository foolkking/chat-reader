import type { Metadata } from "next";
import { ConversationReader } from "../../../features/conversations/conversation-reader";

const APP_TITLE = "chat-reader";

type ConversationRouteParams = Promise<{ conversationId: string }>;

export async function generateMetadata({
  params,
}: {
  params: ConversationRouteParams;
}): Promise<Metadata> {
  try {
    const { conversationId } = await params;
    const apiUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${apiUrl}/api/conversations/${conversationId}`, { cache: "no-store" });
    if (!response.ok) return { title: APP_TITLE };
    const conversation = await response.json() as { title?: string; display_title?: string; project_name?: string | null };
    return { title: formatConversationTitle(conversation) };
  } catch {
    return { title: APP_TITLE };
  }
}

export default async function ConversationPage({
  params,
}: {
  params: ConversationRouteParams;
}) {
  const { conversationId } = await params;
  return <ConversationReader conversationId={conversationId} />;
}

function formatConversationTitle(conversation: { title?: string; display_title?: string; project_name?: string | null }): string {
  const title = (conversation.display_title || conversation.title || APP_TITLE).trim() || APP_TITLE;
  const project = conversation.project_name?.trim();
  return project ? `${project} / ${title}` : title;
}
