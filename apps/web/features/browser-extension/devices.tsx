"use client";
import { useEffect, useRef, useState } from "react";
import { readAuthSession } from "../../lib/auth-client";
type Device={id:string;name?:string;created_at:string;expires_at:string};

export function ExtensionDevices({zh,expanded=false}:{zh:boolean;expanded?:boolean}) {
  const [rows,setRows]=useState<Device[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const [enabled,setEnabled]=useState(false),[code,setCode]=useState(""),[notice,setNotice]=useState("");
  const [preview,setPreview]=useState<{user:string;account:string;name:string;code:string}|null>(null);
  const locked=useRef(false),version=useRef(0);
  useEffect(()=>()=>{version.current++;},[]);
  async function pair(approve:boolean){
    if(locked.current)return;locked.current=true;setBusy(true);setNotice("");const n=++version.current;
    try{
      const a=await readAuthSession();if(!a.authenticated||!a.user_id||approve&&preview?.user!==a.user_id)throw Error("identity");
      const res=await fetch("/api/extension-devices/pair/"+(approve?"approve":"preview"),{method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({code:code.trim().toUpperCase(),expected_user_id:a.user_id})});
      if(!res.ok)throw Error(String(res.status));if(version.current!==n)return;
      if(approve){setCode("");setPreview(null);setNotice(zh?"已批准。请回到发起配对的插件。":"Approved. Return to the extension.");await refresh();}
      else{const data=await res.json();if(version.current===n)setPreview({user:a.user_id,account:a.display_name||a.email||"Reader",name:data.device_name,code});}
    }catch(e){if(version.current!==n)return;setPreview(null);const reason=(e as Error).message;
      setNotice(reason==="429"?(zh?"尝试太频繁，请稍后再试。":"Too many attempts. Try later."):reason==="409"?(zh?"设备已满，请先撤销旧设备。":"Device limit reached. Revoke an old device."):
        reason==="404"?(zh?"短码不正确、已使用或已过期。":"Code is incorrect, expired or already used."):(zh?"未确认授权，请核对账号与设备列表。":"Authorization unconfirmed. Check the account and device list."));
    }finally{locked.current=false;setBusy(false);}
  }
  async function refresh(id?:string) {
    setBusy(true);setError(false);
    try{
      if(id&&!(await fetch(`/api/extension-devices/${id}`,{method:"DELETE"})).ok)throw Error();
      const res=await fetch("/api/extension-devices",{cache:"no-store"});if(!res.ok)throw Error();
      const data=await res.json();setRows(data.items);setEnabled(data.enabled);
    }catch{setError(true);}finally{setBusy(false);}
  }
  return <details open={expanded||undefined} className="border-t border-ui" onToggle={e=>{if(e.currentTarget.open&&rows===null&&!busy)void refresh();}}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{zh?"已授权的浏览器插件":"Authorized browser extensions"}</summary>
    {enabled?<form className="mb-3 space-y-2" onSubmit={e=>{e.preventDefault();void pair(!!preview);}}>
      <label className="block text-sm" htmlFor="reader-device-code">{zh?"插件配对短码":"Extension pairing code"}</label>
      <input id="reader-device-code" className="min-h-11 w-40 rounded-md border border-ui bg-surface px-3 font-mono uppercase" autoCapitalize="characters"
        autoComplete="off" spellCheck={false} maxLength={9} placeholder="XXXX-XXXX" value={code} disabled={busy}
        onChange={e=>{version.current++;setCode(e.target.value);setPreview(null);setNotice("");}}/>
      {preview?<p className="text-sm">{preview.name} · {preview.account}<br/>{zh?"允许此设备浏览、整理、导入你的对话，导出上下文和接续 Skill。仅批准你自己发起的配对。":"Allow this device to browse, organize, import and export your conversations and acquisition Skill. Approve only a code you requested."}</p>:null}
      <button type="submit" className="btn-primary min-h-11 px-3" disabled={busy||!/^[a-hj-np-z2-9]{4}-?[a-hj-np-z2-9]{4}$/i.test(code)}>{preview?(zh?"批准此设备":"Approve this device"):(zh?"核对设备":"Review device")}</button>
    </form>:null}
    {notice?<p role="status" className="text-sm">{notice}</p>:null}
    {rows?.length===0?<p className="text-xs text-secondary">{zh?"没有已授权的插件。":"No authorized extensions."}</p>:null}
    {rows?.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-ui py-1 text-xs">
      <span>{d.name||"Chat Reader"}<br/>{zh?"授权：":"Authorized: "}{new Date(d.created_at).toLocaleString()} · {zh?"到期：":"Expires: "}{new Date(d.expires_at).toLocaleDateString()}</span>
      <button className="btn-secondary min-h-11 px-2" disabled={busy} onClick={()=>void refresh(d.id)}>{zh?"撤销授权":"Revoke access"}</button></div>)}
    {error?<button role="alert" className="min-h-11 text-sm text-accent" onClick={()=>void refresh()}>{zh?"状态未确认，重新读取":"Status unknown. Check again"}</button>:null}
  </details>;
}
