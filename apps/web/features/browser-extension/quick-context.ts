"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { exportArtifactApi, getTask } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";

/** One action in the Reader menu; never download a previous user's or previous conversation's artifact. */
export function useQuickContext(cid: string, revision: number | undefined, zh: boolean) {
  const generation = authenticationGeneration();
  const scope = `${generation}:${cid}:${revision ?? ""}`;
  const run = useMemo(() => ({ scope, active: true, sending: false, key: "", downloaded: "" }), [scope]);
  const [state, setState] = useState({ scope: "", id: "", error: false, sending: false });
  const id = state.scope === scope ? state.id : "";
  const current = useCallback(() => run.active && generation === authenticationGeneration(), [generation, run]);
  useEffect(() => { run.active = true; return () => {run.active = false;}; }, [run]);
  const task = useQuery({ queryKey: ["task", id], queryFn: ({signal}) => getTask(id, signal), enabled: !!id,
    refetchInterval: q => ["committed","failed","cancelled","canceled"].includes(q.state.data?.status || "") ? false : 1200 });
  const artifact = typeof task.data?.result?.artifact_id === "string" ? task.data.result.artifact_id : "";
  const failed = !!task.isError || ["failed","cancelled","canceled"].includes(task.data?.status || "");
  const busy = state.scope === scope && (state.sending || !!id && !artifact && !failed);
  const save = useCallback(async (aid: string) => {
    if (!current()) return;
    try {
      const lease = await exportArtifactApi.claim(aid, crypto.randomUUID());
      if (!current()) return;
      const a = document.createElement("a"); a.href = lease.download_url; a.download = "";
      document.body.append(a); a.click(); a.remove();
    } catch {
      if (current()) {run.key = ""; setState({scope, id: "", sending: false, error: true});}
    }
  }, [current, scope, run]);
  useEffect(() => {
    if (artifact && run.downloaded !== artifact && current()) {run.downloaded = artifact; void save(artifact);}
  }, [artifact, run, current, save]);
  async function start() {
    if (busy || run.sending || !current()) return;
    if (artifact) {await save(artifact); return;}
    if (failed && !task.isError) run.key = "";
    run.key ||= crypto.randomUUID(); run.sending = true;
    setState({scope, id: "", sending: true, error: false});
    try {
      const r = await fetch(`/api/conversations/${cid}/quick-context`, {method: "POST", headers: {"Idempotency-Key": run.key}});
      if (!r.ok) throw Error();
      const result = await r.json();
      if (current()) setState({scope, id: result.id, sending: false, error: false});
    } catch {if (current()) setState({scope, id: "", sending: false, error: true});}
    finally {run.sending = false;}
  }
  const error = state.scope === scope && (state.error || failed);
  return {start, busy, error, label: artifact ? (zh ? "再次下载 .context.zip" : "Download .context.zip again")
    : busy ? (zh ? "正在生成上下文包…" : "Preparing context…") : (zh ? "导出上下文 .context.zip" : "Export .context.zip")};
}
