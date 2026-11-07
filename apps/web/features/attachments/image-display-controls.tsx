"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, MoreHorizontal, X } from "lucide-react";
import type { AttachmentRead } from "../../lib/types";
import { ApiRequestError, getImageDisplay, setImageDisplay, uploadMessageCopyPreview, type ImageDisplayRead } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import { rasterizeCopySvg } from "../conversations/message-markdown-copy-prepare";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { useAttachmentAccess } from "./attachment-access";
import { useImageDisplay } from "./image-presentation";
import { ImageScaleSlider } from "./image-scale-slider";
import { imageDisplayMenuPosition } from "./image-display-position";
import { IMAGE_DISPLAY_CHANGED_EVENT, recommendedImagePercent, scaledImageDimensions, validatedImageDisplay, type ImageSize } from "../../lib/image-display";

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

function SizeEditor({ attachment, zh, compact, laneWidth, bodySize, visibleSize, onOpen, editable }: Props & { editable: boolean }) {
  const client = useQueryClient();
  const { display, geometry, queryKey, generation, identity } = useImageDisplay(attachment);
  const writeKey = ["image-write", ...identity, editable ? "editable" : "read-only"];
  const writeQuery = useQuery<WriteState | null>({ queryKey: writeKey, enabled: false, gcTime: Infinity });
  // Read-only surfaces never inherit an owner's write recovery, even if their
  // attachment/source/authentication happen to match.
  const write = editable ? writeQuery.data : null;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ImageDisplayRead | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [numeric, setNumeric] = useState("");
  const numericDirty = useRef(false);
  const replacingNumber = useRef(false);
  const [reading, setReading] = useState(false), [readError, setReadError] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<DOMRect | null>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const pending = write?.phase === "saving";
  const blocked = Boolean(readError || write?.phase === "uncertain" || write?.phase === "error");
  const busy = pending || reading;
  useEffect(() => {
    if (editable && open && !current && display && write?.phase === "saved") {
      setCurrent(display); setDraft(display.scale_percent); setNumeric(String(display.scale_percent));
    }
  }, [editable, open, current, display, write?.phase]);
  useEffect(() => {
    if (!open) return;
    const release = () => { replacingNumber.current = false; };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      release();
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, [open]);
  useDialogFocus({ open, rootRef: panel, initialFocusRef: close, onClose: () => {
    numericDirty.current = false;
    if (current) changeDraft(current.scale_percent);
    setOpen(false);
  },
    restoreFocus: () => trigger.current?.isConnected ? trigger.current : null });
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
    numericDirty.current = false;
    setDraft(percent); setNumeric(String(percent));
  };
  const isCurrent = () => generation === authenticationGeneration();
  const confirm = (value: ImageDisplayRead) => {
    const checked = validatedImageDisplay(value, attachment.asset_object?.sha256);
    if (!checked) throw new Error("Source changed");
    client.setQueryData(queryKey, checked);
    setCurrent(checked); changeDraft(checked.scale_percent);
  };
  async function read() {
    if (!editable || reading || client.getQueryData<WriteState>(writeKey)?.phase === "saving") return;
    setReading(true); setReadError("");
    try {
      const value = await getImageDisplay(attachment.id, AbortSignal.timeout(20_000));
      if (!isCurrent()) return;
      confirm(value); client.setQueryData(writeKey, null);
    } catch (failure) {
      if (isCurrent()) setReadError(failure instanceof ApiRequestError && [413, 422].includes(failure.status)
        ? (zh ? "此图片无法安全读取缩放尺寸，仍可查看或下载原图。" : "Size inspection is unavailable. You can still view or download the original.")
        : (zh ? "读取失败，保留最后确认的尺寸。" : "Could not read size. The last confirmed size is retained."));
    } finally { if (isCurrent()) setReading(false); }
  }
  async function save(percent: number) {
    if (!current || busy || blocked || !editable || !Number.isInteger(percent) || percent < 1 || percent > 100
      || client.getQueryData<WriteState>(writeKey)?.phase === "saving") return;
    client.setQueryData(writeKey, { phase: "saving" });
    let submitted = false;
    // Closing/unmounting is not cancellation of an in-flight server write.
    // Shared state survives virtual remounts; auth retirement fences all results.
    const signal = AbortSignal.timeout(30_000);
    try {
      if (attachment.asset_object?.detected_mime_type === "image/svg+xml") {
        const png = await rasterizeCopySvg(`/api/attachments/${attachment.id}/content`, signal);
        if (!isCurrent()) return;
        await uploadMessageCopyPreview(attachment.id, current.source_sha256, png, signal);
      }
      if (!isCurrent()) return;
      submitted = true;
      const value = await setImageDisplay(attachment.id, current, percent, signal);
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
      changeDraft(current.scale_percent);
    }
  }
  function commitNumber() {
    if (!numericDirty.current) return;
    numericDirty.current = false;
    const value = Number(numeric);
    if (!/^\d{1,3}$/.test(numeric) || !Number.isInteger(value) || value < 1 || value > 100) {
      changeDraft(current?.scale_percent ?? 100); return;
    }
    changeDraft(value); void save(value);
  }
  const shown = draft ?? current?.scale_percent ?? display?.scale_percent ?? 100;
  const original = current ?? geometry;
  const selection = original ? scaledImageDimensions(original.original_width, original.original_height, shown) : null;
  const recommendation = current ? recommendedImagePercent(current.original_width, current.original_height, laneWidth) : null;
  const unsaved = editable && current && !pending && !blocked
    && (shown !== current.scale_percent || numeric !== String(current.scale_percent));
  const error = readError || (write?.phase === "uncertain"
    ? (zh ? "保存结果待确认。请核对结果，不要重复提交。" : "Save result is uncertain. Check the result before saving again.")
    : write?.phase === "error" ? ({
      conflict: zh ? "来源或尺寸已改变，请重新读取后选择。" : "Source or size changed. Read the current result before choosing again.",
      limit: zh ? "超过安全转换限制，请核对后选择更小比例；原图仍保留。" : "Conversion limit exceeded. Check the result, then choose a smaller size. The original is retained.",
      format: zh ? "此格式不能安全缩放。动画请保留 100%。" : "This format cannot be safely resized. Keep animation at 100%.",
      busy: zh ? "图片转换繁忙，请稍后核对再保存。" : "Image conversion is busy. Check the result before retrying later.",
      failed: zh ? "未能保存，保留最后确认的尺寸。" : "Could not save. The last confirmed size is retained.",
    }[write.reason ?? "failed"]) : "");
  const openViewer = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); onOpen?.(); };
  const pixels = (size: ImageSize) => `${Math.round(size.width)} × ${Math.round(size.height)}`;
  return <span className="image-display-control" data-markdown-copy-ignore="true" data-image-display-controls>
    {editable || compact ? <button ref={trigger} type="button" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined}
      aria-label={compact ? (zh ? "图片选项" : "Image options") : (zh ? `图片展示比例：${display?.scale_percent ?? 100}%` : `Image display scale: ${display?.scale_percent ?? 100}%`)}
      title={compact ? (zh ? "图片选项" : "Image options") : undefined}
      className={compact ? "image-display-trigger image-display-trigger--compact" : "image-display-trigger"}
      onClick={() => {
        if (open) { setOpen(false); return; }
        anchor.current = trigger.current?.getBoundingClientRect() ?? null; setOpen(true);
        if (editable && !pending && write?.phase !== "uncertain") void read();
      }}>
      {compact ? <MoreHorizontal className="h-4 w-4" /> : <><span>{zh ? "尺寸" : "Size"} {display?.scale_percent ?? 100}%</span><ChevronDown className="h-3.5 w-3.5" /></>}
    </button> : null}
    {!compact && onOpen ? <button type="button" className="attachment-inline-action" onClick={onOpen}>{zh ? "查看大图" : "View image"}</button> : null}
    {open && typeof document !== "undefined" ? createPortal(<DismissableLayer asChild onPointerDownOutside={event => {
      const target = event.detail.originalEvent.target;
      if (!(target instanceof Node) || !trigger.current?.contains(target)) {
        commitNumber(); setOpen(false);
      }
    }}>
      <div ref={panel} id={panelId} role="dialog" aria-modal="true" aria-labelledby={`${panelId}-title`} tabIndex={-1}
        className="image-display-menu" style={position} data-markdown-copy-ignore="true"
        onPointerDownCapture={event => {
          replacingNumber.current = event.target instanceof Element && Boolean(event.target.closest("[data-image-size-choice]"));
        }}
        onMouseDownCapture={event => {
          // Touch may focus through compatibility mousedown after pointerup.
          // Keep that blur in the same final-choice transaction too.
          replacingNumber.current = event.target instanceof Element && Boolean(event.target.closest("[data-image-size-choice]"));
        }}
        onClickCapture={() => { replacingNumber.current = false; }}
        onBlurCapture={event => {
          // Moving between size controls is one selection, not two writes.
          // Pointer intent covers browsers that do not focus touched buttons;
          // relatedTarget also preserves keyboard hand-off to another choice.
          const next = event.relatedTarget;
          if (replacingNumber.current || (next instanceof Element && next.closest("[data-image-size-choice]"))) return;
          commitNumber();
        }}>
        <header className="image-display-menu-heading"><h3 id={`${panelId}-title`}>{editable ? (zh ? "图片尺寸" : "Image size") : (zh ? "图片选项" : "Image options")}</h3>
          <button ref={close} type="button" className="attachment-icon-action" aria-label={zh ? "关闭尺寸面板" : "Close image size"} onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></header>
        <div className="image-display-menu-body">
          {reading ? <p role="status" className="flex items-center gap-2 text-xs text-secondary"><Loader2 className="h-4 w-4 animate-spin" />{zh ? "正在读取尺寸" : "Reading size"}</p> : null}
          {editable && error ? <div><p role="alert" className="text-xs text-[var(--danger)]">{error}</p><button type="button" className="attachment-inline-action" disabled={busy} onClick={() => void read()}>{zh ? "核对结果" : "Check result"}</button></div> : null}
          {editable && current ? <>
            <label className="flex items-center justify-between gap-2 text-sm">{zh ? "百分比" : "Percentage"}
              <span className="flex items-center gap-1"><input type="number" min={1} max={100} step={1} inputMode="numeric" aria-label={zh ? "图片尺寸百分比" : "Image size percentage"}
                className="min-h-11 w-20 rounded-md border border-ui bg-surface px-2 text-primary" disabled={busy || blocked} value={numeric}
                onChange={event => { numericDirty.current = true; setNumeric(event.target.value); const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1 && n <= 100) setDraft(n); }}
                data-image-size-choice onKeyDown={event => {
                  if (event.key === "Enter") { event.preventDefault(); commitNumber(); }
                  if (event.key === "Escape") { numericDirty.current = false; changeDraft(current.scale_percent); }
                }} />%</span>
            </label>
            <ImageScaleSlider value={shown} zh={zh} disabled={busy || blocked} onChange={changeDraft} onCommit={percent => void save(percent)}
              onCancel={() => { changeDraft(current.scale_percent); setOpen(false); }} />
          </> : null}
          <dl className="image-dimensions">
            <dt>{zh ? "原图像素" : "Original pixels"}</dt><dd>{original ? `${original.original_width} × ${original.original_height}` : (zh ? "尚未取得" : "Not available")}</dd>
            <dt>{zh ? "当前选择" : "Selection"}</dt><dd>{selection ? pixels(selection) : (zh ? "原图" : "Original")}</dd>
            <dt>{visibleSize ? (zh ? "正文完整尺寸" : "Full body image") : (zh ? "正文实际显示" : "Currently in the body")}</dt><dd>{pixels(bodySize)}</dd>
            {visibleSize ? <><dt>{zh ? "当前可见（已折叠）" : "Visible area (collapsed)"}</dt><dd>{pixels(visibleSize)}</dd></> : null}
          </dl>
          {editable ? <><button type="button" data-image-size-choice className="attachment-inline-action" disabled={busy || blocked || recommendation === null}
            onClick={() => { if (recommendation !== null) { changeDraft(recommendation); void save(recommendation); } }}>{zh ? "适合当前栏宽" : "Fit current column"}</button>
            <p className="text-xs text-secondary">{zh ? "松手即保存，也会更新此前复制的公开图片链接；不会自动公开图片。外部平台可能再次缩放。" : "Release to save, including previously copied public image links. This does not publish the image. Other apps may resize it."}</p></> : null}
          {onOpen ? <button type="button" className="attachment-inline-action" onClick={openViewer}>{zh ? "查看大图" : "View image"}</button> : null}
          {attachment.download_url ? <a href={attachment.download_url} download className="attachment-inline-action">{zh ? "下载原图" : "Download original"}</a> : null}
        </div>
        <p className="image-save-status" role="status">{pending ? (zh ? "正在保存…关闭面板不会取消提交。" : "Saving… Closing does not cancel the write.")
          : unsaved ? (zh ? "当前选择尚未保存；松手或结束输入即保存。" : "Selection not saved. Release the slider or finish the number to save.")
          : write?.phase === "saved" && write.percent === shown ? (zh ? "已保存" : "Saved")
          : write?.phase === "uncertain" ? (zh ? "保存结果待确认" : "Save result uncertain") : ""}</p>
      </div>
    </DismissableLayer>, document.body) : null}
    {!open && (pending || write?.phase === "uncertain") ? <span className="basis-full text-xs text-secondary" role="status">{pending ? (zh ? "正在保存" : "Saving") : (zh ? "保存结果待确认" : "Save result uncertain")}</span> : null}
  </span>;
}
