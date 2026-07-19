import type { NavigationResult, ScrollAnchorSnapshot } from "../../lib/types";

type NavigateMountedTargetOptions = {
  root: HTMLElement | null;
  targetId: string;
  fallbackId?: string;
  tokenIsCurrent?: () => boolean;
  offset?: number;
  timeoutMs?: number;
};

type RestoreScrollAnchorOptions = {
  root: HTMLElement | null;
  anchor: ScrollAnchorSnapshot;
  tokenIsCurrent?: () => boolean;
  minimumMs?: number;
  settleMs?: number;
  timeoutMs?: number;
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

export function captureScrollAnchor(
  root: HTMLElement | null,
  readingLineOffset: number,
): ScrollAnchorSnapshot | null {
  const rootTop = root?.getBoundingClientRect().top ?? 0;
  const readingLine = rootTop + readingLineOffset;
  const scope: ParentNode = root ?? document;
  const articles = Array.from(scope.querySelectorAll<HTMLElement>("article[data-message-id]"));
  const article = articles.find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom >= readingLine;
  }) ?? articles.find((item) => item.getBoundingClientRect().bottom > readingLine);
  if (!article) return null;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  const block = blocks.find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom >= readingLine;
  });
  const target = block ?? article;
  if (!target.id) return null;
  return {
    targetId: target.id,
    offset: target.getBoundingClientRect().top - rootTop,
  };
}

export async function restoreScrollAnchor({
  root,
  anchor,
  tokenIsCurrent = () => true,
  minimumMs = 320,
  settleMs = 120,
  timeoutMs = 1500,
}: RestoreScrollAnchorOptions): Promise<boolean> {
  const target = document.getElementById(anchor.targetId);
  if (!target || !tokenIsCurrent()) return false;
  const startedAt = window.performance.now();
  let lastChangeAt = startedAt;
  let frame = 0;
  let stopped = false;
  const observedLayout = target.closest<HTMLElement>(".reader-content-inner") ?? target.parentElement;

  return new Promise((resolve) => {
    const finish = (restored: boolean) => {
      if (stopped) return;
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      resolve(restored);
    };
    const check = () => {
      frame = 0;
      if (!tokenIsCurrent() || !target.isConnected) {
        finish(false);
        return;
      }
      const rootTop = root?.getBoundingClientRect().top ?? 0;
      const delta = target.getBoundingClientRect().top - (rootTop + anchor.offset);
      if (Math.abs(delta) > 0.5) {
        if (root) root.scrollTop += delta;
        else window.scrollBy({ top: delta, behavior: "auto" });
        lastChangeAt = window.performance.now();
      }
      const now = window.performance.now();
      if (now - startedAt >= minimumMs && now - lastChangeAt >= settleMs) {
        finish(true);
        return;
      }
      if (now - startedAt >= timeoutMs) {
        finish(true);
        return;
      }
      frame = window.requestAnimationFrame(check);
    };
    const observer = new ResizeObserver(() => {
      lastChangeAt = window.performance.now();
      if (!frame) frame = window.requestAnimationFrame(check);
    });
    if (observedLayout) observer.observe(observedLayout);
    frame = window.requestAnimationFrame(check);
  });
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
