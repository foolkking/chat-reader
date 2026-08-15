import { ProjectConversationList } from "../../../features/projects/project-conversation-list";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectConversationList projectId={projectId} />;
}
