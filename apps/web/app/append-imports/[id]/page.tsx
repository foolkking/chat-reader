import { AppendWorkspace } from "../../../features/import/append-import-workspace";
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  return <AppendWorkspace key={id} id={id}/>;
}
