import { getRenderedBlocks } from "./rendered-block-registry";

export type ActiveReadingTarget = {
  messageId: string;
  blockId: string | null;
  blockIndex: number | null;
};

export function resolveActiveReadingTarget(
  root: HTMLElement | null,
  readingOffset: number,
): ActiveReadingTarget | null {
  const rootRect = root?.getBoundingClientRect();
  const readingLine = (rootRect?.top ?? 0) + readingOffset;
  const contentRect = root?.querySelector<HTMLElement>(".reader-content-inner")?.getBoundingClientRect() ?? rootRect;
  const viewportWidth = document.documentElement.clientWidth;
  const sampleLeft = contentRect?.left ?? 0;
  const sampleWidth = contentRect?.width ?? viewportWidth;
  const samplePoints = [0.5, 0.32, 0.68].map((ratio) => Math.max(0, Math.min(viewportWidth - 1, sampleLeft + sampleWidth * ratio)));

  let articleFallback: HTMLElement | null = null;
  for (const x of samplePoints) {
    for (const element of document.elementsFromPoint(x, readingLine)) {
      const candidate = element as HTMLElement;
      const block = candidate.closest<HTMLElement>("[data-block-index]");
      const article = candidate.closest<HTMLElement>("article[data-message-id]");
      if (article && root && !root.contains(article)) continue;
      if (block && article) return targetFromElements(article, block);
      if (!articleFallback && article) articleFallback = article;
    }
  }

  const registeredFallback = nearestRegisteredBlock(root, readingLine, articleFallback?.dataset.messageId ?? null);
  if (registeredFallback) return registeredFallback;
  if (articleFallback?.dataset.messageId) return targetFromElements(articleFallback, null);
  return nearestArticle(root, readingLine);
}

function nearestRegisteredBlock(
  root: HTMLElement | null,
  readingLine: number,
  preferredMessageId: string | null,
): ActiveReadingTarget | null {
  let nearest: { target: ActiveReadingTarget; distance: number } | null = null;
  for (const entry of getRenderedBlocks()) {
    if (root && !root.contains(entry.element)) continue;
    if (preferredMessageId && entry.messageId !== preferredMessageId) continue;
    const rect = entry.element.getBoundingClientRect();
    if (rect.top <= readingLine && rect.bottom >= readingLine) {
      return { messageId: entry.messageId, blockId: entry.element.id || null, blockIndex: entry.blockIndex };
    }
    const distance = rect.bottom < readingLine ? readingLine - rect.bottom : rect.top - readingLine;
    if (!nearest || distance < nearest.distance) {
      nearest = {
        target: { messageId: entry.messageId, blockId: entry.element.id || null, blockIndex: entry.blockIndex },
        distance,
      };
    }
  }
  return nearest?.target ?? null;
}

function nearestArticle(root: HTMLElement | null, readingLine: number): ActiveReadingTarget | null {
  const articles = Array.from((root ?? document).querySelectorAll<HTMLElement>("article[data-message-id]"));
  let nearest: { target: ActiveReadingTarget; distance: number } | null = null;
  for (const article of articles) {
    const messageId = article.dataset.messageId;
    if (!messageId) continue;
    const rect = article.getBoundingClientRect();
    if (rect.top <= readingLine && rect.bottom >= readingLine) return targetFromElements(article, null);
    const distance = Math.min(Math.abs(rect.top - readingLine), Math.abs(rect.bottom - readingLine));
    if (!nearest || distance < nearest.distance) {
      nearest = { target: targetFromElements(article, null), distance };
    }
  }
  return nearest?.target ?? null;
}

function targetFromElements(article: HTMLElement, block: HTMLElement | null): ActiveReadingTarget {
  const parsedIndex = Number.parseInt(block?.dataset.blockIndex ?? "", 10);
  return {
    messageId: article.dataset.messageId ?? "",
    blockId: block?.id || null,
    blockIndex: Number.isFinite(parsedIndex) ? parsedIndex : null,
  };
}
