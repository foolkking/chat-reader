import type { NavigationResult } from "../../lib/types";

type NavigateMountedTargetOptions = {
  root: HTMLElement | null;
  targetId: string;
  fallbackId?: string;
  tokenIsCurrent?: () => boolean;
  offset?: number;
  timeoutMs?: number;
};

type StabilizeMountedTargetOptions = {
  root: HTMLElement | null;
  targetId: string;
  offset: number;
  tokenIsCurrent?: () => boolean;
  durationMs?: number;
};

export async function navigateMountedTarget({
  root,
  targetId,
  fallbackId,
  tokenIsCurrent = () => true,
  offset = 12,
  timeoutMs = 6000,
}: NavigateMountedTargetOptions): Promise<NavigationResult> {
  const target = await waitForTarget(targetId, fallbackId, timeoutMs, tokenIsCurrent);
  if (!tokenIsCurrent()) {
    return { ok: false, targetId, reason: "cancelled" };
  }
  if (!target) {
    return { ok: false, targetId, reason: "target-not-mounted" };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!tokenIsCurrent()) {
      return { ok: false, targetId, reason: "cancelled" };
    }
    scrollToAlignedPosition(root, target, offset);
    await waitForLayoutSettle();
    if (isAligned(root, target, offset)) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
      if (isAligned(root, target, offset)) {
        return { ok: true, targetId: target.id };
      }
    }
  }

  return { ok: false, targetId: target.id, reason: "target-not-aligned" };
}

export function stabilizeMountedTarget({
  root,
  targetId,
  offset,
  tokenIsCurrent = () => true,
  durationMs = 2500,
}: StabilizeMountedTargetOptions): () => void {
  const target = document.getElementById(targetId);
  if (!target) return () => undefined;

  let stopped = false;
  let frame = 0;
  const scrollTarget: HTMLElement | Window = root ?? window;
  const observedLayout = target.closest<HTMLElement>(".reader-content-inner") ?? target.parentElement;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    window.clearInterval(intervalId);
    window.clearTimeout(timeoutId);
    scrollTarget.removeEventListener("wheel", stop);
    scrollTarget.removeEventListener("touchstart", stop);
    scrollTarget.removeEventListener("pointerdown", stop);
  };

  const correct = () => {
    if (stopped || !tokenIsCurrent() || !target.isConnected) {
      stop();
      return;
    }
    const rootTop = root?.getBoundingClientRect().top ?? 0;
    const delta = target.getBoundingClientRect().top - (rootTop + offset);
    if (Math.abs(delta) <= 1) return;
    if (root) root.scrollTop += delta;
    else window.scrollBy({ top: delta, behavior: "auto" });
  };

  const scheduleCorrection = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      correct();
    });
  };

  const observer = new ResizeObserver(scheduleCorrection);
  if (observedLayout) observer.observe(observedLayout);
  const intervalId = window.setInterval(correct, 120);
  const timeoutId = window.setTimeout(stop, durationMs);
  scrollTarget.addEventListener("wheel", stop, { passive: true });
  scrollTarget.addEventListener("touchstart", stop, { passive: true });
  scrollTarget.addEventListener("pointerdown", stop, { passive: true });
  scheduleCorrection();
  return stop;
}

async function waitForTarget(
  targetId: string,
  fallbackId: string | undefined,
  timeoutMs: number,
  tokenIsCurrent: () => boolean,
): Promise<HTMLElement | null> {
  const existing = getTarget(targetId, fallbackId);
  if (existing) {
    return existing;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (target: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      resolve(target);
    };
    const check = () => {
      if (!tokenIsCurrent()) {
        finish(null);
        return;
      }
      const target = getTarget(targetId, fallbackId);
      if (target) {
        finish(target);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);
    const frameId = window.requestAnimationFrame(check);
  });
}

function getTarget(targetId: string, fallbackId?: string): HTMLElement | null {
  return document.getElementById(targetId) ?? (fallbackId ? document.getElementById(fallbackId) : null);
}

function scrollToAlignedPosition(root: HTMLElement | null, target: HTMLElement, offset: number) {
  const targetRect = target.getBoundingClientRect();
  if (root) {
    const rootRect = root.getBoundingClientRect();
    root.scrollTo({
      top: root.scrollTop + targetRect.top - rootRect.top - offset,
      behavior: "auto",
    });
    return;
  }
  window.scrollTo({
    top: window.scrollY + targetRect.top - offset,
    behavior: "auto",
  });
}

async function waitForLayoutSettle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function isAligned(root: HTMLElement | null, target: HTMLElement, offset: number): boolean {
  const rootTop = root?.getBoundingClientRect().top ?? 0;
  const expectedTop = rootTop + offset;
  return Math.abs(target.getBoundingClientRect().top - expectedTop) <= 24;
}
