"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { exportArtifactApi, getTask } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";

/** One action in the Reader menu; never download a previous user's or previous conversation's artifact. */
export function useQuickContext(cid: string, revision: number | undefined, zh: boolean) {
  const generation = authenticationGeneration();
  const scope = `${generation}:${cid}:${revision ?? ""}`;
  const run = useMemo(() => ({ scope, active: true, sending: false, key: "", claimedJob: "" }), [scope]);
  const [state, setState] = useState({ scope: "", id: "", error: "" as "" | "preset" | "export", sending: false });
  const [ready,setReady] = useState<{scope:string;artifact:string;summary:string}|null>(null);
  const id = state.scope === scope ? state.id : "";
  const current = useCallback(() => run.active && generation === authenticationGeneration(), [generation, run]);
  useEffect(() => { run.active = true; return () => {run.active = false;}; }, [run]);
  const task = useQuery({ queryKey: ["task", id], queryFn: ({signal}) => getTask(id, signal), enabled: !!id,
    refetchInterval: q => ["committed","failed","cancelled","canceled"].includes(q.state.data?.status || "") ? false : 1200 });
  const job = id && task.data?.job_id === id ? task.data : undefined;
  const artifact = job?.status === "committed" && typeof job.result?.artifact_id === "string" ? job.result.artifact_id : "";
  const terminalFailure = ["failed","cancelled","canceled"].includes(job?.status || "") || (job?.status === "committed" && !artifact);
  const failed = task.isError || terminalFailure;
  // A completed worker task is still busy until the browser has been handed the download.
  const busy = state.scope === scope && (state.sending || !!id && !failed);
  const save = useCallback(async (aid: string) => {
    if (!current()) return;
    try {
      const lease = await exportArtifactApi.claim(aid, crypto.randomUUID());
      if (!current()) return;
      const a = document.createElement("a"); a.href = lease.download_url; a.download = "";
      document.body.append(a); a.click(); a.remove();
      // The next user gesture is a NEW export. Presets and private notes may
      // have changed in another tab without changing the conversation revision.
      run.key = "";
      setState({scope, id: "", sending: false, error: ""});
    } catch {
      if (current()) {run.key = ""; setState({scope, id: "", sending: false, error: "export"});}
    }
  }, [current, scope, run]);
  useEffect(() => {
    if (artifact && run.claimedJob !== id && current()) {
      run.claimedJob = id;
      const d = job?.result?.context_delivery as {files:number;partial:boolean;current:boolean;index:boolean;continuation:string}|undefined;
      const summary=d?`${zh?"附件文件":"Files"}: ${d.files}${d.partial?(zh?"（部分未包含）":" (some not included)"):""} · ${[d.current?"Current":"",d.index?"Index":""].filter(Boolean).join(" + ")||
          (d.continuation==="unavailable"?(zh?"交接文件不可用":"Handoff unavailable"):(zh?"未含交接文件":"No handoff files"))}`:"";
      setReady({scope,artifact,summary});void save(artifact);
    }
  }, [id, artifact, run, current, save, scope, zh, job]);
  async function start() {
    if (busy || run.sending || !current()) return;
    if (id && task.isError && !terminalFailure) {await task.refetch(); return;}
    if (terminalFailure) run.key = "";
    run.key ||= crypto.randomUUID(); run.sending = true;
    setReady(null);
    setState({scope, id: "", sending: true, error: ""});
    try {
      const r = await fetch(`/api/conversations/${cid}/quick-context`, {method: "POST", headers: {"Idempotency-Key": run.key}});
      if (r.status === 409) {
        run.key = "";
        if (current()) setState({scope, id: "", sending: false, error: "preset"});
        return;
      }
      if (!r.ok) throw Error();
      const result = await r.json();
      if (current()) setState({scope, id: result.id, sending: false, error: ""});
    } catch {if (current()) setState({scope, id: "", sending: false, error: "export"});}
    finally {run.sending = false;}
  }
  const reason = state.scope === scope && (state.error || (failed ? "export" : ""));
  const error = reason === "preset" ? (zh ? "快捷预设已更改或不可用。请在「导出预设」中重新选择，再导出。" : "The quick preset changed or is unavailable. Choose a default in Export presets, then export again.")
    : reason ? (zh ? "上下文包未下载。请从对话菜单重试。" : "The context package was not downloaded. Retry from the conversation menu.") : "";
  return {start, busy, error, ready:ready?.scope===scope?ready:null, download:()=>ready?.scope===scope?save(ready.artifact):undefined,
    dismiss:()=>setReady(null),label: busy ? (zh ? "正在生成上下文包…" : "Preparing context…") : (zh ? "交给 AI · .context.zip" : "For AI · .context.zip")};
}
