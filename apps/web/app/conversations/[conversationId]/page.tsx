import { ConversationReader } from "../../../features/conversations/conversation-reader";

export default function ConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  return <ConversationReader conversationId={params.conversationId} />;
}
