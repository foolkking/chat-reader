"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "../../components/preferences-provider";
import { ContinuationDocument } from "./continuation-document";
import { ContinuationDropTarget } from "./continuation-drop-target";
import { ContinuationHistory } from "./continuation-history";
import type { ContinuationNavigate, ContinuationViewState } from "./continuation-index";
import { continuationApi as api, getTask } from "../../lib/api";
import { contextReturnFailureMessage, contextReturnRecovery } from "../../lib/context-return-recovery";
const button = "min-h-11 rounded-md border border-ui px-3 py-2 text-sm text-primary hover:bg-subtle disabled:opacity-50";
const readRetryDelay = (attemptIndex: number) => Math.min(5000, 750 * 2 ** attemptIndex);
const terminalTaskStatuses = ["committed", "failed", "cancelled"] as const;

export function ContinuationPanel({ conversationId: id, onDirtyChange, onBusyChange, onNavigate, viewState, onDiscardReady }: { conversationId: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; onNavigate?: ContinuationNavigate; viewState?: ContinuationViewState; onDiscardReady?: (discard: (() => Promise<void>) | null) => void }) {
  const { resolvedLocale } = usePreferences();
  const t = (zh: string, en: string) => resolvedLocale === "zh-CN" ? zh : en;
  const cache = useQueryClient();
  const state = useQuery({ queryKey: ["continuation", id, "state"], queryFn: ({ signal }) => api.state(id, signal), retry: 2, retryDelay: readRetryDelay, refetchInterval: 5000 });
  const history = useQuery({ queryKey: ["continuation", id, "history"], queryFn: ({ signal }) => api.revisions(id, 0, signal), retry: 2, retryDelay: readRetryDelay, refetchInterval: 5000 });
  const [surface, setSurface] = useState<"read" | "upload" | "history">("read");
  const [member, setMember] = useState<"current" | "index">(viewState?.member ?? "current");
  const [editorDirty, setEditorDirty] = useState(false);
  const editorDirtyRef = useRef(false);
  const reportEditorDirty = useCallback((value: boolean) => {
    editorDirtyRef.current = value; setEditorDirty(value);
    // The editor exists only on the read surface, without upload selections.
    onDirtyChange?.(value);
  }, [onDirtyChange]);
  const discardEditor = useRef<(() => Promise<void>) | null>(null);
  const registerDiscard = useCallback((discard: (() => Promise<void>) | null) => { discardEditor.current = discard; onDiscardReady?.(discard); }, [onDiscardReady]);
  const [editorBusy, setEditorBusy] = useState(false);
  const [documentKey, setDocumentKey] = useState(0);
  const [droppedFile, setDroppedFile] = useState<{ file: File; member: "current" | "index"; key: string } | null>(null);
  const resetAfterReturn = useRef(false);
  const completedReturn = useRef<string | null>(null);
  const uploadInFlight = useRef(false);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const packageKey = useRef(crypto.randomUUID());
  const [taskId, setTaskId] = useState<string | null>(null);
  const supersededReturn = useRef<string | null>(null);
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: ({ signal }) => getTask(taskId!, signal),
    enabled: Boolean(taskId),
    retry: 2,
    retryDelay: readRetryDelay,
    refetchInterval: query => terminalTaskStatuses.includes(query.state.data?.status as typeof terminalTaskStatuses[number]) ? false : query.state.error ? 4000 : 1500,
  });
  const taskStatus = task.data?.status;
  const taskRecovery = contextReturnRecovery(task.data);
  const taskIsTerminal = terminalTaskStatuses.includes(taskStatus as typeof terminalTaskStatuses[number]);
  const taskRecovering = Boolean(taskId) && task.isError && !taskIsTerminal;
  useEffect(() => {
    if (!taskId && state.data?.pending_return_task_id && state.data.pending_return_task_id !== supersededReturn.current) {
      setTaskId(state.data.pending_return_task_id);
    }
  }, [taskId, state.data?.pending_return_task_id]);
  const supersedeTerminalReturn = () => {
    if (taskIsTerminal) { supersededReturn.current = taskId; setTaskId(null); }
  };
  useEffect(() => {
    if (taskStatus !== "committed" || !taskId) return;
    const timer = setTimeout(() => { supersededReturn.current = taskId; setTaskId(null); }, 3000);
    return () => clearTimeout(timer);
  }, [taskStatus, taskId]);
  useEffect(() => {
    if (taskStatus === "committed" && taskId !== completedReturn.current) {
      completedReturn.current = taskId;
      if (resetAfterReturn.current) {
        resetAfterReturn.current = false;
        void discardEditor.current?.().catch(() => undefined);
        setDocumentKey(value => value + 1); reportEditorDirty(false);
      }
      void cache.invalidateQueries({ queryKey: ["continuation", id] });
    }
  }, [taskStatus, taskId, cache, id, reportEditorDirty]);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [baseGeneration, setBaseGeneration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const navigationInFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [formKey, setFormKey] = useState(0);
  const dirty = editorDirty || Object.keys(files).length > 0 || Boolean(packageFile);
  const taskBusy = Boolean(taskId) && !["committed", "failed", "cancelled"].includes(taskStatus ?? "");
  const stateRecovering = state.isError && Boolean(state.data);
  const historyRecovering = history.isError && Boolean(history.data);
  const readRecovering = stateRecovering || historyRecovering;
  const readUnavailable = (state.isError && !state.data) || (history.isError && !history.data);
  useEffect(() => { onDirtyChange?.(editorDirtyRef.current || Object.keys(files).length > 0 || Boolean(packageFile)); }, [editorDirty, files, packageFile, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || editorBusy); return () => onBusyChange?.(false); }, [busy, editorBusy, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const refresh = () => cache.invalidateQueries({ queryKey: ["continuation", id] });
  const run = async (action: () => Promise<void>, readOnly = false) => {
    if (!navigator.onLine) { setError(t("更新文件需要联网。", "Connect to update files.")); return; }
    setBusy(true); setReading(readOnly); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(e instanceof Error && e.message === "CONTEXT_BASE_CHANGED" ? t("文件已在其他窗口更新。已保留你的选择，请重新读取后再保存。", "Files changed in another window. Your selections remain; reload before saving.") : t("操作未完成，文件选择已保留，请重试。", "Operation incomplete. File selections are retained; retry.")); }
    finally { setBusy(false); setReading(false); }
  };
  const navigate = async (next: "read" | "upload" | "history", nextMember = member) => {
    if (busy || editorBusy || navigationInFlight.current) return;
    const unsaved = editorDirtyRef.current || Object.keys(files).length > 0 || Boolean(packageFile);
    if (unsaved && !window.confirm(t("放弃未保存的更改？", "Discard unsaved changes?"))) return;
    navigationInFlight.current = true; setBusy(true); setReading(true);
    try {
      let latest: Awaited<ReturnType<typeof api.state>> | undefined;
      let revisions: Awaited<ReturnType<typeof api.revisions>> | undefined;
      if (next === "upload" || next === "history") {
        await cache.cancelQueries({ queryKey: ["continuation", id] });
        [latest, revisions] = await Promise.all([api.state(id), api.revisions(id)]);
      }
      // Consent is not permission to destroy a draft before the requested
      // destination can be read. A failed navigation leaves the editor intact.
      if (unsaved) {
        try { await discardEditor.current?.(); }
        catch { setError(t("未能清除本机草稿，请重试。", "Could not clear the local draft. Retry.")); return; }
        setFiles({}); setPackageFile(null); reportEditorDirty(false); setFormKey(v => v + 1); setBaseGeneration(null);
      }
      if (latest && revisions) {
        cache.setQueryData(["continuation", id, "state"], latest);
        cache.setQueryData(["continuation", id, "history"], revisions);
      }
      setSurface(next); setMember(nextMember); if (viewState) viewState.member = nextMember; setError(""); setNotice("");
    } catch {
      setError(t("无法读取最新文件状态，编辑和选择已保留，请重试。", "Could not load the latest file state. Edits and selections are retained; retry."));
    } finally {
      navigationInFlight.current = false; setBusy(false); setReading(false);
    }
  };
  const saveDropped = async (selection: { file: File; member: "current" | "index"; key: string }) => {
    if (uploadInFlight.current || busy || editorBusy || taskBusy || !state.data) return;
    const { file, member: targetMember } = selection;
    const packageInput = file.name.toLowerCase().endsWith(".context.zip");
    const correctMember = targetMember === "current" ? /\.md$/i.test(file.name) : /\.json$/i.test(file.name);
    if (!packageInput && !correctMember) {
      setError(targetMember === "current"
        ? t("Current 页接收 .md 或 .context.zip；Index 文件请拖入 Index 页。", "Current accepts .md or .context.zip. Drop an Index file on the Index tab.")
        : t("Index 页接收 .json 或 .context.zip；Current 文件请拖入 Current 页。", "Index accepts .json or .context.zip. Drop a Current file on the Current tab."));
      return;
    }
    if (!packageInput && file.size > (targetMember === "current" ? 1 : 8) * 1024 * 1024) {
      setError(t("文件超过大小限制。", "The file exceeds its size limit.")); return;
    }
    if ((editorDirtyRef.current || Object.keys(files).length > 0 || Boolean(packageFile)) && !window.confirm(t("用拖入的文件替换未保存的编辑？更新失败时仍保留编辑内容。", "Replace unsaved edits with the dropped file? Your edits remain if the update fails."))) return;
    setDroppedFile(selection); uploadInFlight.current = true;
    try {
      await run(async () => {
        const form = new FormData();
        form.append("base_generation", String(baseGeneration ?? state.data!.generation));
        await cache.cancelQueries({ queryKey: ["continuation", id] });
        if (packageInput) {
          form.append("file", file); form.append("idempotency_key", selection.key);
          const result = await api.returnPackage(id, form);
          resetAfterReturn.current = true; setTaskId(result.task_id);
        } else {
          form.append(targetMember, file);
          const result = await api.updateFiles(id, form);
          supersedeTerminalReturn();
          cache.setQueryData(["continuation", id, "state"], { generation: result.generation, adopted_revision_id: result.revision_id });
          await discardEditor.current?.().catch(() => { setError(t("文件已更新，但本机草稿未清除。", "File updated, but the local draft was not cleared.")); });
          setDocumentKey(value => value + 1); reportEditorDirty(false);
          setNotice(t("文件已更新。", "Files updated."));
          await refresh();
        }
        setDroppedFile(null); setFiles({}); setPackageFile(null); setBaseGeneration(null); setFormKey(value => value + 1);
      });
    } finally { uploadInFlight.current = false; }
  };
  const currentRevision = history.data?.find(row => row.id === state.data?.adopted_revision_id);
  // State and history refresh separately. Keep the last coherent document
  // mounted between responses so another window's save cannot destroy an
  // active editor (or briefly pair old text with the new save generation).
  const stableDocument = useRef<{ generation: number; revision: typeof currentRevision } | null>(null);
  if (state.data && history.data && (!state.data.adopted_revision_id || currentRevision)) {
    stableDocument.current = { generation: state.data.generation, revision: currentRevision };
  }
  const document = stableDocument.current;
  return <section className="min-w-0 space-y-5" aria-label={t("上下文接续", "Context continuation")}>
    <nav className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-ui bg-page" aria-label={t("接续内容", "Continuation content")}>
      <div className="flex gap-4">{(["current", "index"] as const).map(name => <button key={name} type="button" aria-pressed={surface === "read" && member === name} className={`min-h-12 border-b-2 px-1 text-sm ${surface === "read" && member === name ? "border-[var(--accent)] font-semibold text-primary" : "border-transparent text-secondary hover:text-primary"}`} onClick={() => navigate("read", name)}>{name === "current" ? "Current" : "Index"}</button>)}</div>
      <div className="flex gap-1"><button type="button" className="min-h-11 rounded-md px-3 text-sm text-secondary hover:bg-subtle" aria-pressed={surface === "upload"} onClick={() => navigate("upload")}>{t("更新文件", "Update files")}</button><button type="button" className="min-h-11 rounded-md px-3 text-sm text-secondary hover:bg-subtle" aria-pressed={surface === "history"} onClick={() => navigate("history")}>{t("历史", "History")}</button></div>
    </nav>
    {state.isLoading || history.isLoading ? <p role="status">{t("正在读取…", "Loading…")}</p> : null}
    {readUnavailable || error ? <div role="alert" className="space-y-2 text-sm text-[var(--danger)]"><p>{error || t("读取失败。", "Could not load files.")}</p><button className={button} disabled={busy} onClick={() => void run(async () => { await refresh(); const latest = await api.state(id); setBaseGeneration(latest.generation); setError(""); }, true)}>{t("重新读取", "Reload")}</button></div> : null}
    {readRecovering ? <p role="status" className="text-sm text-secondary">{t("暂时无法读取最新状态，正在自动重试；已保存的内容保持不变。", "The latest status is temporarily unavailable. Retrying automatically; saved content remains unchanged.")}</p> : null}
    {droppedFile ? <button type="button" className={button} disabled={busy || editorBusy || taskBusy} onClick={() => void saveDropped(droppedFile)}>{t("重试文件更新", "Retry file update")}</button> : null}
    {busy ? <p role="status" className="text-sm text-secondary">{reading ? t("正在读取，请稍候…", "Loading, please wait…") : t("正在保存，请稍候…", "Saving, please wait…")}</p> : null}
    {taskId ? <p role="status" className={`text-sm ${taskStatus === "failed" ? "text-[var(--danger)]" : "text-secondary"}`}>
      {taskRecovering ? t("暂时无法读取更新进度，最新状态尚未确认。会继续检查，也可稍后到任务中心查看。", "Update progress is temporarily unavailable. The latest state is unconfirmed. Status checks will resume; you can review it later in Task Center.") : taskStatus === "committed" ? t("整包中的接续文件已更新。", "Continuation files updated from package.") : taskStatus === "failed" && task.data ? contextReturnFailureMessage(task.data, resolvedLocale === "zh-CN") : taskStatus === "cancelled" ? t("更新已取消。", "Update cancelled.") : t("正在后台更新接续文件…可以关闭，重新打开会恢复进度。", "Updating continuation files… You can close and reopen to resume progress.")}
    </p> : null}
    {taskRecovery && taskRecovery.action !== "open_list" && surface !== "upload" ? <button type="button" className={button}
      disabled={busy || editorBusy} onClick={() => void navigate("upload")}>{t("重新选择文件", "Select files again")}</button> : null}
    {notice ? <p role="status" className="text-sm text-secondary">{notice}</p> : null}
    {surface === "read" && document ? <ContinuationDropTarget member={member} zh={resolvedLocale === "zh-CN"} disabled={busy || editorBusy || taskBusy} onFiles={selected => {
      if (selected.length !== 1) { setError(t("请一次拖入一个文件；同时更新两份文件可拖入 .context.zip。", "Drop one file at a time, or a .context.zip to update both.")); return; }
      void saveDropped({ file: selected[0], member, key: crypto.randomUUID() });
    }}><ContinuationDocument key={`${member}:${documentKey}`} conversationId={id} member={member} revision={document.revision} generation={document.generation} onDirtyChange={reportEditorDirty} onSavingChange={setEditorBusy} onDiscardReady={registerDiscard} onSaved={supersedeTerminalReturn} locked={busy || taskBusy} onUpload={() => navigate("upload")} onNavigate={onNavigate} viewState={viewState} />
      <p className="mt-8 pb-3 text-xs text-secondary">{member === "current" ? t("拖入 current.md 或 .context.zip 即可更新", "Drop current.md or .context.zip to update") : t("拖入 index.json 或 .context.zip 即可更新", "Drop index.json or .context.zip to update")}</p>
    </ContinuationDropTarget> : null}
    {surface === "upload" ? <div><h3 className="text-lg font-semibold">{t("更新接续文件", "Update continuation files")}</h3><p className="mt-2 text-sm leading-6 text-secondary">{t("上传 Current、Index 或整包。未替换的文件保持不变。", "Upload Current, Index or a package. Other files stay unchanged.")}</p></div> : null}
    {surface === "upload" ? <>
    <fieldset key={formKey} disabled={busy || taskBusy || !state.data} className="min-w-0 space-y-3">
      {[["current", "Current (.md, 1 MiB)"], ["index", "Index (.json, 8 MiB)"]].map(([name, label]) => <label key={name} className="block min-w-0 space-y-1 text-sm text-primary"><span>{label}</span><input type="file" accept={name === "current" ? ".md" : ".json"} className="min-h-11 w-full min-w-0 rounded-md border border-ui bg-surface p-2 text-base" onChange={e => { const file = e.target.files?.[0]; setFiles(old => { const next = { ...old }; if (file) next[name] = file; else delete next[name]; return next; }); setBaseGeneration(old => old ?? state.data?.generation ?? null); }} /></label>)}
      <button className={button} disabled={Object.keys(files).length === 0 || Boolean(packageFile)} onClick={() => void run(async () => {
        const form = new FormData(); Object.entries(files).forEach(([name, file]) => form.append(name, file));
        form.append("base_generation", String(baseGeneration ?? state.data?.generation ?? 0));
        await api.updateFiles(id, form); supersedeTerminalReturn(); setFiles({}); setFormKey(v => v + 1); setBaseGeneration(null); await refresh();
        setNotice(t("文件已更新。", "Files updated."));
      })}>{busy ? t("正在保存…", "Saving…") : t("保存上传文件", "Save uploaded files")}</button>
    </fieldset>
    <details className="border-t border-ui pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t("从 Context Package 更新", "Update from Context Package")}</summary>
      <p className="mb-3 text-sm leading-6 text-secondary">{t("仅保存包内 Current / Index，不导入正文或附件，也不判断接续内容。", "Save only Current / Index from the package. Raw and attachments are not imported; continuation content is not assessed.")}</p>
      <fieldset key={formKey} disabled={busy || taskBusy || !state.data} className="space-y-3">
        <label className="block text-sm"><span>Context Package (.context.zip)</span><input type="file" accept=".zip" className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-ui bg-surface p-2 text-base" onChange={e => { setPackageFile(e.target.files?.[0] ?? null); setBaseGeneration(old => old ?? state.data?.generation ?? null); packageKey.current = crypto.randomUUID(); }} /></label>
        <button className={button} disabled={!packageFile || Object.keys(files).length > 0} onClick={() => void run(async () => {
          if (!packageFile) return;
          const form = new FormData(); form.append("file", packageFile); form.append("base_generation", String(baseGeneration ?? state.data?.generation ?? 0)); form.append("idempotency_key", packageKey.current);
          setTaskId((await api.returnPackage(id, form)).task_id); setPackageFile(null); setFormKey(v => v + 1); setBaseGeneration(null);
        })}>{t("上传并更新文件", "Upload and update files")}</button>
        {Object.keys(files).length > 0 ? <p className="text-sm text-secondary">{t("请先保存或清除上方单文件选择。", "Save or clear the individual file selections above first.")}</p> : null}
      </fieldset>
    </details>
    {dirty ? <button type="button" className={button} disabled={busy || taskBusy} onClick={() => { setFiles({}); setPackageFile(null); setFormKey(v => v + 1); setBaseGeneration(null); }}>{t("清除文件选择", "Clear file selections")}</button> : null}
    </> : null}
    {surface === "history" && state.data ? <ContinuationHistory conversationId={id} rows={history.data ?? []} selectedRevisionId={state.data.adopted_revision_id} generation={state.data.generation} zh={resolvedLocale === "zh-CN"} disabled={busy || taskBusy} onBusy={setEditorBusy} onRestored={async (name, saved) => {
      supersedeTerminalReturn();
      await cache.cancelQueries({ queryKey: ["continuation", id] });
      cache.setQueryData(["continuation", id, "state"], { generation: saved.generation, adopted_revision_id: saved.revision_id });
      await refresh(); setDocumentKey(value => value + 1); setSurface("read"); setMember(name); if (viewState) viewState.member = name;
      setNotice(t("历史文件已恢复。", "Historical file restored."));
    }} /> : null}
  </section>;
}
