"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Download,
  Eye,
  File,
  GripVertical,
  Image as ImageIcon,
  Link2,
  LocateFixed,
  MoreHorizontal,
  Info,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
  RefreshCw,
  X,
} from "lucide-react";
import {
  cloneElement,
  useMemo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { measureImportImageLane } from "../import/image-import-lane";
import {
  ApiRequestError,
  createAttachmentUploadSession,
  deleteAttachmentUploadItem,
  deleteConversationAttachment,
  finalizeConversationAttachments,
  getAttachmentUploadSession,
  getCapabilities,
  getConversationAttachments,
  queueAttachmentDownload,
  getTask,
  updateConversationAttachment,
  uploadAttachmentItem,
} from "../../lib/api";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import { invalidateReaderSearch } from "../../lib/reader-search-cache";
import type { AttachmentRead, AttachmentUploadSessionRead, NavigateTarget } from "../../lib/types";
import { AttachmentPreviewDialog, readableBytes } from "./attachment-block";
import { attachmentExtension } from "./preview-adapter-registry";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { attachmentOccurrenceTarget } from "./attachment-location";
import { useAttachmentSearchActivation, useAttachmentSearchTarget } from "./use-attachment-search-target";
import { ExportArtifactDelivery } from "../exporting/export-artifact-delivery";
import { keepUploadReceipt, readUploadReceipts } from "./upload-receipts";

type Placement = "inline" | "after_message";
type FileFilter = "all" | "used" | "unused" | "missing";
type FileSort = "recent" | "name" | "type" | "size" | "usage";
type UploadEntry = {
  id: string;
  sessionRequestId: string;
  itemRequestId?: string;
  sessionAttempted?: boolean;
  uploadAttempted?: boolean;
  file?: File;
  filename: string;
  byteSize: number;
  mimeType: string;
  lastModified: number;
  status: "queued" | "uploading" | "uploaded" | "finalizing" | "unknown" | "failed" | "cancelled" | "committed";
  progress: number;
  uploadItemId?: string;
  sessionId?: string;
  expiresAt?: string;
  error?: string;
};

type ConversationFilesPanelProps = {
  conversationId: string;
  initialAttachmentId?: string | null;
  searchReplayKey?: number;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
  onInsert: (attachment: AttachmentRead, placement: Placement) => void;
};

export function ConversationFilesPanel(props: ConversationFilesPanelProps) {
  // Scope only this management workspace, never the Reader or its position.
  return <ConversationFilesWorkspace key={props.conversationId} {...props} />;
}

function ConversationFilesWorkspace({
  conversationId,
  initialAttachmentId,
  searchReplayKey = 0,
  onLocate,
  onInsert,
}: ConversationFilesPanelProps) {
  const { resolvedLocale, readerWidthMode, sectionTocMode } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const dialog = useInteractionDialog();
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const renameDrafts = useRef<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reselectRef = useRef<string | null>(null);
  const [receiptsReady, setReceiptsReady] = useState(false);
  const [receiptWarning, setReceiptWarning] = useState(false);
  const finalizeLanes = useRef(new Map<string, number>());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FileFilter>("all");
  const [sort, setSort] = useState<FileSort>("recent");
  const [grouped, setGrouped] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const downloadIntent = useRef<{ selection: string; key: string } | null>(null);
  const downloadTask = useQuery({
    queryKey: ["task", downloadJobId],
    queryFn: () => getTask(downloadJobId!),
    enabled: Boolean(downloadJobId),
    refetchInterval: query => ["committed", "failed", "cancelled"].includes(query.state.data?.status ?? "") ? false : 1500,
  });
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadGeneration = useRef(0);
  const uploadCancellable = useRef(false);
  const mounted = useRef(false);
  const activeUpload = useRef<{ generation: number; cancel: () => void } | null>(null);
  const searchActivation = useAttachmentSearchActivation(conversationId, initialAttachmentId, searchReplayKey);
  const receiptScope = `${conversationId}:files`;
  async function rememberUpload(entry: UploadEntry) {
    const { file, ...receipt } = entry;
    const saved = await keepUploadReceipt(receiptScope, receipt, file);
    if (mounted.current && !saved) setReceiptWarning(true);
  }
  useEffect(() => {
    let active = true;
    const generation = authenticationGeneration();
    void readUploadReceipts(receiptScope).then(rows => {
      if (!active || generation !== authenticationGeneration()) return;
      setUploadQueue(rows.map(({ receipt, file }) => ({ ...receipt, file, status: "unknown" as const })));
      setReceiptsReady(true);
    });
    return () => { active = false; };
  }, [receiptScope]);

  useEffect(() => {
    mounted.current = true;
    const retire = () => {
      uploadGeneration.current += 1;
      activeUpload.current?.cancel();
      activeUpload.current = null;
      uploadCancellable.current = false;
    };
    const authChanged = () => {
      retire();
      setUploadQueue([]);
      setError(null);
      setNotice(null);
      setUploading(false);
      setActionBusy(false);
      actionLock.current = false;
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, authChanged);
    return () => {
      mounted.current = false;
      retire();
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, authChanged);
    };
  }, [conversationId]);

  useEffect(() => {
    if (!initialAttachmentId) return;
    setSearch("");
    setFilter("all");
  }, [conversationId, initialAttachmentId, searchReplayKey]);

  const filesQuery = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
  });
  const attachmentById = useMemo(
    () => new Map((filesQuery.data ?? []).map((attachment) => [attachment.id, attachment])),
    [filesQuery.data],
  );
  const preview = previewId ? attachmentById.get(previewId) ?? null : null;
  const details = detailsId ? attachmentById.get(detailsId) ?? null : null;

  useEffect(() => {
    const availableIds = new Set(filesQuery.data?.map((attachment) => attachment.id) ?? []);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setPreviewId((current) => current && !availableIds.has(current) ? null : current);
    setDetailsId((current) => current && !availableIds.has(current) ? null : current);
  }, [filesQuery.data]);
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities"],
    queryFn: getCapabilities,
    staleTime: 60_000,
  });
  const capabilityPending = capabilitiesQuery.isPending && !capabilitiesQuery.data;
  const capabilityUnavailable = capabilitiesQuery.isError && !capabilitiesQuery.data;
  const uploadDisabled = !receiptsReady || capabilityPending || capabilityUnavailable || capabilitiesQuery.data?.attachments.upload_enabled === false;
  const renameMutation = useMutation({
    mutationFn: ({ attachmentId, displayName }: { attachmentId: string; displayName: string }) =>
      updateConversationAttachment(conversationId, attachmentId, displayName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] });
      invalidateReaderSearch(queryClient, { mode: "remote", conversationId });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-search"] });
    },
  });
  const detachMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteConversationAttachment(conversationId, attachmentId),
    onSuccess: (_data, attachmentId) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(attachmentId);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] })
        .catch(() => setError(zh ? "文件已移除，列表待刷新。" : "File detached. Refresh the list."));
    },
  });

  const files = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return [...(filesQuery.data ?? [])]
      .filter((item) => !needle || `${item.display_name} ${item.original_filename}`.toLocaleLowerCase().includes(needle))
      .filter((item) => {
        if (filter === "used") return Boolean(item.is_used);
        if (filter === "unused") return !item.is_used && item.resolution_status !== "missing";
        if (filter === "missing") return item.resolution_status === "missing" || item.status !== "available";
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.display_name.localeCompare(b.display_name);
        if (sort === "type") return attachmentMime(a).localeCompare(attachmentMime(b));
        if (sort === "size") return (a.asset_object?.byte_size ?? 0) - (b.asset_object?.byte_size ?? 0);
        if (sort === "usage") return (b.current_occurrence_count ?? (b.is_used ? b.occurrence_count : 0) ?? 0) - (a.current_occurrence_count ?? (a.is_used ? a.occurrence_count : 0) ?? 0);
        return b.created_at.localeCompare(a.created_at);
      });
  }, [filesQuery.data, filter, search, sort]);

  const groups = [
    { id: "unused", title: zh ? "尚未放入正文" : "Not placed", items: files.filter((item) => !item.is_used && item.resolution_status !== "missing" && item.status === "available") },
    { id: "used", title: zh ? "已在正文使用" : "Used in messages", items: files.filter((item) => item.is_used && item.resolution_status !== "missing" && item.status === "available") },
    { id: "missing", title: zh ? "缺失或不可用" : "Missing or unavailable", items: files.filter((item) => item.resolution_status === "missing" || item.status !== "available") },
  ];
  const visibleGroups = grouped
    ? groups
    : [{ id: "all", title: zh ? "全部文件" : "All files", items: files }];

  async function uploadFiles(selectedFiles: File[], retryEntryId?: string) {
    if (!selectedFiles.length || actionLock.current || !receiptsReady) return;
    if (!retryEntryId && uploadQueue.filter(entry => entry.status !== "committed").length + selectedFiles.length > 100) {
      setError(zh ? "队列最多保留 100 个文件，请先处理已有条目。" : "This queue holds up to 100 files. Finish existing entries first.");
      return;
    }
    const previous = retryEntryId ? uploadQueue.find(entry => entry.id === retryEntryId) : undefined;
    const entries: UploadEntry[] = previous ? [{ ...previous, file: selectedFiles[0] }] : selectedFiles.map(file => ({
      id: crypto.randomUUID(), sessionRequestId: crypto.randomUUID(), file,
      filename: file.name, byteSize: file.size, mimeType: file.type, lastModified: file.lastModified,
      status: "queued", progress: 0,
    }));
    // Unknown outcomes never get a new identity. Explicit source replacement
    // after a confirmed rejection is a new upload, not a retry of the old one.
    if (previous?.error === "expired" || previous?.error === "rejected") Object.assign(entries[0], {
      sessionRequestId: crypto.randomUUID(), sessionId: undefined, uploadItemId: undefined,
      itemRequestId: crypto.randomUUID(), sessionAttempted: false, uploadAttempted: false,
      filename: selectedFiles[0].name, byteSize: selectedFiles[0].size, mimeType: selectedFiles[0].type,
      lastModified: selectedFiles[0].lastModified, error: undefined,
    });
    if (previous?.error === "rejected" && previous.sessionId && previous.uploadItemId) {
      // This explicit replacement authorizes abandoning the rejected input.
      // Cleanup is independent; its server receipt remains if cleanup fails.
      void deleteAttachmentUploadItem(previous.sessionId, previous.uploadItemId).catch(() => undefined);
    }
    setUploadQueue(queue => previous ? queue.map(item => item.id === previous.id ? entries[0] : item)
      : [...queue.filter(item => item.status !== "committed"), ...entries]);
    actionLock.current = true; setActionBusy(true); setUploading(true); setError(null); setNotice(null);
    const generation = ++uploadGeneration.current;
    const access = authenticationGeneration();
    const current = () => mounted.current && access === authenticationGeneration();
    uploadCancellable.current = true;
    const publish = (entry: UploadEntry) => {
      if (current()) setUploadQueue(queue => queue.map(item => item.id === entry.id ? { ...entry } : item));
    };
    try {
      // One complete file at a time. Failure retains that entry and releases
      // the lane for the next independent selection, in its original order.
      for (const entry of entries) {
        if (!current() || generation !== uploadGeneration.current) break;
        try {
          if (!entry.file) throw new Error("Reselect the original file");
          entry.status = "uploading"; publish(entry);
          if (!entry.sessionId) {
            if (entry.sessionAttempted) throw new Error("CHECK_RECEIPT_FIRST");
            entry.sessionAttempted = true; publish(entry); await rememberUpload(entry);
            if (!current()) return;
            const session = await createAttachmentUploadSession(conversationId, { requestId: entry.sessionRequestId });
            if (!current()) return;
            entry.sessionId = session.id; entry.expiresAt = session.expires_at; publish(entry);
          }
          if (generation !== uploadGeneration.current) break;
          if (!entry.uploadItemId) {
            if (entry.uploadAttempted) throw new Error("CHECK_RECEIPT_FIRST");
            entry.uploadAttempted = true; publish(entry); await rememberUpload(entry);
            if (!current()) return;
            const upload = uploadAttachmentItem(entry.sessionId, entry.file, progress => {
              if (current() && generation === uploadGeneration.current) { entry.progress = progress; publish(entry); }
            }, entry.itemRequestId ?? entry.id);
            activeUpload.current = { generation, cancel: upload.cancel };
            const receipt = await upload.promise;
            if (!current()) return;
            entry.uploadItemId = receipt.id;
            if (receipt.validation_status !== "ready" && receipt.validation_status !== "committed") {
              entry.status = "failed"; entry.error = "rejected"; publish(entry); continue;
            }
          }
          entry.status = "uploaded"; entry.progress = 100; publish(entry);
          if (generation !== uploadGeneration.current) break;
          await finalizeUploadedEntries([entry], current);
        } catch (failure) {
          if (!current()) return;
          // A lost response or interrupted transfer is not proof of rollback.
          // The check button reads this exact session/item before retrying.
          entry.status = "unknown";
          entry.error = failure instanceof DOMException && failure.name === "AbortError" ? "cancelled" : "unconfirmed";
          publish(entry);
          void rememberUpload(entry);
        } finally {
          if (activeUpload.current?.generation === generation) activeUpload.current = null;
        }
      }
      if (current()) setUploadQueue(queue => queue.map(item => entries.some(entry => entry.id === item.id) && item.status === "queued"
        ? { ...item, status: "cancelled" } : item));
    } finally {
      if (current()) { uploadCancellable.current = false; setUploading(false); setActionBusy(false); actionLock.current = false; }
    }
  }

  async function finalizeUploadedEntries(entries: UploadEntry[], current: () => boolean) {
    const key = entries.map(entry => entry.uploadItemId).sort().join(",");
    const lane = finalizeLanes.current.get(key) ?? measureImportImageLane({ readerWidthMode, sectionTocMode });
    finalizeLanes.current.set(key, lane);
    const ids = new Set(entries.map((entry) => entry.id));
    setUploadQueue((queue) => queue.map((entry) => ids.has(entry.id) ? { ...entry, status: "finalizing" } : entry));
    try {
      for (const entry of entries) await rememberUpload({ ...entry, status: "finalizing" });
      if (!current()) return;
      await finalizeConversationAttachments(conversationId, entries.map((entry) => entry.uploadItemId!), lane);
    } catch {
      if (!current()) return;
      setUploadQueue((queue) => queue.map((entry) => ids.has(entry.id) ? { ...entry, status: "unknown" } : entry));
      setError(zh ? "附件提交结果尚未确认。先刷新核对，不要重新上传这些文件。" : "Finalization was not confirmed. Refresh to check the result before uploading these files again.");
      return;
    }
    if (!current()) return;
    setUploadQueue((queue) => queue.map((entry) => ids.has(entry.id) ? { ...entry, status: "committed" } : entry));
    for (const entry of entries) void rememberUpload({ ...entry, status: "committed" });
    try {
      const refreshed = await filesQuery.refetch();
      if (refreshed.isError) throw refreshed.error;
      if (current()) setNotice(zh ? `已将 ${entries.length} 个文件加入当前对话；失败项仍可单独处理。` : `${entries.length} files added. Failed items can still be handled individually.`);
    } catch {
      if (current()) setError(zh ? "文件已加入对话，但列表刷新失败。请刷新列表核对。" : "The files were added, but the list could not refresh. Refresh it to verify.");
    }
  }

  async function finishPendingUploads() {
    if (actionLock.current) return;
    const entries = uploadQueue.filter((entry) => entry.status === "uploaded");
    if (!entries.length) return;
    actionLock.current = true; setActionBusy(true); setError(null);
    const access = authenticationGeneration();
    const current = () => mounted.current && access === authenticationGeneration();
    try { for (const entry of entries) { if (!current()) return; await finalizeUploadedEntries([entry], current); } }
    finally { if (current()) { actionLock.current = false; setActionBusy(false); } }
  }

  function cancelUpload() {
    if (!uploadCancellable.current) return;
    uploadCancellable.current = false;
    uploadGeneration.current += 1;
    activeUpload.current?.cancel();
  }

  function retryUpload(entry: UploadEntry) {
    if (entry.status !== "failed" && entry.status !== "cancelled") return;
    if (!entry.file || entry.error === "rejected") { reselectRef.current = entry.id; inputRef.current?.click(); return; }
    void uploadFiles([entry.file], entry.id);
  }

  async function refreshAttachmentList() {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionBusy(true);
    setError(null);
    setNotice(null);
    const access = authenticationGeneration();
    const current = () => mounted.current && access === authenticationGeneration();
    try {
      const result = await filesQuery.refetch();
      if (result.isError) throw result.error;
      if (!current()) return;
      const accepted = new Set(result.data?.map((item) => item.source_attachment_id).filter(Boolean));
      const checked = new Map<string, Partial<UploadEntry>>();
      for (const entry of uploadQueue.filter(item => item.status === "unknown")) {
        if (entry.uploadItemId && accepted.has(entry.uploadItemId)) {
          checked.set(entry.id, { status: "committed" }); continue;
        }
        let session: AttachmentUploadSessionRead;
        try { session = await getAttachmentUploadSession(entry.sessionId ?? entry.sessionRequestId); }
        catch (failure) {
          if (failure instanceof ApiRequestError && failure.status === 404) {
            checked.set(entry.id, { status: "failed", error: "absent", sessionAttempted: false }); continue;
          }
          throw failure;
        }
        if (!current()) return;
        const receipt = session.items.find(item => item.id === (entry.uploadItemId ?? entry.itemRequestId ?? entry.id));
        if (receipt?.validation_status === "committed") checked.set(entry.id, { status: "committed" });
        else if (session.status === "expired" || Date.parse(session.expires_at) <= Date.now())
          checked.set(entry.id, { status: "failed", error: "expired" });
        else if (receipt?.validation_status === "ready" && session.status === "open")
          checked.set(entry.id, { status: "uploaded", uploadItemId: receipt.id, sessionId: session.id, progress: 100 });
        else checked.set(entry.id, { status: "failed", error: receipt ? "rejected" : "absent",
          sessionId: session.id, uploadAttempted: Boolean(receipt) });
      }
      setUploadQueue(queue => queue.map(entry => ({ ...entry, ...checked.get(entry.id) })));
      for (const entry of uploadQueue) if (checked.has(entry.id)) void rememberUpload({ ...entry, ...checked.get(entry.id) });
      setNotice(zh ? "文件列表已刷新" : "File list refreshed");
    } catch {
      if (current()) setError(zh ? "文件或上传状态核对失败，未确认项仍保留；请稍后重试。" : "Could not check the file or upload status. Unconfirmed entries are retained; try again.");
    } finally {
      if (current()) { setActionBusy(false); actionLock.current = false; }
    }
  }

  function toggleSelected(attachmentId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  }

  function selectedFiles() {
    const allFiles = filesQuery.data ?? [];
    return allFiles.filter((item) => selected.has(item.id));
  }

  async function downloadSelection() {
    if (actionLock.current || !selected.size) return;
    actionLock.current = true; setActionBusy(true); setError(null);
    const generation = authenticationGeneration();
    const ids = [...selected].sort();
    const selection = JSON.stringify(ids);
    if (downloadIntent.current?.selection !== selection) downloadIntent.current = { selection, key: crypto.randomUUID() };
    try {
      const task = await queueAttachmentDownload(conversationId, ids, downloadIntent.current.key);
      if (!mounted.current || generation !== authenticationGeneration()) return;
      setDownloadJobId(task.job_id);
      queryClient.setQueryData(["task", task.job_id], task);
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
      setNotice(zh ? "正在打包，可在任务中心查看进度。" : "Preparing ZIP. Progress is also available in Tasks.");
      downloadIntent.current = null;
    } catch {
      if (mounted.current && generation === authenticationGeneration())
        setError(zh ? "未能确认打包结果。重试会使用同一请求，不会重复创建任务；不可用的附件请移出选择。" : "Could not confirm the ZIP request. Retry safely with the same request; remove unavailable attachments.");
    } finally {
      actionLock.current = false;
      if (mounted.current) setActionBusy(false);
    }
  }

  async function detachSelection() {
    const removable = selectedFiles().filter((item) => !item.is_used);
    if (removable.length !== selected.size) {
      setError(zh ? "仍在当前正文中引用的文件不能移除。" : "Files still used by current messages cannot be detached.");
      return;
    }
    const promptText = zh ? `从当前对话文件中移除 ${removable.length} 个文件？` : `Detach ${removable.length} files from this conversation?`;
    await detachFiles(removable, promptText);
  }

  async function renameFile(attachment: AttachmentRead) {
    if (actionLock.current) return;
    actionLock.current = true;
    try {
      const name = await dialog.prompt({ title: zh ? "重命名显示名称" : "Rename display name", label: zh ? "显示名称" : "Display name", initialValue: renameDrafts.current[attachment.id] ?? attachment.display_name, confirmLabel: zh ? "保存" : "Save" });
      if (!name) return;
      renameDrafts.current[attachment.id] = name;
      setActionBusy(true); setError(null); setNotice(null);
      await renameMutation.mutateAsync({ attachmentId: attachment.id, displayName: name });
      delete renameDrafts.current[attachment.id];
      setNotice(zh ? "名称已保存" : "Name saved");
    } catch { setError(zh ? "改名失败，请重试；已保留输入的名称。" : "Rename failed. Retry with your entered name preserved."); }
    finally { actionLock.current = false; setActionBusy(false); }
  }

  async function detachFiles(removable: AttachmentRead[], title: string) {
    if (actionLock.current || !removable.length) return;
    actionLock.current = true;
    try {
      if (!await dialog.confirm({ title, confirmLabel: zh ? "移除" : "Detach", danger: true })) return;
      setActionBusy(true); setError(null); setNotice(null);
      let failed = 0;
      let referenced = false;
      for (const attachment of removable) {
        try { await detachMutation.mutateAsync(attachment.id); }
        catch (failure) {
          failed++; setSelected(current => new Set([...current, attachment.id]));
          if (failure instanceof ApiRequestError && failure.code === "attachment_in_use") {
            referenced = true; setDetailsId(attachment.id);
          }
        }
      }
      if (referenced) setError(zh ? "文件仍在正文中使用，请从引用列表定位并移除引用。" : "This file is still used. Locate and remove its references from the usage list first.");
      else if (failed) setError(zh ? `已移除 ${removable.length - failed} 项，${failed} 项失败；失败项已保留选择，可重试。` : `${removable.length - failed} detached, ${failed} failed. Failed items remain selected; retry.`);
      else setNotice(zh ? `已移除 ${removable.length} 个文件` : `${removable.length} files detached`);
    } finally { actionLock.current = false; setActionBusy(false); }
  }

  async function copyReference(id: string) {
    setError(null); setNotice(null);
    try { await navigator.clipboard.writeText(`cr-asset://${id}`); setNotice(zh ? "附件引用已复制" : "Attachment reference copied"); }
    catch { setError(zh ? "复制失败，请允许剪贴板访问后重试。" : "Copy failed. Allow clipboard access and retry."); }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-page"
      aria-label={zh ? "当前对话文件" : "Conversation files"}
      data-testid="conversation-files-panel"
    >
      {downloadJobId ? <div className="border-b border-ui p-3" aria-live="polite">
        {downloadTask.data?.result.artifact_id ? <ExportArtifactDelivery artifactId={downloadTask.data.result.artifact_id} scope={`attachments:${conversationId}`} onRegenerated={task => setDownloadJobId(task.job_id)} label={zh ? "下载附件 ZIP" : "Download attachments ZIP"} />
          : <p className="text-sm text-secondary">{downloadTask.data?.status === "failed" ? (zh ? "附件打包失败，请在任务中心查看原因。" : "ZIP creation failed. Check Tasks for details.") : downloadTask.error ? (zh ? "进度暂不可用，任务仍在服务器保留。" : "Progress unavailable. The server retains the task.") : `${zh ? "附件打包" : "Preparing ZIP"} · ${downloadTask.data?.progress ?? 0}%`}</p>}
        <button type="button" className="min-h-10 text-sm text-accent" onClick={() => window.dispatchEvent(new Event("chat-reader:open-task-center"))}>{zh ? "查看任务中心" : "Open Tasks"}</button>
      </div> : null}
      <fieldset disabled={actionBusy} className="shrink-0 space-y-2 border-b border-ui p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {zh ? "当前对话文件" : "Conversation files"} · {filesQuery.data?.length ?? "—"}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="conversation-files-upload-input"
            onChange={(event) => {
              const nextFiles = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              const retryId = reselectRef.current;
              reselectRef.current = null;
              const previous = retryId ? uploadQueue.find(entry => entry.id === retryId) : undefined;
              if (previous && (nextFiles.length !== 1 || previous.error !== "rejected" && (nextFiles[0].name !== previous.filename || nextFiles[0].size !== previous.byteSize))) {
                setError(zh ? "请选择原文件；名称或大小不符，未发起上传。" : "Select the original file. Its name or size differs; nothing was uploaded.");
                return;
              }
              void uploadFiles(nextFiles, retryId ?? undefined);
            }}
          />
          <button
            type="button"
            disabled={uploadDisabled}
            onClick={() => { reselectRef.current = null; inputRef.current?.click(); }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--text)] px-2.5 text-xs font-medium text-[var(--surface)] disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" />
            {zh ? "上传" : "Upload"}
          </button>
        </div>
        {capabilityPending ? <p role="status" className="text-[11px] text-secondary">{zh ? "正在读取附件上传设置…" : "Checking attachment upload settings…"}</p> : null}
        {capabilityUnavailable ? <div role="alert" className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--danger)]"><span>{zh ? "暂时无法确认附件上传设置，上传入口已暂停。" : "Attachment upload settings are unavailable, so upload is paused."}</span><button type="button" disabled={capabilitiesQuery.isFetching} onClick={() => void capabilitiesQuery.refetch()} className="min-h-8 underline disabled:opacity-60">{capabilitiesQuery.isFetching ? (zh ? "正在重试…" : "Retrying…") : (zh ? "重试读取设置" : "Retry settings")}</button></div> : null}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? "搜索文件" : "Search files"}
            className="min-h-9 w-full rounded-md border border-ui bg-surface pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(["all", "used", "unused", "missing"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded px-2 py-1 text-xs ${filter === value ? "bg-[var(--text)] text-[var(--surface)]" : "text-secondary hover:bg-subtle"}`}
            >
              {filterLabel(value, zh)}
            </button>
          ))}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as FileSort)}
            className="ml-auto min-h-7 rounded border border-ui bg-surface px-1.5 text-xs text-primary"
            aria-label={zh ? "文件排序" : "Sort files"}
          >
            <option value="recent">{zh ? "最近添加" : "Recent"}</option>
            <option value="name">{zh ? "名称" : "Name"}</option>
            <option value="type">{zh ? "类型" : "Type"}</option>
            <option value="size">{zh ? "大小" : "Size"}</option>
            <option value="usage">{zh ? "引用数" : "Usage"}</option>
          </select>
          <IconButton label={grouped ? (zh ? "切换为统一列表" : "Show one list") : (zh ? "按使用状态分组" : "Group by usage")} onClick={() => setGrouped((value) => !value)}>
            <Rows3 />
          </IconButton>
        </div>
        {selected.size ? (
          <div className="flex items-center gap-1 rounded bg-subtle px-2 py-1 text-xs">
            <span className="mr-auto">{zh ? `已选择 ${selected.size} 项` : `${selected.size} selected`}</span>
            <IconButton label={zh ? "下载所选" : "Download selected"} onClick={downloadSelection}><Download /></IconButton>
            <IconButton label={zh ? "插入到消息末尾" : "Insert at message end"} onClick={() => selectedFiles().forEach((item) => onInsert(item, "after_message"))}><Link2 /></IconButton>
            <IconButton label={zh ? "移除所选" : "Detach selected"} onClick={() => void detachSelection()}><Trash2 /></IconButton>
          </div>
        ) : null}
        {capabilitiesQuery.data?.attachments.scanner_provider === "disabled" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-secondary">
            <Info className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            {zh ? "当前部署未启用扫描，附件状态显示为“未扫描”。" : "Scanning is disabled; attachments remain unscanned."}
          </p>
        ) : null}
        {uploadQueue.filter((entry) => entry.status !== "committed").map((entry) => (
          <div key={entry.id} className="rounded border border-ui bg-surface p-2">
            <UploadProgress name={entry.filename} value={entry.progress} />
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-secondary">
              <span>{entry.status === "uploading" ? (zh ? "上传中" : "Uploading")
                : entry.status === "uploaded" ? (zh ? "已上传，尚未加入对话" : "Uploaded, not yet added")
                : entry.status === "finalizing" ? (zh ? "正在加入对话…" : "Adding to conversation…")
                : entry.status === "unknown" ? (zh ? "操作结果待确认，请先核对" : "Result unconfirmed; check first")
                : entry.status === "failed" ? (entry.error === "expired" ? (zh ? "上传会话已过期，重试会建立新会话" : "Upload session expired; retry starts a new session")
                  : entry.error === "rejected" ? (zh ? "文件校验未通过" : "File validation failed") : (zh ? "上传失败" : "Upload failed"))
                : entry.status === "cancelled" ? (zh ? "已取消" : "Cancelled") : (zh ? "排队中" : "Queued")}</span>
              {entry.status === "failed" || entry.status === "cancelled" ? <div className="flex shrink-0 gap-1">
                <button type="button" disabled={actionBusy} onClick={() => retryUpload(entry)} className="min-h-11 rounded px-2 font-medium text-accent underline">{entry.error === "rejected" ? (zh ? "替换源文件" : "Replace source file") : entry.file ? (zh ? "重试此文件" : "Retry this file") : (zh ? "重新选择原文件" : "Reselect original file")}</button>
                <button type="button" disabled={actionBusy} onClick={() => {
                  void rememberUpload({ ...entry, status: "removed" as UploadEntry["status"] });
                  setUploadQueue(queue => queue.filter(item => item.id !== entry.id));
                }} className="min-h-11 rounded px-2 underline">{zh ? "移出队列" : "Remove"}</button>
              </div> : null}
              {entry.status === "unknown" ? <button type="button" disabled={actionBusy} onClick={() => void refreshAttachmentList()} className="min-h-11 shrink-0 rounded px-2 underline">{zh ? "核对提交结果" : "Check result"}</button> : null}
            </div>
          </div>
        ))}
        {receiptWarning && uploadQueue.some(entry => entry.status === "unknown") ? <p role="status" className="text-xs text-secondary">{zh ? "本机回执未能保存；核对完成前请保留此页面。" : "Local receipts could not be stored. Keep this page open until checking is complete."}</p> : null}
        {uploadQueue.some((entry) => entry.status === "uploaded") ? <button type="button" disabled={actionBusy} onClick={() => void finishPendingUploads()} className="min-h-11 w-full rounded border border-ui bg-surface px-3 text-sm font-medium text-primary">{zh ? `将已上传的 ${uploadQueue.filter((entry) => entry.status === "uploaded").length} 个文件加入对话` : `Add ${uploadQueue.filter((entry) => entry.status === "uploaded").length} uploaded files`}</button> : null}
        {error ? (
          <div role="alert" className="rounded bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">
            <p>{error}</p>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void refreshAttachmentList()}
              className="mt-1 inline-flex min-h-7 items-center gap-1 rounded underline"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {zh ? "刷新文件列表" : "Refresh file list"}
            </button>
          </div>
        ) : null}
        {actionBusy ? (
          <p role="status" className="text-xs text-secondary">{uploading ? (zh ? "正在上传…" : "Uploading…") : (zh ? "正在保存…" : "Saving…")}</p>
        ) : notice ? <p role="status" className="text-xs text-secondary">{notice}</p> : null}
      </fieldset>
      {uploading ? <div className="shrink-0 border-b border-ui px-3 py-1"><button type="button" onClick={cancelUpload} className="min-h-11 rounded px-2 text-xs font-medium text-accent underline">{zh ? "取消当前上传" : "Cancel current upload"}</button></div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto"><fieldset disabled={actionBusy} className="min-w-0 p-3">
        {filesQuery.isLoading ? <p className="text-sm text-secondary">{zh ? "正在加载文件..." : "Loading files..."}</p> : null}
        {filesQuery.isError ? <div role="alert" className="mb-3 text-sm text-[var(--danger)]"><p>{zh ? "文件列表加载失败" : "Could not load files"}</p><button type="button" disabled={filesQuery.isFetching} className="min-h-10 underline" onClick={() => void filesQuery.refetch()}>{zh ? "重试" : "Retry"}</button></div> : null}
        {initialAttachmentId && filesQuery.isSuccess && !filesQuery.isFetching && !attachmentById.has(initialAttachmentId) ? <p role="status" className="mb-3 text-sm text-secondary">{zh ? "此搜索结果对应的文件已不存在或不属于当前对话，请重新搜索。" : "This file is no longer available in this conversation. Search again."}</p> : null}
        {visibleGroups.map((group) => group.items.length ? (
          <section key={group.id} className="mb-4" data-testid={`conversation-files-group-${group.id}`}>
            <h3 className="mb-1 text-[11px] font-semibold text-secondary">{group.title} · {group.items.length}</h3>
            <div className="space-y-1">
              {group.items.map((attachment) => (
                <FileRow
                  key={attachment.id}
                  attachment={attachment}
                  searchTarget={attachment.id === initialAttachmentId ? searchActivation : null}
                  zh={zh}
                  selected={selected.has(attachment.id)}
                  onSelect={() => toggleSelected(attachment.id)}
                  onPreview={() => setPreviewId(attachment.id)}
                  onShowDetails={() => setDetailsId(attachment.id)}
                  onLocate={(occurrence) => void onLocate(attachmentOccurrenceTarget(attachment, occurrence))}
                  onCopyReference={() => void copyReference(attachment.id)}
                  onInsert={(placement) => onInsert(attachment, placement)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-chat-reader-attachment", JSON.stringify({
                      attachmentId: attachment.id,
                      displayName: attachment.display_name,
                      mimeType: attachmentMime(attachment),
                    }));
                    event.dataTransfer.setData("text/plain", attachment.display_name);
                  }}
                  onRename={() => void renameFile(attachment)}
                  onDelete={() => {
                    const promptText = zh
                      ? `从当前对话文件中移除“${attachment.display_name}”？`
                      : `Detach "${attachment.display_name}" from this conversation?`;
                    void detachFiles([attachment], promptText);
                  }}
                />
              ))}
            </div>
          </section>
        ) : null)}
        {!filesQuery.isLoading && !filesQuery.isError && files.length === 0 ? <EmptyFiles filtered={Boolean(search || filter !== "all")} zh={zh} /> : null}
      </fieldset></div>
      {preview ? <AttachmentPreviewDialog attachment={preview} onClose={() => setPreviewId(null)} /> : null}
      {details ? <AttachmentDetailsDialog attachment={details} zh={zh} onClose={() => setDetailsId(null)} onLocate={onLocate} /> : null}
    </section>
  );
}

