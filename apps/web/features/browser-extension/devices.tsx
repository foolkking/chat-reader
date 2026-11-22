"use client";
import { useState } from "react";
type Device={id:string;created_at:string;expires_at:string};

export function ExtensionDevices({zh}:{zh:boolean}) {
  const [rows,setRows]=useState<Device[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  async function refresh(id?:string) {
    setBusy(true);setError(false);
    try{
      if(id&&!(await fetch(`/api/extension-devices/${id}`,{method:"DELETE"})).ok)throw Error();
      const res=await fetch("/api/extension-devices",{cache:"no-store"});if(!res.ok)throw Error();
      setRows((await res.json()).items);
    }catch{setError(true);}finally{setBusy(false);}
  }
  return <details className="border-t border-ui" onToggle={e=>{if(e.currentTarget.open&&rows===null&&!busy)void refresh();}}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{zh?"已授权的浏览器插件":"Authorized browser extensions"}</summary>
    {rows?.length===0?<p className="text-xs text-secondary">{zh?"没有已授权的插件。":"No authorized extensions."}</p>:null}
    {rows?.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-ui py-1 text-xs">
      <span>Chat Reader · {new Date(d.created_at).toLocaleString()}</span>
      <button className="btn-secondary min-h-11 px-2" disabled={busy} onClick={()=>void refresh(d.id)}>{zh?"撤销授权":"Revoke access"}</button></div>)}
    {error?<button role="alert" className="min-h-11 text-sm text-accent" onClick={()=>void refresh()}>{zh?"状态未确认，重新读取":"Status unknown. Check again"}</button>:null}
  </details>;
}
