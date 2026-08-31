import type { NavigationResult, ScrollAnchorSnapshot } from "../../lib/types";
import { firstVisibleRangeRect, resolveTextAnchorRange } from "./text-anchor";

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
  // Exact mounted targets can align before every remote image in the message
  // has decoded. Waiting up to five seconds here made ordinary attachment and
  // citation jumps feel stalled; keep a short guard for local targets and a
  // more forgiving window only for the fallback/network path.
  const mediaSettleTimeout = target.id === targetId ? 900 : 1800;
  await settleTargetMedia(target, Math.min(timeoutMs, mediaSettleTimeout), tokenIsCurrent);
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
  return {
    ok: true,
    targetId: target.id,
    fallback: alignment.textAnchorMissing,
    reason: alignment.textAnchorMissing ? "stale-anchor" : undefined,
  };
}

async function settleTargetMedia(target: HTMLElement, timeoutMs: number, tokenIsCurrent: () => boolean): Promise<void> {
  const scope = target.closest<HTMLElement>("article[data-message-id]") ?? target;
  const images = Array.from(scope.querySelectorAll<HTMLImageElement>("img"));
  if (images.length === 0) return;
  const pendingImages = images.filter((image) => !(image.complete && image.naturalWidth > 0));
  if (pendingImages.length === 0) return;
  for (const image of pendingImages) image.loading = "eager";
  const deadline = window.performance.now() + timeoutMs;
  await Promise.all(pendingImages.map(async (image) => {
    if (!tokenIsCurrent()) return;
    const remaining = Math.max(0, deadline - window.performance.now());
    if (remaining === 0) return;
    await Promise.race([
      image.decode?.().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((resolve) => window.setTimeout(resolve, remaining)),
    ]);
  }));
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
    observer.observe(document.body, { childList: true, subtree: true });
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
  const wantsTextAnchor = Boolean(characterOffset !== undefined || quote);
  const observedLayout = target.closest<HTMLElement>(".reader-content-inner") ?? target.parentElement;
  const observer = new ResizeObserver(() => {
    lastResizeAt = window.performance.now();
    alignedSince = null;
    alignedFrames = 0;
  });
  if (observedLayout) observer.observe(observedLayout);

  return new Promise((resolve) => {
    let frame = 0;
    let finished = false;
    const finish = (result: TargetAlignmentResult) => {
      if (finished) return;
      finished = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
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

      const textRect = textAnchorRect(target, { characterOffset, endCharacterOffset, quote, prefix, suffix });
      if (textRect) usedTextAnchor = true;
      const alignmentRect = textRect ?? undefined;
      const targetRect = target.getBoundingClientRect();
      const measured = Number.isFinite(targetRect.height) && targetRect.height > 0 &&
        (!wantsTextAnchor || !textRect || Boolean(textRect.width || textRect.height));
      const aligned = measured && isAligned(root, target, offset, alignmentRect);
      if (aligned) {
        if (alignedSince === null) alignedSince = now;
        alignedFrames += 1;
        // A real Range must remain within the 24px tolerance for three
        // consecutive animation frames and for at least 240ms. The latter
        // filters out the first frame before virtual rows/images finish
        // changing their geometry.
        if (alignedFrames >= 3 && now - alignedSince >= 240 && now - lastResizeAt >= 240) {
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

function textAnchorRect(target: HTMLElement, options: { characterOffset?: number; endCharacterOffset?: number; quote?: string | null; prefix?: string | null; suffix?: string | null }): DOMRect | null {
  const range = resolveTextAnchorRange(target, {
    quote: options.quote,
    prefix: options.prefix,
    suffix: options.suffix,
    startOffset: options.characterOffset,
    endOffset: options.endCharacterOffset,
  });
  return range ? firstVisibleRangeRect(range) : null;
}
