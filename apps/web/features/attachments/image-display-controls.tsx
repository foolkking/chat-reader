"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronUp, Expand, Loader2, SlidersHorizontal } from "lucide-react";
import type { AttachmentRead } from "../../lib/types";
import { ApiRequestError, getImageDisplay, setImageDisplay, uploadMessageCopyPreview, type ImageDisplayRead } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import { rasterizeCopySvg } from "../conversations/message-markdown-copy-prepare";
import { useAttachmentAccess } from "./attachment-access";
import { useImageDisplay } from "./image-presentation";
import { ImageScaleSlider } from "./image-scale-slider";
import { imageDisplayMenuPosition } from "./image-display-position";
import { IMAGE_DISPLAY_CHANGED_EVENT, recommendedImagePercent, validatedImageDisplay, type ImageSize } from "../../lib/image-display";

export { useImageDisplay } from "./image-presentation";
export function storedImageDisplay(attachment: AttachmentRead): ImageDisplayRead | undefined {
  return validatedImageDisplay(attachment.metadata?.image_display_v1, attachment.asset_object?.sha256);
}

type Props = { attachment: AttachmentRead; zh: boolean; compact: boolean; laneWidth: number; bodySize: ImageSize; visibleSize?: ImageSize; onOpen?: () => void };
type WriteState = { phase: "saving" | "saved" | "uncertain" | "error"; percent?: number; reason?: "conflict" | "limit" | "format" | "busy" | "failed" };

export function ImageDisplayControls(props: Props) {
  const access = useAttachmentAccess();
  const state = useImageDisplay(props.attachment);
  const editable = access.kind === "owner" && !access.readOnly && Boolean(props.attachment.asset_object);
  return <SizeEditor key={JSON.stringify([...state.identity, editable])} {...props} editable={editable} />;
}

