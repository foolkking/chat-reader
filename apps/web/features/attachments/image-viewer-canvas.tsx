"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { ImageSize } from "../../lib/image-display";
import { imageViewerTransform, type ImageViewMode } from "./image-viewer-geometry";

/** Only temporary viewing state. No saved-size API, source mutation or download. */
export function ImageViewerCanvas({ src, alt, zh, onError, onPrevious, onNext }: {
  src: string | undefined; alt: string; zh: boolean; onError: () => void; onPrevious?: () => void; onNext?: () => void;
}) {
  const canvas = useRef<HTMLDivElement | null>(null);
  const transform = useRef<ReactZoomPanPinchRef | null>(null);
  const [natural, setNatural] = useState<ImageSize | null>(null);
  const [viewport, setViewport] = useState<ImageSize>({ width: 1, height: 1 });
  const [mode, setMode] = useState<ImageViewMode | "custom">("fit");
  const [scale, setScale] = useState<number | null>(null);
  const [background, setBackground] = useState("light");
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const node = canvas.current;
    const measure = () => setViewport(current => {
      const width = node.clientWidth, height = node.clientHeight;
      return current.width === width && current.height === height ? current : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const apply = (next: ImageViewMode) => {
    if (!natural || !transform.current) return;
    const value = imageViewerTransform(natural, viewport, next);
    transform.current.setTransform(value.x, value.y, value.scale, 0);
    setScale(value.scale);
  };
  useLayoutEffect(() => {
    if (mode !== "custom") apply(mode);
    // A fit mode tracks the real canvas, not a CSS-fitted image. Manual zoom
    // stays manual on a resize; loading never changes the Viewer shell.
  }, [natural, viewport, mode]);
  const choose = (next: ImageViewMode) => { setMode(next); apply(next); };
  const labels: Record<ImageViewMode, string> = {
    fit: zh ? "适应窗口" : "Fit to window",
    width: zh ? "适合宽度" : "Fit to width",
    original: zh ? "原尺寸 1:1" : "Original 1:1",
  };
  return <div className="image-viewer-workspace" data-testid="image-focus">
    <div ref={canvas} className={`image-viewer-canvas image-viewer-canvas--${background}`} data-testid="image-viewer-canvas">
      <TransformWrapper ref={transform} initialScale={1} minScale={.000001} maxScale={8}
        centerOnInit={false} centerZoomedOut={false} limitToBounds smooth={false}
        doubleClick={{ mode: "toggle", step: 1, animationTime: 0 }} wheel={{ step: .12 }}
        panning={{ velocityDisabled: true }} onZoomStart={() => setMode("custom")} onPinchStart={() => setMode("custom")}
        onTransform={(_, state) => setScale(state.scale)}>
        <TransformComponent wrapperClass="!h-full !w-full" contentStyle={{ width: natural?.width, height: natural?.height }}>
          <img src={src} alt={alt} draggable={false} className="image-viewer-original"
            style={{ width: natural?.width, height: natural?.height, visibility: natural ? "visible" : "hidden" }}
            onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={onError} />
        </TransformComponent>
      </TransformWrapper>
    </div>
    <div className="image-viewer-tools">
      {onPrevious ? <button type="button" className="attachment-icon-action" onClick={onPrevious} aria-label={zh ? "上一张" : "Previous image"}><ChevronLeft className="h-5 w-5" /></button> : null}
      <div className="image-view-modes" role="group" aria-label={zh ? "查看方式" : "Viewing mode"}>
        {(Object.keys(labels) as ImageViewMode[]).map(value => <button key={value} type="button" className="attachment-inline-action"
          aria-pressed={mode === value} disabled={!natural} onClick={() => choose(value)}>{labels[value]}</button>)}
      </div>
      <select className="image-view-mode-select" aria-label={zh ? "查看方式" : "Viewing mode"} value={mode} disabled={!natural}
        onChange={event => choose(event.target.value as ImageViewMode)}>
        {mode === "custom" ? <option value="custom" disabled>{zh ? "手动缩放" : "Manual zoom"}</option> : null}
        {(Object.keys(labels) as ImageViewMode[]).map(value => <option key={value} value={value}>{labels[value]}</option>)}
      </select>
      <span className="image-viewer-zoom">
        <button type="button" data-viewer-zoom="out" className="attachment-icon-action" disabled={!natural || (scale ?? 1) <= .000001}
          onClick={() => { setMode("custom"); transform.current?.zoomOut(.2, 0); }} aria-label={zh ? "缩小" : "Zoom out"}><ZoomOut className="h-4 w-4" /></button>
        <output className="image-viewer-scale" title={zh ? "100%：一个图像像素对应一个 CSS 像素" : "100%: one image pixel per CSS pixel"}>{scale === null ? "—" : `${Number((scale * 100).toFixed(1))}%`}</output>
        <button type="button" data-viewer-zoom="in" className="attachment-icon-action" disabled={!natural || (scale ?? 1) >= 8}
          onClick={() => { setMode("custom"); transform.current?.zoomIn(.2, 0); }} aria-label={zh ? "放大" : "Zoom in"}><ZoomIn className="h-4 w-4" /></button>
      </span>
      {onNext ? <button type="button" className="attachment-icon-action" onClick={onNext} aria-label={zh ? "下一张" : "Next image"}><ChevronRight className="h-5 w-5" /></button> : null}
      <label className="image-viewer-background">{zh ? "背景" : "Background"}
        <select aria-label={zh ? "透明图检查背景" : "Transparency background"} value={background} onChange={event => setBackground(event.target.value)}>
          <option value="light">{zh ? "浅色" : "Light"}</option><option value="dark">{zh ? "深色" : "Dark"}</option><option value="checker">{zh ? "棋盘" : "Checkerboard"}</option>
        </select>
      </label>
    </div>
  </div>;
}
