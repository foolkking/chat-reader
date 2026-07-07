import { ProjectConversationList } from "../../../features/projects/project-conversation-list";

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  return <ProjectConversationList projectId={params.projectId} />;
}
