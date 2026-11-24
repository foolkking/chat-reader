import { AppendFileEntry } from "../../../../features/import/append-import-workspace";
export default async function Page({params}:{params:Promise<{conversationId:string}>}) {
  const {conversationId}=await params;
  return <AppendFileEntry key={conversationId} target={conversationId}/>;
}
