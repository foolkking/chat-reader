"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import type { AttachmentRead } from "../../lib/types";
import { getImageDisplay, setImageDisplay, uploadMessageCopyPreview, type ImageDisplayRead } from "../../lib/api";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT } from "../../lib/offline-access";
import { rasterizeCopySvg } from "../conversations/message-markdown-copy-prepare";
import { useAttachmentAccess } from "./attachment-access";

const IMAGE_SCALE_PERCENTAGES = Array.from({ length: 100 }, (_, index) => 100 - index);

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
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ImageDisplayRead | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const { display, queryKey } = useImageDisplay(attachment);
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open && current && !busy) optionRefs.current.get(current.scale_percent)?.scrollIntoView({ block: "nearest" });
  }, [busy, current, open]);

  const isCurrent = (controller: AbortController) => !controller.signal.aborted && generation === authenticationGeneration();
  async function read() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = await getImageDisplay(attachment.id, controller.signal);
      if (!isCurrent(controller)) return;
      if (value.source_sha256 !== attachment.asset_object?.sha256) throw new Error("Source changed");
      setCurrent(value);
      client.setQueryData(queryKey, value);
    } catch (failure) {
      if (isCurrent(controller)) {
        const unsupported = typeof failure === "object" && failure !== null && "status" in failure
          && (failure.status === 413 || failure.status === 422);
        setError(unsupported
          ? (zh ? "此图片不支持缩放。" : "This image cannot be resized.")
          : (zh ? "读取失败，请重试。" : "Could not load. Try again."));
      }
    } finally { if (isCurrent(controller)) setBusy(false); }
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
      setCurrent(value); setSaved(true); setOpen(false);
      client.setQueryData(queryKey, value);
      void client.invalidateQueries({ queryKey: ["attachment"] });
    } catch {
      if (isCurrent(controller)) setError(zh ? "保存失败，请重试。" : "Save failed. Try again.");
    } finally { if (isCurrent(controller)) setBusy(false); }
  }

  const shownPercent = current?.scale_percent ?? display?.scale_percent ?? 100;
  const moveOptionFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const selected = event.target instanceof HTMLElement ? Number(event.target.dataset.imageScaleOption) : NaN;
    if (!Number.isInteger(selected)) return;
    let next = selected;
    if (event.key === "ArrowDown") next = Math.max(1, selected - 1);
    else if (event.key === "ArrowUp") next = Math.min(100, selected + 1);
    else if (event.key === "Home") next = 100;
    else if (event.key === "End") next = 1;
    else if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    optionRefs.current.get(next)?.focus();
  };

  return <div ref={root} className="image-display-control" data-markdown-copy-ignore="true" data-image-display-controls>
    <button ref={trigger} type="button" aria-expanded={open} aria-haspopup="listbox"
      aria-label={zh ? `图片展示比例：${shownPercent}%` : `Image display scale: ${shownPercent}%`}
      className="image-display-trigger" disabled={busy && !current}
      onClick={() => {
        if (open) { setOpen(false); return; }
        setOpen(true);
        void read();
      }}>
      <span>{shownPercent}%</span>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
    {open ? <div className="image-display-menu" onKeyDown={moveOptionFocus}>
      {busy && !current ? <div className="grid h-11 place-items-center" role="status" aria-label={zh ? "正在读取比例" : "Loading image scale"}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /></div> : null}
      {error ? <div className="p-2 text-center"><p role="alert" className="text-xs text-[var(--danger)]">{error}</p><button type="button" className="mt-1 min-h-11 px-2 text-xs font-medium text-primary" disabled={busy} onClick={() => void read()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {current && !error ? <div role="listbox" aria-label={zh ? "图片展示比例" : "Image display scale"}>
        {IMAGE_SCALE_PERCENTAGES.map(percent => <button
          key={percent}
          ref={node => { if (node) optionRefs.current.set(percent, node); else optionRefs.current.delete(percent); }}
          type="button" role="option" aria-selected={current.scale_percent === percent}
          data-image-scale-option={percent} tabIndex={current.scale_percent === percent ? 0 : -1} className="image-display-option" disabled={busy}
          onClick={() => void save(percent)}>{percent}%</button>)}
      </div> : null}
    </div> : null}
    {saved ? <span className="sr-only" role="status">{zh ? "比例已保存。" : "Image size saved."}</span> : null}
  </div>;
}
