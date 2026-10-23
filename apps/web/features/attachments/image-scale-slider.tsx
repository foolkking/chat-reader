"use client";

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { IMAGE_SCALE_STOPS, snapImageScale, type ImageScaleSample } from "./image-scale-snap";

type Props = {
  value: number;
  disabled: boolean;
  zh: boolean;
  onChange: (percent: number) => void;
  onCommit: (percent: number) => void;
  onCancel: () => void;
};

export function ImageScaleSlider({ value, disabled, zh, onChange, onCommit, onCancel }: Props) {
  const gesture = useRef<{ id: number; sample: ImageScaleSample | null; value: number } | null>(null);
  const keyboardValue = useRef<number | null>(null);
  const samplePointer = (event: PointerEvent<HTMLInputElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return value;
    const bounds = event.currentTarget.getBoundingClientRect();
    // Match the styled 1.5rem thumb, including a larger root text size.
    const thumb = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.5;
    const raw = 1 + (event.clientX - bounds.left - thumb / 2) / Math.max(1, bounds.width - thumb) * 99;
    if (active.sample && Math.abs(Math.max(1, Math.min(100, raw)) - active.sample.raw) < 0.001) return active.value;
    const next = snapImageScale(raw, event.timeStamp, active.sample);
    active.sample = next.sample;
    active.value = next.percent;
    onChange(next.percent);
    return next.percent;
  };
  const release = (element: HTMLInputElement) => {
    const active = gesture.current;
    gesture.current = null;
    if (active && element.hasPointerCapture(active.id)) element.releasePointerCapture(active.id);
  };
  const cancel = (element: HTMLInputElement) => {
    release(element);
    keyboardValue.current = null;
    onCancel();
  };
  const keyValue = (event: KeyboardEvent<HTMLInputElement>) => {
    const from = keyboardValue.current ?? value;
    switch (event.key) {
      case "ArrowRight": case "ArrowUp": return Math.min(100, from + 1);
      case "ArrowLeft": case "ArrowDown": return Math.max(1, from - 1);
      case "PageUp": return Math.min(100, from + 10);
      case "PageDown": return Math.max(1, from - 10);
      case "Home": return 1;
      case "End": return 100;
      default: return null;
    }
  };
  const commitKeyboard = () => {
    const next = keyboardValue.current;
    keyboardValue.current = null;
    if (next !== null) onCommit(next);
  };
  return <div className="image-scale-slider">
    <input type="range" min="1" max="100" step="1" value={value} disabled={disabled}
      aria-label={zh ? "图片展示比例" : "Image display scale"} aria-valuetext={`${value}%`}
      className="image-scale-range" style={{ "--image-scale-progress": `${(value - 1) / 99 * 100}%` } as CSSProperties}
      onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        gesture.current = { id: event.pointerId, sample: null, value };
        event.currentTarget.setPointerCapture(event.pointerId);
        samplePointer(event);
      }}
      onPointerMove={event => {
        if (gesture.current?.id !== event.pointerId) return;
        event.preventDefault();
        samplePointer(event);
      }}
      onPointerUp={event => {
        if (gesture.current?.id !== event.pointerId) return;
        const next = samplePointer(event);
        release(event.currentTarget);
        onCommit(next);
      }}
      onPointerCancel={event => { if (gesture.current?.id === event.pointerId) cancel(event.currentTarget); }}
      onLostPointerCapture={event => { if (gesture.current?.id === event.pointerId) cancel(event.currentTarget); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(event.currentTarget); return; }
        const next = keyValue(event);
        if (next === null || gesture.current) return;
        event.preventDefault();
        keyboardValue.current = next;
        onChange(next);
      }}
      onKeyUp={event => { if (keyValue(event) !== null) commitKeyboard(); }}
      onBlur={commitKeyboard}
      onChange={event => {
        // Native assistive-technology changes may have no pointer/key sequence.
        if (gesture.current || keyboardValue.current !== null) return;
        const next = Number(event.currentTarget.value);
        onChange(next);
        onCommit(next);
      }}
    />
    <div className="image-scale-stops" role="group" aria-label={zh ? "常用比例" : "Common scales"}>
      {IMAGE_SCALE_STOPS.map(percent => <button key={percent} type="button"
        className="image-scale-stop" style={{ left: `${(percent - 1) / 99 * 100}%` }}
        disabled={disabled} aria-pressed={value === percent} onClick={() => { onChange(percent); onCommit(percent); }}>
        {percent}%
      </button>)}
    </div>
  </div>;
}