function FileRow({
  attachment,
  searchTarget,
  zh,
  selected,
  onSelect,
  onPreview,
  onShowDetails,
  onLocate,
  onCopyReference,
  onInsert,
  onRename,
  onDelete,
  onDragStart,
}: {
  attachment: AttachmentRead;
  searchTarget?: { focused: boolean } | null;
  zh: boolean;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onShowDetails: () => void;
  onLocate: (occurrence: NonNullable<AttachmentRead["occurrences"]>[number]) => void;
  onCopyReference: () => void;
  onInsert: (placement: Placement) => void;
  onRename: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const mime = attachmentMime(attachment);
  const image = mime.startsWith("image/");
  const unscanned = ["scanner_disabled", "unscanned", "scan_skipped_by_deployment_policy"].includes(attachment.scan_status);
  const zeroBytes = attachment.asset_object?.byte_size === 0;
  const created = new Date(attachment.created_at).toLocaleDateString();
  const occurrences = attachment.occurrences ?? [];
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchTargetRef = useAttachmentSearchTarget(searchTarget ?? null);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
        window.setTimeout(() => moreButtonRef.current?.focus({ preventScroll: true }), 0);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMoreOpen(false);
        moreButtonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [moreOpen]);

  const locateReferences = () => {
    if (occurrences.length === 1) {
      onLocate(occurrences[0]);
      return;
    }
    setReferencesOpen((value) => !value);
    setMoreOpen(false);
  };

  return (
    <article
      ref={searchTargetRef}
      tabIndex={-1}
      className={`rounded-md border px-2 py-2 ${selected ? "border-[var(--accent)] bg-accent-soft" : "border-ui bg-surface"}`}
      data-testid="conversation-file-row"
      data-attachment-id={attachment.id}
      data-search-target={searchTarget ? "true" : undefined}
      data-dialog-initial-focus={searchTarget ? "true" : undefined}
      data-scan-status={attachment.scan_status}
      data-resolution-status={attachment.resolution_status}
    >
      <div className="flex gap-2">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={zh ? `选择 ${attachment.display_name}` : `Select ${attachment.display_name}`} />
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          className="inline-flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-secondary hover:bg-subtle active:cursor-grabbing"
          aria-label={zh ? "拖到源码编辑器中插入" : "Drag into source editor to insert"}
          title={zh ? "拖到源码编辑器中插入" : "Drag into source editor to insert"}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-subtle text-secondary">
          {image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{attachment.display_name}</p>
          <p className="truncate text-[11px] text-secondary">
            {zeroBytes
              ? (zh ? "空文件 · 0 B" : "Empty file · 0 B")
              : `${mimeLabel(mime, attachment.display_name)} · ${readableBytes(attachment.asset_object?.byte_size ?? 0)}`}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-secondary">
            <span>{unscanned ? (zh ? "未扫描" : "Unscanned") : attachment.scan_status}</span>
            <span>{zh ? `正文引用 ${attachment.current_occurrence_count ?? (attachment.is_used ? attachment.occurrence_count : 0) ?? 0} 处` : `${attachment.current_occurrence_count ?? (attachment.is_used ? attachment.occurrence_count : 0) ?? 0} current occurrences`}</span>
            <span>{created} · {attachment.id.slice(0, 6)}</span>
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-end gap-1 border-t border-ui pt-1">
        <IconButton label={zh ? "插入" : "Insert"} onClick={() => onInsert("inline")}><Plus /></IconButton>
        <IconButton label={zh ? "预览" : "Preview"} onClick={onPreview}><Eye /></IconButton>
        {occurrences.length === 1 ? <IconButton label="Locate in conversation" onClick={() => onLocate(occurrences[0])}><LocateFixed /></IconButton> : null}
        {occurrences.length > 1 ? <IconButton label={referencesOpen ? "Hide references" : "Show references"} onClick={locateReferences}><LocateFixed /></IconButton> : null}
        <div ref={moreRef} className="relative">
          <button
            ref={moreButtonRef}
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((value) => !value)}
            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded text-secondary hover:bg-subtle"
            aria-label={zh ? "更多文件操作" : "More file actions"}
            title={zh ? "更多" : "More"}
          >
            {moreOpen ? <X className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
          </button>
          {moreOpen ? <div role="menu" className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-ui bg-raised p-1 shadow-xl">
            {attachment.download_url ? (
              <a href={attachment.download_url} className="flex min-h-8 items-center gap-2 rounded px-2 text-xs text-primary hover:bg-subtle">
                <Download className="h-3.5 w-3.5" />{zh ? "下载" : "Download"}
              </a>
            ) : null}
            {occurrences.length > 1 ? (
              <button type="button" onClick={locateReferences} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
                <LocateFixed className="h-3.5 w-3.5" />{zh ? "查看引用位置" : "Locate references"}
              </button>
            ) : null}
            {attachment.resolution_status !== "missing" ? (
              <button type="button" onClick={() => onInsert("after_message")} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
                <Link2 className="h-3.5 w-3.5" />{zh ? "插入到消息末尾" : "Insert after message"}
              </button>
            ) : null}
            <button type="button" onClick={onRename} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <Pencil className="h-3.5 w-3.5" />{zh ? "重命名显示名称" : "Rename display name"}
            </button>
            <button type="button" onClick={onCopyReference} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <ClipboardCopy className="h-3.5 w-3.5" />{zh ? "复制附件引用" : "Copy attachment reference"}
            </button>
            <button type="button" onClick={onShowDetails} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <Info className="h-3.5 w-3.5" />{zh ? "文件详情" : "File details"}
            </button>
            {!attachment.is_used ? (
              <button type="button" onClick={onDelete} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                <Trash2 className="h-3.5 w-3.5" />{zh ? "从当前对话文件移除" : "Detach"}
              </button>
            ) : null}
          </div> : null}
        </div>
      </div>
      {referencesOpen && occurrences.length > 1 ? <div className="mt-2 space-y-1 border-t border-ui pt-2" role="list" aria-label="Message references">
        {occurrences.map((occurrence, index) => <button key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`} type="button" onClick={() => onLocate(occurrence)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-secondary hover:bg-subtle hover:text-primary"><LocateFixed className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{zh ? `引用 ${index + 1}` : `Reference ${index + 1}`}</span><span className="text-[10px]">{occurrence.is_current_version ? (zh ? "当前" : "Current") : (zh ? "历史" : "History")}</span></button>)}
      </div> : null}
    </article>
  );
}

function AttachmentDetailsDialog({
  attachment,
  zh,
  onClose,
  onLocate,
}: {
  attachment: AttachmentRead;
  zh: boolean;
  onClose: () => void;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
}) {
  const occurrences = attachment.occurrences ?? [];
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ open: true, rootRef, onClose });
  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] p-0 outline-none sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`attachment-details-${attachment.id}`}>
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={onClose} />
      <section className="relative max-h-[80dvh] w-full overflow-y-auto rounded-t-xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`attachment-details-${attachment.id}`} className="truncate text-base font-semibold text-primary">{attachment.display_name}</h2>
            <p className="mt-1 text-xs text-secondary">{attachment.original_filename} · {attachmentMime(attachment)} · {readableBytes(attachment.asset_object?.byte_size ?? 0)}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭文件详情" : "Close file details"} title={zh ? "关闭" : "Close"}>×</button>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-secondary">{zh ? "状态" : "Status"}</dt><dd>{attachment.resolution_status === "missing" ? (zh ? "缺失" : "Missing") : attachment.status}</dd>
          <dt className="text-secondary">{zh ? "扫描" : "Scan"}</dt><dd>{["scanner_disabled", "unscanned", "scan_skipped_by_deployment_policy"].includes(attachment.scan_status) ? (zh ? "未扫描" : "Unscanned") : attachment.scan_status}</dd>
          <dt className="text-secondary">{zh ? "来源" : "Source"}</dt><dd>{attachment.source_type}</dd>
          <dt className="text-secondary">{zh ? "创建时间" : "Created"}</dt><dd>{new Date(attachment.created_at).toLocaleString()}</dd>
        </dl>
        <h3 className="mt-5 text-sm font-semibold text-primary">{zh ? `引用位置 · ${occurrences.length}` : `References · ${occurrences.length}`}</h3>
        <div className="mt-2 space-y-2">
          {occurrences.map((occurrence) => (
            <button
              key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`}
              type="button"
              onClick={() => { onClose(); void onLocate(attachmentOccurrenceTarget(attachment, occurrence)); }}
              className="block w-full rounded-md border border-ui bg-surface p-3 text-left hover:border-[var(--accent)]"
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium text-primary">
                <span>#{occurrence.message_order_key ?? occurrence.message_id.slice(0, 8)} · {occurrence.message_role ?? "message"}</span>
                <span className={occurrence.is_current_version ? "text-accent" : "text-secondary"}>{occurrence.is_current_version ? (zh ? "当前版本" : "Current") : `${zh ? "历史版本" : "History"} v${occurrence.version_number ?? "?"}`}</span>
              </span>
              {occurrence.message_preview ? <span className="mt-1 block line-clamp-2 text-xs text-secondary">{occurrence.message_preview}</span> : null}
            </button>
          ))}
          {!occurrences.length ? <p className="rounded-md bg-subtle p-3 text-xs text-secondary">{zh ? "当前没有正文引用。" : "There are no message references."}</p> : null}
        </div>
      </section>
    </div>
  );
}

