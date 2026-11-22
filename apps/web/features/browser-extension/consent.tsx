"use client";
import { useEffect, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { readAuthSession, type AuthSessionState } from "../../lib/auth-client";

export function ConsentScreen({client,challenge,state}:{client:string;challenge:string;state:string}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [account,setAccount] = useState<AuthSessionState | null>(null);
  const [error,setError] = useState(false), [busy,setBusy] = useState(false);
  useEffect(()=>{
    const ctrl = new AbortController();
    readAuthSession(ctrl.signal).then(a=>{if(!ctrl.signal.aborted)setAccount(a);},
      ()=>{if(!ctrl.signal.aborted)setError(true);});return ()=>ctrl.abort();
  },[]);
  async function authorize(){
    if(!account?.user_id||busy)return;
    setBusy(true);setError(false);
    try{
      const res=await fetch("/api/extension-devices/authorize",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({client,challenge,state,expected_user_id:account.user_id}),cache:"no-store"});
      if(!res.ok)throw Error();
      const url=new URL((await res.json()).redirect);
      if(url.origin!==`https://${client}.chromiumapp.org`||url.pathname!=="/reader"||url.searchParams.get("state")!==state)throw Error();
      window.location.replace(url.href);
    }catch{setBusy(false);setError(true);}
  }
  const valid=/^[a-p]{32}$/.test(client)&&[challenge,state].every(x=>/^[A-Za-z0-9_-]{43}$/.test(x));
  return <main className="mx-auto max-w-md space-y-4 px-4 py-8 text-primary">
    <h1 className="text-lg font-semibold">{zh?"连接 Chat Reader 浏览器插件":"Connect the Chat Reader browser extension"}</h1>
    <p className="break-words text-sm">{account?.display_name||account?.email||"Reader"} · {typeof window!=="undefined"?window.location.host:""}</p>
    <p className="border-y border-ui py-3 text-sm">{zh?"允许此设备查看你的项目和文件、移动或置顶对话、更改文件显示名、导入对话并导出上下文。它不能删除资料、创建分享或执行管理操作。":"This device can browse and organize your library, rename files, import conversations and export context. It cannot delete content, share it or administer Reader."}</p>
    <p className="text-xs text-secondary">{zh?"关闭 Reader 网页后授权仍有效。可在设置 → 账号安全撤销。":"Authorization stays active after you close Reader. Revoke it in Account security."}</p>
    <div className="flex flex-wrap gap-2"><button disabled={!valid||!account?.user_id||busy} onClick={authorize} className="btn-primary min-h-11 px-4">{zh?"授权此设备":"Authorize this device"}</button>
    <button className="btn-secondary min-h-11 px-4" onClick={()=>{if(valid)location.replace(`https://${client}.chromiumapp.org/reader?error=access_denied&state=${state}`);}}>{zh?"取消":"Cancel"}</button></div>
    {error||!valid?<p role="alert" className="text-sm text-[var(--danger)]">{zh?"未授权。请核对插件是否已在本实例登记，然后从插件重新连接。":"Not authorized. Verify this extension is registered, then reconnect from the extension."}</p>:null}
  </main>;
}
