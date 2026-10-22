"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachmentRead } from "../../lib/types";
import { getImageDisplay, setImageDisplay, uploadMessageCopyPreview, type ImageDisplayRead } from "../../lib/api";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT } from "../../lib/offline-access";
import { rasterizeCopySvg } from "../conversations/message-markdown-copy-prepare";
import { useAttachmentAccess } from "./attachment-access";

export function storedImageDisplay(attachment: AttachmentRead): ImageDisplayRead | undefined {
  const value = attachment.metadata?.image_display_v1 as ImageDisplayRead | undefined;
  return value && value.source_sha256 === attachment.asset_object?.sha256
    && Number.isInteger(value.scale_percent) && value.scale_percent >= 1 && value.scale_percent <= 100
    && [value.width, value.height, value.original_width, value.original_height].every(n => Number.isInteger(n) && n > 0)
    ? value : undefined;
}

export function useImageDisplay(attachment: AttachmentRead) {
  const [generation, setGeneration] = useState(authenticationGeneration);
  useEffect(() => {
    const changed = () => setGeneration(authenticationGeneration());
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
  }, []);
  const queryKey = ["image-display", generation, attachment.id, attachment.asset_object?.sha256];
  const query = useQuery<ImageDisplayRead>({ queryKey, queryFn: () => getImageDisplay(attachment.id), enabled: false });
  return { display: query.data?.configured === false ? storedImageDisplay(attachment) : query.data ?? storedImageDisplay(attachment), generation, queryKey };
}

export function ImageDisplayControls({ attachment, zh }: { attachment: AttachmentRead; zh: boolean }) {
  const access = useAttachmentAccess();
  const state = useImageDisplay(attachment);
  if (access.kind !== "owner" || !attachment.asset_object) return null;
  return <SizeEditor key={`${attachment.id}:${attachment.asset_object.sha256}:${state.generation}`}
    attachment={attachment} zh={zh} generation={state.generation} />;
}

function SizeEditor({ attachment, zh, generation }: { attachment: AttachmentRead; zh: boolean; generation: number }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState("100");
  const [current, setCurrent] = useState<ImageDisplayRead | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  const { display, queryKey } = useImageDisplay(attachment);
  useEffect(() => () => { active.current?.abort(); }, []);
  const valid = /^\d+$/.test(draft) && Number(draft) >= 1 && Number(draft) <= 100;
  const isCurrent = (controller: AbortController) => !controller.signal.aborted && generation === authenticationGeneration();
  async function read() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setSaved(false); setCurrent(null);
    try {
      const value = await getImageDisplay(attachment.id, controller.signal);
      if (!isCurrent(controller)) return;
      if (value.source_sha256 !== attachment.asset_object?.sha256) throw new Error("Source changed");
      setCurrent(value); setDraft(String(value.scale_percent));
      client.setQueryData(queryKey, value);
    } catch (failure) {
      if (isCurrent(controller)) {
        const unsupported = typeof failure === "object" && failure !== null && "status" in failure
          && (failure.status === 413 || failure.status === 422);
        setError(unsupported
          ? (zh ? "图片过大或不支持安全缩放，仍可查看或下载原图。" : "Image is too large or unsupported for safe sizing. View or download the original instead.")
          : (zh ? "无法读取图片尺寸，请重新读取。" : "Could not read image dimensions. Reload to retry."));
      }
    }
    finally { if (isCurrent(controller)) setBusy(false); }
  }
  async function save(percent: number) {
    if (!current || busy) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setSaved(false);
    try {
      if (attachment.asset_object?.detected_mime_type === "image/svg+xml") {
        const png = await rasterizeCopySvg(`/api/attachments/${attachment.id}/content`, controller.signal);
        if (!isCurrent(controller)) return;
        await uploadMessageCopyPreview(attachment.id, current.source_sha256, png, controller.signal);
      }
      if (!isCurrent(controller)) return;
      const value = await setImageDisplay(attachment.id, current, percent, controller.signal);
      if (!isCurrent(controller)) return;
      setCurrent(value); setDraft(String(value.scale_percent)); setSaved(true);
      client.setQueryData(queryKey, value);
      // Refresh all copies of this attachment, not just the local figure.
      void client.invalidateQueries({ queryKey: ["attachment"] });
    } catch {
      if (isCurrent(controller)) setError(zh
        ? "未确认保存。请重新读取后重试；过大、动画或不安全的图片不能缩放。"
        : "Save not confirmed. Reload before retrying; oversized, animated or unsafe images cannot be resized.");
    } finally { if (isCurrent(controller)) setBusy(false); }
  }
  return <div className="mt-1 text-sm text-secondary" data-markdown-copy-ignore="true" data-image-display-controls>
    <button type="button" aria-expanded={open} className="attachment-inline-action"
      onClick={() => { setOpen(!open); if (!open) void read(); }}>
      {zh ? "图片大小" : "Image size"} · {display?.scale_percent ?? 100}%
    </button>
    {open ? <div className="border-y border-ui py-3">
      <p>{current ? `${zh ? "原始" : "Original"} ${current.original_width} × ${current.original_height}px`
        : busy ? (zh ? "正在读取原始尺寸…" : "Reading original dimensions…") : (zh ? "原始尺寸尚未读取" : "Original dimensions unavailable")}</p>
      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (valid && current && !error) void save(Number(draft)); }}>
        <label className="flex flex-col gap-1">
          <span>{zh ? "相对原图比例（1–100%）" : "Original size (1–100%)"}</span>
          <input type="number" min="1" max="100" step="1" value={draft}
            disabled={busy || !current} aria-label={zh ? "图片缩放百分比" : "Image scale percentage"}
            className="image-display-input h-11 w-28 rounded-md border bg-surface px-3 text-base text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            onChange={event => { setDraft(event.target.value); setSaved(false); }} />
        </label>
        <button type="submit" className="btn-primary image-display-apply min-h-11 shrink-0 px-3" disabled={busy || !current || !valid || Boolean(error)}>
          {busy ? (zh ? "处理中…" : "Working…") : (zh ? "应用比例" : "Apply size")}
        </button>
        <button type="button" className="btn-secondary min-h-11 shrink-0 px-3" disabled={busy || !current || current.scale_percent === 100 || Boolean(error)} onClick={() => void save(100)}>
          {zh ? "恢复 100%" : "Restore 100%"}
        </button>
      </form>
      {current && valid ? <p className="mt-2">{zh ? "目标" : "Target"} {Math.max(1, Math.round(current.original_width * Number(draft) / 100))} × {Math.max(1, Math.round(current.original_height * Number(draft) / 100))}px</p> : null}
      <p className="mt-2">{zh ? "原图保留。同一附件及已公开链接随保存结果更新；外部缓存或强制宽度可能不同。" : "Original retained. This attachment and existing public links follow saved size; external caching or forced widths may differ."}</p>
      {saved ? <p className="mt-2" role="status">{zh ? "比例已保存。" : "Image size saved."}</p> : null}
      {error ? <div className="mt-2"><p role="alert">{error}</p><button type="button" className="attachment-inline-action" disabled={busy} onClick={() => void read()}>{zh ? "重新读取" : "Reload size"}</button></div> : null}
      {busy ? <button type="button" className="attachment-inline-action" onClick={() => { active.current?.abort(); setBusy(false); setError(zh ? "操作已停止，重新读取以确认服务器结果。" : "Stopped. Reload to confirm server state."); }}>{zh ? "停止等待" : "Stop waiting"}</button> : null}
    </div> : null}
  </div>;
}
