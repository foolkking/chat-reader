"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {useRouter} from "next/navigation";
import {useEffect, useRef, useState, type ReactNode} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {ArrowLeft, Check, FileInput} from "lucide-react";
import {usePreferences} from "../../components/preferences-provider";
import {ApiRequestError, appendImportApi, getAdaptiveUploadReceipt, getConversation,
  type AppendInput, type AppendReview, type AppendStatus} from "../../lib/api";
import {authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT, OFFLINE_ACCESS_LOCKED_EVENT} from "../../lib/offline-access";

const plain="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-accent hover:bg-subtle disabled:opacity-50";
const primary="inline-flex min-h-11 max-w-full items-center justify-center gap-2 break-words rounded-lg bg-[var(--text)] px-4 py-2 text-sm font-semibold text-[var(--surface)] disabled:opacity-50";
const field="min-h-11 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary";
const api=appendImportApi;
const PrepareSource=dynamic(()=>import("./append-prepare-source"));
const busyState=(s?:AppendStatus)=>!!s&&!s.result&&["uploaded","pending","analyzing","queued","processing"].includes(s.status);
const zhRole=(role:string,zh:boolean)=>({user:zh?"提问":"User",assistant:zh?"回答":"Assistant",system:zh?"系统":"System",tool:zh?"工具":"Tool"}[role]??(zh?"消息":"Message"));

function useEpoch(){
  const [epoch,refresh]=useState(authenticationGeneration);
  useEffect(()=>{
    const update=()=>refresh(authenticationGeneration());
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT,update);
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT,update);
    return ()=>{window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT,update);window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT,update);};
  },[]);
  return epoch;
}

function Sheet({title,back,backText,children}:{title:string;back:string;backText:string;children:ReactNode}){
  return <main className="h-full overflow-y-auto bg-page text-primary"><div className="mx-auto w-full max-w-2xl px-4 pb-12 pt-5 sm:px-8 sm:pt-8">
    <Link href={back} className={plain}><ArrowLeft className="h-4 w-4" aria-hidden="true"/>{backText}</Link>
    <h1 className="mb-5 mt-2 border-b border-ui pb-4 text-xl font-semibold">{title}</h1>{children}
  </div></main>;
}

export function AppendFileEntry({target}:{target:string}){
  const epoch=useEpoch();
  return <FileStage key={`${target}:${epoch}`} target={target} epoch={epoch}/>;
}

