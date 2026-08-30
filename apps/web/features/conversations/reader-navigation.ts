import type { NavigationResult, ScrollAnchorSnapshot } from "../../lib/types";
import { firstVisibleRangeRect, invalidateTextAnchorCache, resolveTextAnchorRange } from "./text-anchor";

type NavigateMountedTargetOptions = {
  root: HTMLElement | null;
  targetId: string;
  fallbackId?: string;
  tokenIsCurrent?: () => boolean;
  offset?: number;
  characterOffset?: number;
  endCharacterOffset?: number;
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  timeoutMs?: number;
  allowFallback?: boolean;
};

type RestoreScrollAnchorOptions = {
  root: HTMLElement | null;
  anchor: ScrollAnchorSnapshot;
  tokenIsCurrent?: () => boolean;
  minimumMs?: number;
  settleMs?: number;
  timeoutMs?: number;
};

export function resolveActiveBlockDomId(
  root: HTMLElement | null,
  messageId: string,
  readingOffset: number,
): string | null {
  const article = document.getElementById(`message-${messageId}`);
  if (!article) return null;
  const readingLine = (root?.getBoundingClientRect().top ?? 0) + readingOffset;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  let nearest: { id: string; distance: number } | null = null;

  for (const block of blocks) {
    if (!block.id) continue;
    const rect = block.getBoundingClientRect();
    if (rect.top <= readingLine && rect.bottom >= readingLine) return block.id;
    const distance = rect.bottom < readingLine
      ? readingLine - rect.bottom
      : rect.top - readingLine;
    if (!nearest || distance < nearest.distance) nearest = { id: block.id, distance };
  }

  return nearest?.id ?? null;
}

export async function navigateMountedTarget({
  root,
  targetId,
  fallbackId,
  tokenIsCurrent = () => true,
  offset = 12,
  characterOffset,
  endCharacterOffset,
  quote,
  prefix,
  suffix,
  timeoutMs = 6000,
  allowFallback = false,
}: NavigateMountedTargetOptions): Promise<NavigationResult> {
  markReaderNavigation("start");
  const target = await waitForTarget(targetId, timeoutMs, tokenIsCurrent);
  if (!tokenIsCurrent()) {
    return { ok: false, targetId, reason: "cancelled" };
  }
  if (!target) {
    if (allowFallback && fallbackId) {
      const fallback = document.getElementById(fallbackId);
      if (fallback) {
        const fallbackAlignment = await stabilizeTargetAlignment({
          root,
          target: fallback,
          offset,
          tokenIsCurrent,
          timeoutMs,
        });
        return fallbackAlignment.stable
          ? { ok: true, targetId: fallback.id, fallback: true, reason: "stale-anchor" }
          : { ok: false, targetId: fallback.id, reason: "target-not-aligned" };
      }
    }
    return { ok: false, targetId, reason: "target-not-mounted" };
  }
  markReaderNavigation("target-mounted");
  // Text positioning must not wait for unrelated images in a long message.
  // The target block is the only media scope that can affect the exact range.
  await settleTargetMedia(target, Math.min(timeoutMs, 180), tokenIsCurrent);
  if (!tokenIsCurrent()) {
    return { ok: false, targetId, reason: "cancelled" };
  }
  const resolvedCharacterOffset = target.id === targetId ? characterOffset : undefined;
  const resolvedEndCharacterOffset = target.id === targetId ? endCharacterOffset : undefined;
  const resolvedQuote = target.id === targetId ? quote : null;
  const alignment = await stabilizeTargetAlignment({
    root,
    target,
    offset,
    characterOffset: resolvedCharacterOffset,
    endCharacterOffset: resolvedEndCharacterOffset,
    quote: resolvedQuote,
    prefix,
    suffix,
    tokenIsCurrent,
    timeoutMs,
  });
  if (!alignment.stable) {
    return {
      ok: false,
      targetId: target.id,
      reason: tokenIsCurrent() ? "target-not-aligned" : "cancelled",
    };
  }
  markReaderNavigation("aligned");
  return {
    ok: true,
    targetId: target.id,
    fallback: alignment.textAnchorMissing,
    reason: alignment.textAnchorMissing ? "stale-anchor" : undefined,
  };
}

