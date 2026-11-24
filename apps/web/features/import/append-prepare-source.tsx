"use client";

import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useRouter} from "next/navigation";
import {getAdaptiveImportSession} from "../../lib/api";
import {authenticationGeneration} from "../../lib/offline-access";
import {AdaptiveImportWorkspace} from "./adaptive-import-workspace";

// Only reachable for an owner's fixed-target file. Reuse the same reviewed mapping
// and grouping editor; there is deliberately no whole-import callback.
export default function AppendPrepareSource({id,target,epoch,zh}:{id:string;target:string;epoch:number;zh:boolean}){
  const cache=useQueryClient(),router=useRouter(),key=["append-prepare-source",id,epoch];
  const q=useQuery({queryKey:key,queryFn:({signal})=>getAdaptiveImportSession(id,signal),retry:false,refetchOnWindowFocus:false});
  if(q.isError)return <div role="alert">{zh?"未能读取来源格式。":"Could not read source format."} <button type="button" className="min-h-11 text-accent" onClick={()=>void q.refetch()}>{zh?"重试":"Retry"}</button></div>;
  if(!q.data)return <p role="status">{zh?"正在读取来源格式…":"Loading source format…"}</p>;
  return <AdaptiveImportWorkspace session={q.data} importing={false} error={null}
    onBack={()=>router.push(`/conversations/${target}/append`)}
    onSession={next=>{
      if(next.import_id!==id||epoch!==authenticationGeneration())return;
      cache.setQueryData(key,next);void cache.invalidateQueries({queryKey:["append-source",id,epoch]});
    }}/>;
}