function SizeEditor({ attachment, zh, compact, laneWidth, onOpen, editable }: Props & { editable: boolean }) {
  const client = useQueryClient();
  const { display, geometry: originalGeometry, queryKey, generation, identity } = useImageDisplay(attachment);
  const writeKey = ["image-write", ...identity, editable ? "editable" : "read-only"];
  const writeQuery = useQuery<WriteState | null>({ queryKey: writeKey, enabled: false, gcTime: Infinity });
  // Read-only surfaces never inherit an owner's write recovery, even if their
  // attachment/source/authentication happen to match.
  const write = editable ? writeQuery.data : null;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ImageDisplayRead | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [reading, setReading] = useState(false), [readError, setReadError] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const readFlight = useRef(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<DOMRect | null>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const pending = write?.phase === "saving";
  const blocked = Boolean(readError || write?.phase === "uncertain" || write?.phase === "error");
  const busy = pending || reading;
  useEffect(() => {
    if (editable && open && !current && display && write?.phase === "saved") {
      setCurrent(display); setDraft(display.scale_percent);
    }
  }, [editable, open, current, display, write?.phase]);
  // This is a non-modal, single-control disclosure: no focus trap or backdrop.
  useEffect(() => {
    if (open && current && !reading) panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [open, Boolean(current), reading]);
  function dismiss(restore = false) {
    setDraft(null);
    setOpen(false);
    if (restore && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open) return;
    // Capture the original viewport anchor, not the image's new location after
    // saving. The root portal escapes transformed virtual rows and Reader rails.
    const place = () => {
      if (!panel.current || !anchor.current) return;
      const rails = Array.from(document.querySelectorAll<HTMLElement>(".reader-toc-column, .reader-index-column"))
        .filter(node => getComputedStyle(node).visibility !== "hidden").map(node => node.getBoundingClientRect());
      const next = imageDisplayMenuPosition(anchor.current, panel.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }, rails);
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [open]);
  const changeDraft = (percent: number) => {
    setDraft(percent);
  };
  const isCurrent = () => generation === authenticationGeneration();
  const confirm = (value: ImageDisplayRead) => {
    const checked = validatedImageDisplay(value, attachment.asset_object?.sha256);
    if (!checked) throw new Error("Source changed");
    client.setQueryData(queryKey, checked);
    setCurrent(checked); setDraft(null);
  };
  async function read(): Promise<ImageDisplayRead | undefined> {
    if (!editable || readFlight.current || client.getQueryData<WriteState>(writeKey)?.phase === "saving") return;
    readFlight.current = true;
    const observedWrite = client.getQueryData<WriteState | null>(writeKey);
    setReading(true); setReadError("");
    try {
      const value = await getImageDisplay(attachment.id, AbortSignal.timeout(20_000));
      if (!isCurrent() || client.getQueryData<WriteState | null>(writeKey) !== observedWrite) return;
      confirm(value); client.setQueryData(writeKey, null);
      return value;
    } catch (failure) {
      if (isCurrent() && client.getQueryData<WriteState | null>(writeKey) === observedWrite) setReadError(failure instanceof ApiRequestError && [413, 422].includes(failure.status)
        ? (zh ? "此图片无法安全读取缩放尺寸，仍可查看或下载原图。" : "Size inspection is unavailable. You can still view or download the original.")
        : (zh ? "读取失败，保留最后确认的尺寸。" : "Could not read size. The last confirmed size is retained."));
    } finally { readFlight.current = false; if (isCurrent()) setReading(false); }
  }
  async function save(percent: number, base = current) {
    if (!base || busy || blocked || !editable || !Number.isInteger(percent) || percent < 1 || percent > 100
      || ["saving", "uncertain", "error"].includes(client.getQueryData<WriteState>(writeKey)?.phase ?? "")) return;
    client.setQueryData(writeKey, { phase: "saving" });
    let submitted = false;
    // Closing/unmounting is not cancellation of an in-flight server write.
    // Shared state survives virtual remounts; auth retirement fences all results.
    const signal = AbortSignal.timeout(30_000);
    try {
      if (attachment.asset_object?.detected_mime_type === "image/svg+xml") {
        const png = await rasterizeCopySvg(`/api/attachments/${attachment.id}/content`, signal);
        if (!isCurrent()) return;
        await uploadMessageCopyPreview(attachment.id, base.source_sha256, png, signal);
      }
      if (!isCurrent()) return;
      submitted = true;
      const value = await setImageDisplay(attachment.id, base, percent, signal);
      if (!isCurrent()) return;
      confirm(value);
      client.setQueryData(writeKey, { phase: "saved", percent: value.scale_percent });
      void client.invalidateQueries({ queryKey: ["attachment"] });
      window.dispatchEvent(new CustomEvent(IMAGE_DISPLAY_CHANGED_EVENT, { detail: { attachmentId: attachment.id, display: value, generation } }));
    } catch (failure) {
      if (!isCurrent()) return;
      const status = failure instanceof ApiRequestError ? failure.status : 0;
      const uncertain = submitted && (status === 0 || status >= 500);
      client.setQueryData(writeKey, { phase: uncertain ? "uncertain" : "error",
        reason: status === 409 ? "conflict" : status === 413 ? "limit" : status === 422 ? "format" : status === 429 ? "busy" : "failed" });
      setDraft(null);
    }
  }
  const confirmed = display ?? current;
  const unconfigured = !confirmed || confirmed.configured === false;
  const geometry = confirmed ?? originalGeometry;
  const fitPercent = geometry ? recommendedImagePercent(geometry.original_width, geometry.original_height, laneWidth) : null;
  const effectivePercent = unconfigured ? fitPercent : confirmed.scale_percent;
  const shown = draft ?? effectivePercent ?? 100;
  const scaleLabel = unconfigured
    ? (zh ? `默认适应栏宽${effectivePercent === null ? "" : ` · 约 ${effectivePercent}%`}` : `Default fit${effectivePercent === null ? "" : ` · about ${effectivePercent}%`}`)
    : `${zh ? "比例" : "Scale"} ${effectivePercent}%`;
  async function fitColumn() {
    if (busy || blocked) return;
    const base = current ?? await read();
    if (!base || !isCurrent()) return;
    const percent = recommendedImagePercent(base.original_width, base.original_height, laneWidth);
    if (percent === null) { setReadError(zh ? "此图片无法在安全限制内适应栏宽，仍保留原图。" : "This image cannot fit within safe conversion limits. The original is retained."); return; }
    // The read above can precede React's state update. Pass its confirmed base.
    await save(percent, base);
  }
  const error = readError || (write?.phase === "uncertain"
    ? (zh ? "保存结果待确认。请核对结果，不要重复提交。" : "Save result is uncertain. Check the result before saving again.")
    : write?.phase === "error" ? ({
      conflict: zh ? "来源或尺寸已改变，请重新读取后选择。" : "Source or size changed. Read the current result before choosing again.",
      limit: zh ? "超过安全转换限制，请核对后选择更小比例；原图仍保留。" : "Conversion limit exceeded. Check the result, then choose a smaller size. The original is retained.",
      format: zh ? "此格式不能安全缩放。动画请保留 100%。" : "This format cannot be safely resized. Keep animation at 100%.",
      busy: zh ? "图片转换繁忙，请稍后核对再保存。" : "Image conversion is busy. Check the result before retrying later.",
      failed: zh ? "未能保存，保留最后确认的尺寸。" : "Could not save. The last confirmed size is retained.",
    }[write.reason ?? "failed"]) : "");
  return <span className="image-display-control" data-markdown-copy-ignore="true" data-image-display-controls>
    {editable ? <span className="image-display-actions">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={zh ? `图片展示比例：${unconfigured ? scaleLabel : `${effectivePercent}%`}` : `Image display scale: ${unconfigured ? scaleLabel : `${effectivePercent}%`}`}
        className={`image-display-trigger${compact ? " image-display-trigger--compact" : ""}`} title={zh ? "松手即保存；同步更新已公开的图片链接，不会自动公开图片。" : "Release to save. Updates existing public image links; does not publish images."}
        onClick={() => {
          if (open) { dismiss(); return; }
          anchor.current = trigger.current?.getBoundingClientRect() ?? null; setOpen(true);
          if (!pending && write?.phase !== "uncertain") void read();
        }}>
        {compact ? <SlidersHorizontal aria-hidden="true" className="h-4 w-4" /> : <><span>{scaleLabel}</span><ChevronUp className="h-3.5 w-3.5" /></>}
      </button>
      <button type="button" className={compact ? "attachment-icon-action" : "attachment-inline-action"} aria-label={zh ? "适应栏宽" : "Fit column"} title={zh ? "适应栏宽" : "Fit column"} disabled={busy || blocked} onClick={() => void fitColumn()}>
        {compact ? <ArrowLeftRight aria-hidden="true" className="h-4 w-4" /> : zh ? "适应栏宽" : "Fit column"}
      </button>
    </span> : null}
    {onOpen ? <button type="button" className={compact ? "attachment-icon-action" : "attachment-inline-action"} aria-label={zh ? "查看大图" : "View image"} title={zh ? "查看大图" : "View image"} onClick={onOpen}>{compact ? <Expand aria-hidden="true" className="h-4 w-4" /> : zh ? "查看大图" : "View image"}</button> : null}
    {open && editable && typeof document !== "undefined" ? createPortal(<DismissableLayer asChild
      onEscapeKeyDown={event => { event.preventDefault(); dismiss(true); }}
      onPointerDownOutside={event => {
        const target = event.detail.originalEvent.target;
        if (!(target instanceof Node) || !trigger.current?.contains(target)) dismiss();
      }} onFocusOutside={event => {
        const target = event.detail.originalEvent.target;
        if (!(target instanceof Node) || !trigger.current?.contains(target)) dismiss();
      }}>
      <div ref={panel} id={panelId} role="group" aria-label={zh ? "图片比例" : "Image scale"}
        className="image-scale-disclosure" style={position} data-markdown-copy-ignore="true">
        <ImageScaleSlider value={shown} zh={zh} disabled={busy || blocked || !current} onChange={changeDraft}
          onCommit={percent => void save(percent)}
          onCancel={() => dismiss(true)} />
      </div>
    </DismissableLayer>, document.body) : null}
    {open && editable && !error ? <span className="image-display-feedback">{zh
      ? "松手即保存；同步更新已公开的图片链接，不会自动公开图片。"
      : "Release to save. Updates existing public image links; does not publish images."}
      {unconfigured ? (zh ? " 当前为正文默认适应，尚未保存比例；旧公开图片和离线副本保持原样。" : " Currently fitted for reading, not saved; existing public images and offline copies are unchanged.") : null}
    </span> : null}
    {error ? <span className="image-display-feedback"><span role="alert">{error}</span>
      <button type="button" className="attachment-inline-action" disabled={busy} onClick={() => void read()}>{zh ? "核对结果" : "Check result"}</button></span> : null}
    {reading || pending || write?.phase === "saved" ? <span className="image-display-feedback" role="status">
      {reading || pending ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {reading ? (zh ? "读取尺寸…" : "Reading size…")
        : pending ? (zh ? "正在保存；关闭不会取消提交" : "Saving; closing does not cancel the write") : (zh ? "已保存" : "Saved")}
    </span> : null}
  </span>;
}
