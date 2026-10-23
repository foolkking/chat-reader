"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import type { AttachmentRead } from "../../lib/types";
import { getImageDisplay, setImageDisplay, uploadMessageCopyPreview, type ImageDisplayRead } from "../../lib/api";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT } from "../../lib/offline-access";
import { rasterizeCopySvg } from "../conversations/message-markdown-copy-prepare";
import { useAttachmentAccess } from "./attachment-access";
import { ImageScaleSlider } from "./image-scale-slider";

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
  const [draft, setDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const { display, queryKey } = useImageDisplay(attachment);
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      setPosition({
        left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
        top: Math.max(16, Math.min(anchor.bottom + 4, window.innerHeight - height - 16)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const isCurrent = (controller: AbortController) => !controller.signal.aborted && generation === authenticationGeneration();
  async function read() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = await getImageDisplay(attachment.id, controller.signal);
      if (!isCurrent(controller)) return;
      if (value.source_sha256 !== attachment.asset_object?.sha256) throw new Error("Source changed");
      setCurrent(value); setDraft(value.scale_percent);
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
    if (!current || busy || writing.current) return;
    writing.current = true;
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
      setCurrent(value); setDraft(value.scale_percent); setSaved(true);
      // Keep the slider in place after saving so fine adjustments do not
      // require reopening it. Do not move the image while a pointer is held.
      client.setQueryData(queryKey, value);
      void client.invalidateQueries({ queryKey: ["attachment"] });
    } catch {
      if (isCurrent(controller)) setError(zh ? "保存失败，请重试。" : "Save failed. Try again.");
    } finally { writing.current = false; if (isCurrent(controller)) setBusy(false); }
  }

  const shownPercent = open && !error && draft !== null ? draft : current?.scale_percent ?? display?.scale_percent ?? 100;

  return <div ref={root} className="image-display-control" data-markdown-copy-ignore="true" data-image-display-controls>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
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
    {open ? <div ref={panel} id={panelId} className="image-display-menu" style={position}>
      {busy && !current ? <div className="grid h-11 place-items-center" role="status" aria-label={zh ? "正在读取比例" : "Loading image scale"}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /></div> : null}
      {error ? <div className="p-2 text-center"><p role="alert" className="text-xs text-[var(--danger)]">{error}</p><button type="button" className="mt-1 min-h-11 px-2 text-xs font-medium text-primary" disabled={busy} onClick={() => void read()}>{zh ? "重试" : "Retry"}</button></div> : null}
      {current && !error ? <ImageScaleSlider value={draft ?? current.scale_percent} zh={zh} disabled={busy}
        onChange={percent => { setDraft(percent); setSaved(false); }}
        onCommit={percent => void save(percent)}
        onCancel={() => { setDraft(current.scale_percent); setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
      /> : null}
    </div> : null}
    {saved ? <span className="sr-only" role="status">{zh ? "比例已保存。" : "Image size saved."}</span> : null}
  </div>;
}
