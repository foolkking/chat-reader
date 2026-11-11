import { ApiRequestError, continuationApi } from "./api";

export type ContinuationMember = "current" | "index";
export type ContinuationSaved = { generation: number; revision_id: string };
export type ContinuationIntent = {
  key: string;
  base: number;
  origin: "editor" | "upload" | "drop" | "history";
  member?: ContinuationMember;
} & ({ kind: "files"; members: Partial<Record<ContinuationMember, File>> } | { kind: "package"; file: File });
export type ContinuationWriteResult = { kind: "files"; saved: ContinuationSaved } | { kind: "package"; task_id: string };
export type ContinuationCheck = { state: "confirmed"; result: ContinuationWriteResult }
  | { state: "not_found" | "conflict" };

export function rejectedContinuationWrite(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export function continuationWriteError(error: unknown, zh: boolean): string {
  const code = error instanceof ApiRequestError ? error.code ?? error.message : "";
  if (code === "CONTEXT_BASE_CHANGED") return zh
    ? "另一个窗口已经更新文件。原文件和草稿已保留，请比较最新内容后再决定更新；不会自动覆盖。"
    : "Another window updated the files. Your files and drafts are retained. Compare the latest content before updating; nothing is overwritten automatically.";
  if (code === "CONTEXT_IDEMPOTENCY_CONFLICT") return zh
    ? "原请求已对应另一份内容，请到任务中心核对后重新选择文件。"
    : "The original request refers to different content. Check Task Center before selecting files again.";
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return zh
    ? "暂时无权访问这份接续文件，请确认登录和对话权限。"
    : "These continuation files are unavailable. Check your sign-in and conversation access.";
  if (error instanceof ApiRequestError && error.status === 413) return zh
    ? "文件超过大小限制，请缩小后重新选择；已保存内容不变。"
    : "The file exceeds the size limit. Reduce it and select it again; saved content is unchanged.";
  return zh ? "请求未被接受。原文件和草稿已保留，请检查格式或重新选择文件。"
    : "The request was not accepted. Your files and drafts are retained; check the format or select files again.";
}

export async function submitContinuationIntent(id: string, intent: ContinuationIntent): Promise<ContinuationWriteResult> {
  const form = new FormData();
  form.append("base_generation", String(intent.base));
  if (intent.kind === "package") {
    form.append("file", intent.file); form.append("idempotency_key", intent.key);
    const result = await continuationApi.returnPackage(id, form);
    if (!result || typeof result.task_id !== "string" || !result.task_id) throw new Error("Continuation receipt unavailable");
    return { kind: "package", task_id: result.task_id };
  }
  for (const [name, file] of Object.entries(intent.members)) form.append(name, file);
  const saved = await continuationApi.updateFiles(id, form);
  if (!saved || !Number.isInteger(saved.generation) || saved.generation < 0 || typeof saved.revision_id !== "string" || !saved.revision_id) throw new Error("Continuation acknowledgement unavailable");
  return { kind: "files", saved };
}

export async function checkContinuationIntent(id: string, intent: ContinuationIntent): Promise<ContinuationCheck> {
  if (intent.kind === "package") {
    const receipt = await continuationApi.returnReceipt(id, intent.key);
    if (!receipt || (receipt.task !== null && (!receipt.task || typeof receipt.task.task_id !== "string" || !receipt.task.task_id))) throw new Error("Continuation receipt unavailable");
    return receipt.task ? { state: "confirmed", result: { kind: "package", task_id: receipt.task.task_id } } : { state: "not_found" };
  }
  const before = await continuationApi.state(id);
  validateState(before);
  const rows = await continuationApi.revisions(id);
  const revision = rows.find(row => row.id === before.adopted_revision_id);
  if (before.adopted_revision_id && !revision) throw new Error("Continuation changed during verification");
  let matches = Boolean(revision);
  for (const [name, file] of Object.entries(intent.members)) {
    const member = name as ContinuationMember;
    if (file.size > (member === "current" ? 1 : 8) * 1024 * 1024) throw new Error("Continuation input exceeds its limit");
    if (!revision?.members[member]) { matches = false; continue; }
    // Compare actual bytes (including BOM/newlines), not normalized editor text.
    // Only the submitted members are read, serially, within existing limits.
    const actual = await continuationApi.memberBytes(id, revision.id, member);
    const wanted = new Uint8Array(await file.arrayBuffer());
    if (actual.length !== wanted.length || actual.some((byte, offset) => byte !== wanted[offset])) matches = false;
  }
  const after = await continuationApi.state(id);
  validateState(after);
  if (after.generation !== before.generation || after.adopted_revision_id !== before.adopted_revision_id) {
    throw new Error("Continuation changed during verification");
  }
  if (matches && revision) return { state: "confirmed", result: { kind: "files", saved: { generation: after.generation, revision_id: revision.id } } };
  return { state: after.generation === intent.base ? "not_found" : "conflict" };
}

function validateState(state: Awaited<ReturnType<typeof continuationApi.state>>) {
  if (!state || !Number.isInteger(state.generation) || state.generation < 0
    || (state.adopted_revision_id !== null && (typeof state.adopted_revision_id !== "string" || !state.adopted_revision_id))) {
    throw new Error("Continuation state unavailable");
  }
}
