import { AdminConversationReader } from "../../../../../../components/admin-conversation-reader";

export default async function AdminConversationPage({ params }: { params: Promise<{ userId: string; conversationId: string }> }) {
  const { userId, conversationId } = await params;
  return <AdminConversationReader userId={userId} conversationId={conversationId} />;
}