function FileStage({target,epoch}:{target:string;epoch:number}){
  const zh=usePreferences().resolvedLocale==="zh-CN", router=useRouter();
  const tr=(a:string,b:string)=>zh?a:b;
  const detail=useQuery({queryKey:["append-fixed-target",target,epoch],retry:false,queryFn:({signal})=>getConversation(target,signal)});
  const [files,setFiles]=useState<File[]>([]), [sending,setSending]=useState(false), [unconfirmed,setUnconfirmed]=useState(false);
  const [error,setError]=useState(""),key=useRef(""),flight=useRef<AbortController|null>(null);
  useEffect(()=>()=>{flight.current?.abort();},[]);
  const submit=async()=>{
    if(flight.current||!files.length||!key.current||detail.data?.status!=="active")return;
    const ctrl=new AbortController();flight.current=ctrl;setSending(true);setError("");
    const current=()=>!ctrl.signal.aborted&&authenticationGeneration()===epoch;
    try{
      let id:string|undefined;
      if(unconfirmed)id=(await getAdaptiveUploadReceipt(key.current,ctrl.signal)).receipt?.import_id;
      if(!id)id=(await api.stage(target,files,key.current,ctrl.signal)).id;
      if(!current())return;
      // Never let a stale receipt silently take a fixed-target flow elsewhere.
      const s=await api.status(id,ctrl.signal);
      if(!current())return;
      if(s.target!==target)throw Error("Different destination");
      router.replace(`/append-imports/${s.id}`);
    }catch(e){
      if(!current())return;
      const unknown=!(e instanceof ApiRequestError)||e.status>=500;
      setUnconfirmed(unknown);
      setError(unknown?tr("上传结果未确认；保留了文件，重试会先核对原请求。","Upload not confirmed. Your files are retained; retry checks the original request first."):
        e instanceof ApiRequestError&&e.status===413?tr("文件超过此实例的上传限制。","Files exceed this instance’s upload limit."):
        tr("未能受理文件。请检查权限、文件格式和大小。","Files were not accepted. Check permission, size and format."));
    }finally{if(flight.current===ctrl){flight.current=null;if(current())setSending(false);}}
  };
  return <Sheet title={tr("追加导入内容","Append imported messages")} back={`/conversations/${target}`} backText={tr("返回对话","Back to conversation")}>
    {detail.isError?<p role="alert">{tr("当前对话不可用。","This conversation is unavailable.")}</p>:!detail.data?<p role="status">{tr("读取对话…","Loading conversation…")}</p>:
    <div className="space-y-5">
      <div><p className="text-xs font-semibold text-secondary">{tr("固定目标","Destination")}</p><h2 className="mt-1 break-words font-semibold">{detail.data.display_title}</h2></div>
      {detail.data.status!=="active"?<p role="alert">{tr("此对话不能追加。","This conversation cannot receive messages.")}</p>:<>
        <label className="block space-y-2"><span className="text-sm font-medium">{tr("选择来源文件","Choose source files")}</span>
          <input type="file" multiple accept=".md,.markdown,.json,.jsonl,.zip" disabled={sending} className={`${field} py-2`} onChange={e=>{
            setFiles(Array.from(e.target.files??[]));key.current=crypto.randomUUID();setUnconfirmed(false);setError("");
          }}/></label>
        <p className="text-sm text-secondary">{tr("先解析文件，再勾选要追加的消息。现有内容不会被替换。","Review messages from these files before appending. Existing content is never replaced.")}</p>
        {error&&<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        <button type="button" className={primary} disabled={sending||!files.length} onClick={()=>void submit()}><FileInput aria-hidden="true" className="h-4 w-4"/>
          {sending?tr("正在核对…","Checking…"):unconfirmed?tr("核对并重试","Check and retry"):tr("解析并选择内容","Review file contents")}</button>
      </>}
    </div>}
  </Sheet>;
}

export function AppendWorkspace({id}:{id:string}){
  const epoch=useEpoch();
  return <Workspace key={`${id}:${epoch}`} id={id} epoch={epoch}/>;
}

function Workspace({id,epoch}:{id:string;epoch:number}){
  const zh=usePreferences().resolvedLocale==="zh-CN",tr=(a:string,b:string)=>zh?a:b;
  const meta=useQuery({queryKey:["append-source",id,epoch],queryFn:({signal})=>api.status(id,signal),retry:false,
    refetchInterval:q=>busyState(q.state.data)?1200:false});
  const [book,setBook]=useState<number|null>(null),[prepare,setPrepare]=useState(false);
  const s=meta.data,src=s?.sources.find(x=>x.ordinal===(book??s?.submitted_selection?.volume??0))??s?.sources[0];
  const target=s?.result?.target??s?.target;
  const failed=s?.status==="failed"&&!!s.pending_receipt;
  return <Sheet title={tr("追加导入内容","Append imported messages")} back={target?`/conversations/${target}`:"/"}
    backText={target?tr("返回对话","Back to conversation"):tr("返回对话列表","Back to conversations")}>
    {meta.isError?<div role="alert">{tr("无法核对此次导入。请确认登录的 Reader 账号和访问权限。","Cannot check this import. Verify the Reader account and access.")} <button className={plain} onClick={()=>void meta.refetch()}>{tr("重试","Retry")}</button></div>
    :s?.result?<section aria-live="polite" className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Check className="h-5 w-5 text-accent" aria-hidden="true"/>{tr(s.result.partial?"已追加，部分资源缺失":"核对完成",s.result.partial?"Appended with missing resources":"Finished")}</h2>
      <p>{tr(`已追加 ${s.result.added} 条消息，跳过 ${s.result.skipped} 条重复消息。`,`${s.result.added} appended; ${s.result.skipped} duplicates skipped.`)}</p>
      <Link className={primary} href={`/conversations/${s.result.target}`}>{tr("打开目标对话","Open destination conversation")}</Link></section>
    :s?.edition&&src&&(s.status==="previewed"||failed||!!s.pending_receipt)?<>
      {s.sources.length>1&&<label className="mb-4 block text-sm">{tr("来源对话","Source conversation")}<select className={field} disabled={busyState(s)} value={src.ordinal}
        onChange={e=>setBook(Number(e.target.value))}>{s.sources.map(b=><option key={b.ordinal} value={b.ordinal}>{b.title} · {b.count}</option>)}</select></label>}
      <ChooseMessages key={`${s.edition}:${src.ordinal}`} meta={s} epoch={epoch} volume={src.ordinal} count={src.count} sourceTitle={src.title} zh={zh}/>
    </>:s?.target&&["RESOLVING","NEEDS_GROUPING","BLOCKED"].includes(s.state)?<section className="space-y-3">
      <h2 className="font-semibold">{tr(s.state==="NEEDS_GROUPING"?"先核对来源文件的分组":"先确认来源格式",s.state==="NEEDS_GROUPING"?"Check how the files are grouped":"Confirm the source format first")}</h2>
      <p className="text-sm text-secondary">{tr("尚未追加任何消息。确定怎样区分提问和回答后，还需要勾选内容并确认目标末尾。","Nothing has been appended. After reviewing how messages are recognized, choose the content and confirm the destination’s end.")}</p>
      {prepare?<PrepareSource id={id} target={s.target} epoch={epoch} zh={zh}/>:<button type="button" className={primary} onClick={()=>setPrepare(true)}>{tr("核对来源格式","Review source format")}</button>}
    </section>:!s||busyState(s)?<p role="status" className="text-sm text-secondary">{tr("正在解析来源，尚未追加任何消息…","Analyzing the source. Nothing has been appended yet…")}</p>:
    <div role="alert" className="space-y-2 text-sm"><p>{s.state==="NEEDS_GROUPING"?tr("文件之间的对应关系不明确。请分开提交能独立解析的一条对话。","The files could not be grouped reliably. Select one self-contained conversation."):
      tr("该来源未生成可选消息。没有更改目标对话。","No selectable messages are available. The destination was not changed.")}</p>
      {s.target&&<Link className={plain} href={`/conversations/${s.target}/append`}>{tr("重新选择来源文件","Choose source files again")}</Link>}</div>}
  </Sheet>;
}

function ChooseMessages({meta,epoch,volume,count,sourceTitle,zh}:{meta:AppendStatus;epoch:number;volume:number;count:number;sourceTitle:string;zh:boolean}){
  const tr=(a:string,b:string)=>zh?a:b, cache=useQueryClient(),edition=meta.edition!;
  const submitted=meta.submitted_selection?.edition===edition&&meta.submitted_selection.volume===volume?meta.submitted_selection:null;
  const [page,go]=useState(0),[picked,setPicked]=useState<Set<number>>(()=>new Set(submitted?.indexes??(meta.excerpt&&count<=250?Array.from({length:count},(_,i)=>i):[])));
  const [chosen,setChosen]=useState<{id:string;title:string|null}|null>(()=>!meta.target&&submitted?{id:submitted.target,title:null}:null), [q,search]=useState(""),[destPage,setDestPage]=useState(0);
  const [manualReview,setReview]=useState<AppendReview|null>(null),[dismissed,dismiss]=useState<string|null>(null),[note,setNote]=useState(""),[running,setRunning]=useState(false),[uncertain,setUncertain]=useState(false);
  const [share,setShare]=useState(false),[partial,setPartial]=useState(false),[changed,setChanged]=useState(false);
  const ctrl=useRef<AbortController|null>(null),reviewBox=useRef<HTMLElement|null>(null);
  useEffect(()=>()=>{ctrl.current?.abort();},[]);
  const target=meta.target??chosen?.id;
  const fixed=useQuery({queryKey:["append-fixed-target",target,epoch],enabled:!!target&&(!!meta.target||!chosen?.title),queryFn:({signal})=>getConversation(target!,signal),retry:false});
  const choices=useQuery({queryKey:["append-choices",meta.id,epoch,edition,volume,page],queryFn:({signal})=>api.choices(meta.id,edition,volume,page,signal),retry:false});
  const targets=useQuery({queryKey:["append-targets",meta.id,epoch,q,destPage],enabled:!meta.target&&!chosen,
    queryFn:({signal})=>api.targets(meta.id,q,destPage,signal),retry:false});
  const waiting=busyState(meta), locked=waiting||running||uncertain;
  const recover=meta.status==="failed"&&meta.pending_receipt&&meta.pending_receipt!==dismissed&&submitted&&target===submitted.target
    &&picked.size===submitted.indexes.length&&submitted.indexes.every(i=>picked.has(i))?meta.pending_receipt:null;
  // This is a read-only review. A stale queued decision never replays the
  // confirmation, grant or consent flags, even across multiple refreshes.
  const recovery=useQuery({queryKey:["append-recovery",meta.id,epoch,edition,volume,recover],enabled:!!recover&&!manualReview&&!uncertain,
    queryFn:({signal})=>api.review(meta.id,submitted!,signal),retry:false,refetchOnMount:"always",refetchOnWindowFocus:false});
  const review=manualReview??(recover&&!recovery.isFetching&&!recovery.isError?recovery.data:null);
  const clearReview=()=>{setShare(false);setPartial(false);setChanged(false);setReview(null);dismiss(meta.pending_receipt);setNote("");};
  const selected=(next:Set<number>)=>{if(locked)return;if(next.size>250){setNote(tr("单次最多选择 250 条消息。","Select up to 250 messages at a time."));return;}clearReview();setPicked(next);};
  const moveFocus=()=>requestAnimationFrame(()=>reviewBox.current?.focus());
  const acceptReview=(r:AppendReview)=>{clearReview();setReview(r);moveFocus();};
  const taskKey=["append-source",meta.id,epoch];
  const run=async(action:"review"|"confirm"|"check")=>{
    if(ctrl.current||waiting||!target||!picked.size)return;
    const ac=new AbortController();ctrl.current=ac;setRunning(true);setNote("");
    const current=()=>!ac.signal.aborted&&authenticationGeneration()===epoch;
    const data:AppendInput={target,edition,volume,indexes:[...picked].sort((a,b)=>a-b)};
    try{
      if(action==="check"){
        const now=await api.status(meta.id,ac.signal); if(!current())return;cache.setQueryData(taskKey,now);setUncertain(false);
        if(!busyState(now)&&!now.result){clearReview();setNote(tr("尚未确认成功，请重新核对末尾。","No confirmed result. Review the end again."));}
      }else if(action==="review"){
        const r=await api.review(meta.id,data,ac.signal);if(current())acceptReview(r);
      }else if(review){
        const now=await api.confirm(meta.id,data,review.receipt,{allow_share:share,allow_partial:partial,allow_changed:changed},ac.signal);
        if(current()){cache.setQueryData(taskKey,now);clearReview();}
      }
    }catch(e){
      if(!current())return;
      if(e instanceof ApiRequestError&&e.code==="APPEND_REVIEW_CHANGED"&&e.details?.review){
        acceptReview(e.details.review as AppendReview);setNote(tr("末尾或分享状态已变化。已保留勾选，请核对新的末尾后再次确认。","The end or sharing changed. Your selection is kept; review the new end and confirm again."));
      }else if(action==="confirm"||action==="check"){setUncertain(true);setNote(tr("尚未确认追加结果。请先核对这次请求，不要再次发送。","The result is unconfirmed. Check this request before sending again."));}
      else {clearReview();setNote(tr("未能核对来源或目标，请检查访问权限并重试。","Could not review the source or destination. Check access and retry."));}
    }finally{if(ctrl.current===ac){ctrl.current=null;if(current())setRunning(false);}}
  };
  return <div className="space-y-6">
    <section aria-label={tr("追加目标","Append destination")} className="border-b border-ui pb-4"><p className="text-xs font-semibold text-secondary">{meta.target?tr("固定目标","Destination"):tr("追加到","Append to")}</p>
      {meta.target||chosen?<div className="mt-1 flex items-center justify-between gap-3"><h2 className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{fixed.data?.display_title??chosen?.title??(fixed.isError?tr("目标对话暂不可用","Destination unavailable"):tr("正在核对目标对话…","Checking destination…"))}</h2>
        {!meta.target&&<button type="button" className={`${plain} shrink-0 whitespace-nowrap`} disabled={locked} onClick={()=>{clearReview();setChosen(null);}}>{tr("更改对话","Change conversation")}</button>}</div>:
      <><label className="my-2 block text-sm">{tr("查找目标对话","Find destination by title")}<input className={field} type="search" maxLength={200} value={q} onChange={e=>{search(e.target.value);setDestPage(0);}}/></label>
        {targets.isError?<button className={plain} onClick={()=>void targets.refetch()}>{tr("重试读取目标","Retry loading destinations")}</button>:targets.isLoading?<p role="status">{tr("查找中…","Searching…")}</p>:
        <ul className="max-h-56 divide-y overflow-y-auto">{targets.data?.items.map(x=><li key={x.id}><button type="button" className={`${plain} w-full justify-between text-start`} onClick={()=>{clearReview();setChosen(x);}}><span className="min-w-0 break-words">{x.title}</span><span className="text-xs text-secondary">{x.project??tr("未归类","Unfiled")}</span></button></li>)}</ul>}
        {targets.data&&!targets.data.items.length&&<p>{tr("没有匹配的活动对话。","No matching active conversations.")}</p>}
        {(destPage>0||targets.data?.more)&&<div><button className={plain} disabled={!destPage} onClick={()=>setDestPage(destPage-1)}>{tr("上一页目标","Previous targets")}</button><button className={plain} disabled={!targets.data?.more} onClick={()=>setDestPage(destPage+1)}>{tr("下一页目标","More targets")}</button></div>}
      </>}</section>
    <section className="space-y-2"><div className="min-w-0"><h2 className="break-words font-semibold">{sourceTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{tr(`共 ${count} 条消息 · 已选 ${picked.size} 条`,`${count} messages · ${picked.size} selected`)}</p></div>
      <div role="group" aria-label={tr("消息选择操作","Message selection actions")} className="flex min-h-11 items-center justify-end gap-2">
        <button type="button" className="inline-flex min-h-11 items-center rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-accent hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50"
          disabled={locked||!choices.data?.items.length} onClick={()=>selected(new Set([...picked,...(choices.data?.items??[]).map(r=>r.index)]))}>{tr("全选本页","Select this page")}</button>
        {picked.size>0&&<button type="button" className={plain+" text-secondary"} disabled={locked} onClick={()=>selected(new Set())}>{tr("清空","Clear")}</button>}
      </div>
      {choices.isError?<button className={plain} onClick={()=>void choices.refetch()}>{tr("重试读取消息","Retry loading messages")}</button>:choices.isLoading?<p role="status">{tr("读取消息…","Loading messages…")}</p>:
        <ul className="mt-2 divide-y border-y border-ui">{choices.data?.items.map(r=><li key={r.index}><label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
          <input type="checkbox" className="mt-1 shrink-0 accent-[var(--accent)]" aria-label={`${r.index+1} · ${zhRole(r.role,zh)}`} disabled={locked} checked={picked.has(r.index)} onChange={e=>{const n=new Set(picked);if(e.target.checked)n.add(r.index);else n.delete(r.index);selected(n);}}/>
          <span className="min-w-0"><span className="block font-medium tabular-nums">{r.index+1} · {zhRole(r.role,zh)}{r.assets>0&&<span className="ml-2 text-xs text-secondary">{tr(`${r.assets} 个附件`,`${r.assets} attachments`)}</span>}</span>
            <span className="block break-words text-secondary">{r.text||tr("无文字","No text")}</span></span></label></li>)}</ul>}
      {count>(choices.data?.page_size??40)&&<nav aria-label={tr("来源消息分页","Source message pages")} className="flex items-center gap-3"><button className={plain} disabled={locked||!page} onClick={()=>go(page-1)}>{tr("上一页","Previous")}</button><span className="text-xs tabular-nums">{page+1} / {Math.ceil(count/(choices.data?.page_size??40))}</span><button className={plain} disabled={locked||(page+1)*(choices.data?.page_size??40)>=count} onClick={()=>go(page+1)}>{tr("下一页","Next")}</button></nav>}
    </section>
    {meta.status==="failed"&&meta.pending_receipt&&!note&&<p role="alert" className="text-sm text-secondary">{recover
      ?tr("上次追加未完成。已保留勾选，请核对当前末尾后再次确认。","The previous append did not complete. Your selection is kept; review the current end and confirm again.")
      :tr("上次追加未完成。请核对当前末尾，再决定是否继续。","The previous append did not complete. Review the current end before continuing.")}</p>}
    {note&&<p role="alert" className="text-sm text-secondary">{note}</p>}
    {uncertain?<button className={plain} disabled={running} onClick={()=>void run("check")}>{tr("核对本次请求","Check this request")}</button>:
      waiting?<p role="status">{tr("已受理，正在核对并追加。可离开后返回本页查看结果。","Accepted. Checking and appending; return here for the result.")}</p>:
      !review?<button type="button" className={primary} disabled={running||!target||!picked.size} onClick={()=>void run("review")}>{running?tr("正在核对…","Checking…"):tr("核对追加位置","Review append position")}</button>:
      <section ref={reviewBox} tabIndex={-1} className="space-y-3 rounded-lg border border-ui bg-subtle p-4 focus:outline-none" aria-label={tr("核对追加位置","Review append position")}>
        <h2 className="break-words font-semibold">{tr(`《${review.title}》的当前末尾`,`Current end of “${review.title}”`)}</h2>
        <blockquote className="border-l-2 border-[var(--accent)] pl-3 text-sm text-secondary">{review.tail?`${zhRole(review.tail.role,zh)} · ${review.tail.text||tr("无文字","No text")}`:tr("当前为空对话。","This conversation is empty.")}</blockquote>
        {review.skip>0&&<p className="text-sm">{tr(`将跳过 ${review.skip} 条已存在的消息。`,`${review.skip} already present; they will be skipped.`)}</p>}
        {review.add>0&&([[review.live_share,share,setShare,tr("我了解这些新增消息会出现在实时分享中。","I understand live shares may show the new messages.")],
          [review.partial,partial,setPartial,tr(`来源不完整（已知缺少 ${review.missing} 项资源），仍追加所选正文。`,`Source is incomplete (${review.missing} known missing resources); append selected text anyway.`)],
          [review.changed>0,changed,setChanged,tr("来源内容已改变；仅在末尾追加新版本，保留旧内容。","Source content changed; append the new version at the end and keep the existing content.")]] satisfies [boolean,boolean,(v:boolean)=>void,string][]).map(([needed,value,set,label],i)=>needed?<label key={i} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={value} onChange={e=>set(e.target.checked)}/>{label}</label>:null)}
        {review.add>0?<button className={primary} disabled={running||review.live_share&&!share||review.partial&&!partial||review.changed>0&&!changed} onClick={()=>void run("confirm")}>{tr(`追加 ${review.add} 条消息到《${review.title}》末尾`,`Append ${review.add} messages to the end of “${review.title}”`)}</button>:
        <Link className={plain} href={`/conversations/${target}`}>{tr("无须追加，打开已有对话","Nothing to append. Open conversation")}</Link>}
      </section>}
  </div>;
}
