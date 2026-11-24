import { ProjectExportPage } from "../../../../features/projects/project-export-page";

export default async function Page({params}:{params:Promise<{projectId:string}>}) {
  const {projectId} = await params;
  return <ProjectExportPage key={projectId} projectId={projectId}/>;
}