function UploadProgress({ name, value }: { name: string; value: number }) {
  return (
    <div className="text-xs text-secondary">
      <div className="flex justify-between gap-2"><span className="truncate">{name}</span><span>{value}%</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function EmptyFiles({ filtered, zh }: { filtered: boolean; zh: boolean }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center text-center text-secondary">
      <File className="h-7 w-7" />
      <p className="mt-2 text-sm">{filtered ? (zh ? "没有匹配文件" : "No matching files") : (zh ? "当前对话还没有文件" : "No files in this conversation")}</p>
    </div>
  );
}

function attachmentMime(attachment: AttachmentRead): string {
  return attachment.detected_mime_type
    ?? attachment.asset_object?.detected_mime_type
    ?? attachment.declared_mime_type
    ?? "application/octet-stream";
}

function filterLabel(value: FileFilter, zh: boolean): string {
  if (value === "used") return zh ? "已引用" : "Used";
  if (value === "unused") return zh ? "未引用" : "Unused";
  if (value === "missing") return zh ? "缺失" : "Missing";
  return zh ? "全部" : "All";
}

function mimeLabel(mime: string, filename: string): string {
  const extension = attachmentExtension(filename);
  if (extension === "md" || extension === "markdown") return "Markdown";
  if (extension) return extension.toUpperCase();
  if (mime === "inode/x-empty" || mime === "application/octet-stream") return "FILE";
  const index = mime.indexOf("/");
  return (index >= 0 ? mime.slice(index + 1) : mime).toUpperCase();
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactElement<{ className?: string }> }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-subtle" aria-label={label} title={label}>
      {cloneElement(children, { className: "h-4 w-4" })}
    </button>
  );
}