async function settleTargetMedia(target: HTMLElement, timeoutMs: number, tokenIsCurrent: () => boolean): Promise<void> {
  // A message-level fallback has no reliable block scope. Do not make a
  // citation wait for every image in that message; layout observers below
  // will correct a small shift if the target block changes height later.
  const scope = target.matches("[data-block-index]")
    ? target
    : target.querySelector<HTMLElement>("[data-block-index]");
  if (!scope) return;
  const images = Array.from(scope.querySelectorAll<HTMLImageElement>("img"));
  if (images.length === 0) return;
  const deadline = window.performance.now() + timeoutMs;
  await Promise.race([
    Promise.all(images.map(async (image) => {
      if (!tokenIsCurrent()) return;
      const remaining = Math.max(0, deadline - window.performance.now());
      if (remaining === 0) return;
      await Promise.race([
        image.decode?.().catch(() => undefined) ?? Promise.resolve(),
        new Promise<void>((resolve) => window.setTimeout(resolve, remaining)),
      ]);
    })),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

function markReaderNavigation(stage: "start" | "target-mounted" | "aligned"): void {
  if (typeof window === "undefined" || typeof window.performance?.mark !== "function") return;
  const name = `reader-locate-${stage}`;
  // Keep diagnostics bounded during a long reading session. These marks are
  // optional observability signals, never a source of navigation state.
  window.performance.clearMarks?.(name);
  window.performance.mark(name);
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
  }) ?? articles.find((item) => item.getBoundingClientRect().bottom > readingLine) ?? articles.at(-1);
  if (!article) return null;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>("[data-block-index]"));
  const block = blocks.find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.top <= readingLine && rect.bottom >= readingLine;
  }) ?? blocks.reduce<HTMLElement | null>((nearest, item) => {
    if (!nearest) return item;
    const itemRect = item.getBoundingClientRect();
    const nearestRect = nearest.getBoundingClientRect();
    const itemDistance = itemRect.bottom < readingLine
      ? readingLine - itemRect.bottom
      : itemRect.top - readingLine;
    const nearestDistance = nearestRect.bottom < readingLine
      ? readingLine - nearestRect.bottom
      : nearestRect.top - readingLine;
    return itemDistance < nearestDistance ? item : nearest;
  }, null);
  const target = block ?? article;
  if (!target.id) return null;
  return {
    targetId: target.id,
    offset: target.getBoundingClientRect().top - rootTop,
    messageId: article.dataset.messageId ?? null,
    messageVersionId: article.dataset.messageVersionId ?? null,
    blockId: target.dataset.blockId ?? null,
    blockIndex: target.dataset.blockIndex ? Number(target.dataset.blockIndex) : null,
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
  const target = document.getElementById(anchor.targetId)
    ?? (anchor.blockId ? document.querySelector<HTMLElement>(`[data-block-id="${anchor.blockId}"]`) : null)
    ?? (anchor.messageId ? document.querySelector<HTMLElement>(`article[data-message-id="${anchor.messageId}"]`) : null);
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

export function estimateCharacterOffsetAtReadingLine(
  root: HTMLElement | null,
  messageId: string,
  blockIndex: number,
  readingLineOffset: number,
): number | undefined {
  const block = document.getElementById(`block-${messageId}-${blockIndex}`);
  if (!block) return undefined;
  const rootTop = root?.getBoundingClientRect().top ?? 0;
  const readingLine = rootTop + readingLineOffset;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let total = 0;
  let closest: { offset: number; distance: number } | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent ?? "";
    const length = text.length;
    if (length === 0) continue;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(1, length));
    const firstRect = range.getBoundingClientRect();
    range.setStart(node, Math.max(0, length - 1));
    range.setEnd(node, length);
    const lastRect = range.getBoundingClientRect();
    for (const candidate of [
      { offset: total, rect: firstRect },
      { offset: total + length - 1, rect: lastRect },
    ]) {
      if (!candidate.rect.width && !candidate.rect.height) continue;
      const distance = Math.abs(candidate.rect.top - readingLine);
      if (!closest || distance < closest.distance) closest = { offset: candidate.offset, distance };
    }
    total += length;
  }
  return closest?.offset;
}

async function waitForTarget(
  targetId: string,
  timeoutMs: number,
  tokenIsCurrent: () => boolean,
): Promise<HTMLElement | null> {
  const existing = document.getElementById(targetId);
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
      const target = document.getElementById(targetId);
      if (target) {
        finish(target);
      }
    };
    const observer = new MutationObserver(check);
    const observationRoot = document.querySelector<HTMLElement>('[data-reader-scroll-root="true"]') ?? document.body;
    observer.observe(observationRoot, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);
    const frameId = window.requestAnimationFrame(check);
  });
}

function scrollToAlignedPosition(root: HTMLElement | null, target: HTMLElement, offset: number, textRect?: DOMRect | null) {
  const targetRect = textRect ?? target.getBoundingClientRect();
  if (root) {
    const rootRect = root.getBoundingClientRect();
    root.scrollTop = Math.max(0, root.scrollTop + targetRect.top - rootRect.top - offset);
    return;
  }
  window.scrollTo({
    top: window.scrollY + targetRect.top - offset,
    behavior: "auto",
  });
}

type TargetAlignmentResult = {
  stable: boolean;
  usedTextAnchor: boolean;
  textAnchorMissing: boolean;
};

function isAligned(root: HTMLElement | null, target: HTMLElement, offset: number, textRect?: DOMRect | null): boolean {
  const rootTop = root?.getBoundingClientRect().top ?? 0;
  const expectedTop = rootTop + offset;
  const targetRect = textRect ?? target.getBoundingClientRect();
  return Math.abs(targetRect.top - expectedTop) <= 24;
}

async function stabilizeTargetAlignment({
  root,
  target,
  offset,
  characterOffset,
  endCharacterOffset,
  quote,
  prefix,
  suffix,
  tokenIsCurrent,
  timeoutMs,
}: {
  root: HTMLElement | null;
  target: HTMLElement;
  offset: number;
  characterOffset?: number;
  endCharacterOffset?: number;
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  tokenIsCurrent: () => boolean;
  timeoutMs: number;
}): Promise<TargetAlignmentResult> {
  const startedAt = window.performance.now();
  let lastResizeAt = startedAt;
  let alignedSince: number | null = null;
  let alignedFrames = 0;
  let usedTextAnchor = false;
  let cachedTextRange: Range | null | undefined;
  const wantsTextAnchor = Boolean(characterOffset !== undefined || quote);
  const observedLayout = target.closest<HTMLElement>(".reader-content-inner") ?? target.parentElement;
  const observer = new ResizeObserver(() => {
    lastResizeAt = window.performance.now();
    alignedSince = null;
    alignedFrames = 0;
    cachedTextRange = undefined;
  });
  const mutationObserver = observedLayout ? new MutationObserver(() => {
    cachedTextRange = undefined;
    invalidateTextAnchorCache(target);
    alignedSince = null;
    alignedFrames = 0;
  }) : null;
  if (observedLayout) observer.observe(observedLayout);
  if (observedLayout) mutationObserver?.observe(observedLayout, { childList: true, subtree: true, characterData: true });

  return new Promise((resolve) => {
    let frame = 0;
    let finished = false;
    const finish = (result: TargetAlignmentResult) => {
      if (finished) return;
      finished = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver?.disconnect();
      resolve(result);
    };
    const check = () => {
      frame = 0;
      const now = window.performance.now();
      if (!tokenIsCurrent()) {
        finish({ stable: false, usedTextAnchor, textAnchorMissing: wantsTextAnchor && !usedTextAnchor });
        return;
      }
      if (!target.isConnected) {
        finish({ stable: false, usedTextAnchor, textAnchorMissing: wantsTextAnchor && !usedTextAnchor });
        return;
      }

      if (wantsTextAnchor && cachedTextRange === undefined) {
        cachedTextRange = resolveTextAnchorRange(target, { startOffset: characterOffset, endOffset: endCharacterOffset, quote, prefix, suffix });
      } else if (cachedTextRange && !(cachedTextRange.startContainer as Node).isConnected) {
        cachedTextRange = undefined;
      }
      const textRect = cachedTextRange ? firstVisibleRangeRect(cachedTextRange) : null;
      if (textRect) usedTextAnchor = true;
      const alignmentRect = textRect ?? undefined;
      const targetRect = target.getBoundingClientRect();
      const measured = Number.isFinite(targetRect.height) && targetRect.height > 0 &&
        (!wantsTextAnchor || !textRect || Boolean(textRect.width || textRect.height));
      const aligned = measured && isAligned(root, target, offset, alignmentRect);
      if (aligned) {
        if (alignedSince === null) alignedSince = now;
        alignedFrames += 1;
        // ResizeObserver/MutationObserver invalidate this state whenever the
        // target layout changes. Two stable frames plus a short settling
        // window is enough for text positioning without waiting on unrelated
        // media elsewhere in the message.
        if (alignedFrames >= 2 && now - alignedSince >= 120 && now - lastResizeAt >= 120) {
          finish({ stable: true, usedTextAnchor, textAnchorMissing: wantsTextAnchor && !usedTextAnchor });
          return;
        }
      } else {
        alignedSince = null;
        alignedFrames = 0;
        if (measured) {
          scrollToAlignedPosition(root, target, offset, alignmentRect);
        }
      }

      if (now - startedAt >= timeoutMs) {
        finish({ stable: false, usedTextAnchor, textAnchorMissing: wantsTextAnchor && !usedTextAnchor });
        return;
      }
      frame = window.requestAnimationFrame(check);
    };
    frame = window.requestAnimationFrame(check);
  });
}
