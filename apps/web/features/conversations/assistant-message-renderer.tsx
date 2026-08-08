"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import type { MessageListItem, RenderBlockRead } from "../../lib/types";
import { BlockRenderer } from "./block-renderer";
import { extractMarkdownTaskItems, MarkdownRenderer, ThinkingDisclosure, stripLeadingTimestamp, type MarkdownTaskItem } from "./markdown-renderer";
import { useTranslations } from "../../components/preferences-provider";
import { READER_WINDOW_LAYOUT_EVENT, registerVirtualMessage, type ReaderBlockLease } from "./block-virtualization";
import { registerRenderedBlock } from "./rendered-block-registry";

const THINKING_LABEL = "思考过程";
const THINKING_DURATION_RE =
  /^(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*((?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))$/i;
const ANSWER_START_RE = /^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|正式回答|final answer|answer)\s*[:：])/i;
const TRACE_PREFIXES = ["考虑", "分析", "整理", "搜索", "检索", "浏览", "查找", "提炼", "规划", "总结"];

export function AssistantMessageRenderer({
  message,
  blocks,
  highlightTargetId,
  scrollRootMode = "element",
  pendingTaskKeys,
  taskCheckedOverrides,
  onTaskToggle,
}: {
  message: MessageListItem;
  blocks: RenderBlockRead[];
  highlightTargetId?: string | null;
  scrollRootMode?: "element" | "window";
  pendingTaskKeys?: ReadonlySet<string>;
  taskCheckedOverrides?: ReadonlyMap<string, boolean>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
}) {
  const t = useTranslations();
  const isAssistant = message.role === "assistant";
  const currentText = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const allTasks = useMemo(() => extractMarkdownTaskItems(currentText), [currentText]);
  const tasksByBlock = useMemo(
    () => assignTasksToBlocks(blocks, allTasks, taskCheckedOverrides),
    [allTasks, blocks, taskCheckedOverrides],
  );

  if (blocks.length === 0) {
    return currentText.trim() ? (
      <MarkdownRenderer text={currentText} isAssistant={isAssistant} taskItems={applyTaskOverrides(allTasks, taskCheckedOverrides)} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
    ) : (
      <p className="text-sm text-secondary">{t("noDisplayableContent")}</p>
    );
  }

  const leadingThinking = isAssistant ? findLeadingThinkingBlocks(blocks) : null;
  const visibleBlocks = leadingThinking ? blocks.slice(leadingThinking.endIndex + 1) : blocks;
  const shouldVirtualize = message.block_count > 160 || message.char_count > 50_000;
  const displayUnits = groupAttachmentBlocks(visibleBlocks);

  return (
    <div className="reader-block-flow break-words">
      {leadingThinking ? (
        <div className="reader-block-slot"><ThinkingDisclosure label={leadingThinking.label} text={leadingThinking.text} /></div>
      ) : null}
      {shouldVirtualize ? (
        <div className="reader-block-slot" style={leadingThinking ? slotGapStyle(blockGapVariable(null, visibleBlocks[0])) : undefined}>
          {scrollRootMode === "window" ? (
            <WindowVirtualizedBlocks messageId={message.id} blocks={visibleBlocks} isAssistant={isAssistant} highlightTargetId={highlightTargetId} tasksByBlock={tasksByBlock} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
          ) : (
            <ElementVirtualizedBlocks messageId={message.id} blocks={visibleBlocks} isAssistant={isAssistant} highlightTargetId={highlightTargetId} tasksByBlock={tasksByBlock} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
          )}
        </div>
      ) : displayUnits.map((unit, index) => {
        const previousBlock = index > 0 ? displayUnits[index - 1].blocks.at(-1) ?? null : null;
        const firstBlock = unit.blocks[0];
        if (!firstBlock) return null;
        if (unit.kind === "attachment-group") {
          return (
            <AttachmentBlockGroup
              key={`attachment-group-${firstBlock.id ?? firstBlock.block_index}`}
              messageId={message.id}
              blocks={unit.blocks}
              groupType={unit.groupType}
              previousBlock={previousBlock}
              hasLeadingContent={Boolean(leadingThinking) || index > 0}
              isAssistant={isAssistant}
              highlightTargetId={highlightTargetId}
            />
          );
        }
        return (
          <BlockSlot
            key={firstBlock.id ?? `${message.id}-${index}`}
            messageId={message.id}
            block={firstBlock}
            previousBlock={previousBlock}
            hasLeadingContent={Boolean(leadingThinking) || index > 0}
            isAssistant={isAssistant}
            highlightTargetId={highlightTargetId}
            taskItems={tasksByBlock.get(firstBlock.block_index)}
            pendingTaskKeys={pendingTaskKeys}
            onTaskToggle={onTaskToggle}
          />
        );
      })}
      {visibleBlocks.length === 0 ? null : null}
    </div>
  );
}

type DisplayUnit = {
  kind: "block" | "attachment-group";
  blocks: RenderBlockRead[];
  groupType?: "images" | "files";
};

function groupAttachmentBlocks(blocks: RenderBlockRead[]): DisplayUnit[] {
  const units: DisplayUnit[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    const groupType = block.block_type === "image" ? "images" : block.block_type === "attachment" ? "files" : null;
    if (!groupType) {
      units.push({ kind: "block", blocks: [block] });
      index += 1;
      continue;
    }
    const grouped: RenderBlockRead[] = [];
    while (index < blocks.length && (blocks[index].block_type === "image" ? "images" : blocks[index].block_type === "attachment" ? "files" : null) === groupType) {
      grouped.push(blocks[index]);
      index += 1;
    }
    units.push(grouped.length > 1 ? { kind: "attachment-group", blocks: grouped, groupType } : { kind: "block", blocks: grouped });
  }
  return units;
}

function AttachmentBlockGroup({
  messageId,
  blocks,
  groupType = "files",
  previousBlock,
  hasLeadingContent,
  isAssistant,
  highlightTargetId,
}: {
  messageId: string;
  blocks: RenderBlockRead[];
  groupType?: "images" | "files";
  previousBlock: RenderBlockRead | null;
  hasLeadingContent: boolean;
  isAssistant: boolean;
  highlightTargetId?: string | null;
}) {
  const initialLimit = groupType === "images" ? 4 : 5;
  const targetInside = Boolean(highlightTargetId && blocks.some((block) => highlightTargetId === `block-${messageId}-${block.block_index}`));
  const [expanded, setExpanded] = useState(targetInside);
  useEffect(() => {
    if (targetInside) setExpanded(true);
  }, [targetInside]);
  const visibleBlocks = expanded ? blocks : blocks.slice(0, initialLimit);
  const hiddenCount = blocks.length - visibleBlocks.length;
  return (
    <div
      className="reader-block-slot"
      data-testid="attachment-group"
      data-attachment-group={groupType}
      style={hasLeadingContent ? slotGapStyle(blockGapVariable(previousBlock, blocks[0] ?? null)) : undefined}
    >
      <div className={groupType === "images" ? "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" : "flex min-w-0 flex-col gap-2"}>
        {visibleBlocks.map((block) => (
          <BlockElement key={block.id ?? block.block_index} messageId={messageId} block={block} isAssistant={isAssistant} highlightTargetId={highlightTargetId} />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button type="button" onClick={() => setExpanded(true)} className="mt-2 inline-flex min-h-10 items-center rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle">
          展开其余 {hiddenCount} 个附件
        </button>
      ) : expanded && blocks.length > initialLimit ? (
        <button type="button" onClick={() => setExpanded(false)} className="mt-2 inline-flex min-h-10 items-center rounded-lg border border-ui bg-surface px-3 text-sm text-secondary hover:bg-subtle">
          收起附件组
        </button>
      ) : null}
    </div>
  );
}

function ElementVirtualizedBlocks({ messageId, blocks, isAssistant, highlightTargetId, tasksByBlock, pendingTaskKeys, onTaskToggle }: VirtualizedBlocksProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [pinnedVirtualIndexes, setPinnedVirtualIndexes] = useState<Set<number>>(() => new Set());
  const indexByBlock = useMemo(() => new Map(blocks.map((block, index) => [block.block_index, index])), [blocks]);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = defaultRangeExtractor(range);
    const pinned = Array.from(pinnedVirtualIndexes).filter((index) => !indexes.includes(index));
    return pinned.length === 0 ? indexes : [...indexes, ...pinned].sort((left, right) => left - right);
  }, [pinnedVirtualIndexes]);
  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => containerRef.current?.closest<HTMLElement>('[data-reader-scroll-root="true"]') ?? null,
    estimateSize: (index) => estimateBlockSize(blocks[index]),
    getItemKey: (index) => blocks[index]?.id ?? `${messageId}-${blocks[index]?.block_index ?? index}`,
    measureElement: (element) => element?.getBoundingClientRect().height ?? 0,
    overscan: 8,
    scrollMargin,
    rangeExtractor,
    useAnimationFrameWithResizeObserver: true,
  });

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const root = containerRef.current?.closest<HTMLElement>('[data-reader-scroll-root="true"]');
    if (root?.dataset.navigationStage?.startsWith("aligning:")) return false;
    if (root?.dataset.readerLayoutCompensating === "true") return false;
    if (root?.dataset.readerSurfaceCompensating === "true") return false;

    // Preserve TanStack Virtual's normal anchor rule: a new measurement may
    // compensate an estimated item that starts above the fold, while a later
    // resize only compensates an item that is entirely above it. Returning
    // `true` for every row used to let font, spacing, and width changes below
    // the reading line push the viewport by their accumulated deltas.
    const scrollOffset = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
    const isFirstMeasurement = !instance.itemSizeCache.has(item.key);
    return isFirstMeasurement
      ? item.start < scrollOffset
      : item.end <= scrollOffset && instance.scrollDirection !== "backward";
  };

  useVirtualLayoutMeasurements(
    containerRef,
    messageId,
    "element",
    setScrollMargin,
    virtualizer.measure,
    virtualizer.measureElement,
  );
  useVirtualMessageRegistration(messageId, indexByBlock, setPinnedVirtualIndexes);
  const virtualFlow = buildVirtualFlow(virtualizer.getVirtualItems(), scrollMargin, virtualizer.getTotalSize());

  return (
    <div
      ref={containerRef}
      data-virtualized-block-list="true"
      data-virtualized-block-count={blocks.length}
      className="relative w-full"
    >
      {virtualFlow.rows.map(({ item, gapBefore }) => {
        const block = blocks[item.index];
        if (!block) return null;
        return (
          <Fragment key={String(item.key)}>
            {gapBefore > 0 ? <div aria-hidden="true" style={{ height: `${gapBefore}px` }} /> : null}
            <VirtualBlockRow itemIndex={item.index} measureElement={virtualizer.measureElement} gapAfter={blocks[item.index + 1] ? blockGapVariable(block, blocks[item.index + 1] ?? null) : null}>
              <BlockSlot messageId={messageId} block={block} previousBlock={null} hasLeadingContent={false} isAssistant={isAssistant} highlightTargetId={highlightTargetId} taskItems={tasksByBlock.get(block.block_index)} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
            </VirtualBlockRow>
          </Fragment>
        );
      })}
      {virtualFlow.gapAfter > 0 ? <div aria-hidden="true" style={{ height: `${virtualFlow.gapAfter}px` }} /> : null}
    </div>
  );
}

function WindowVirtualizedBlocks({ messageId, blocks, isAssistant, highlightTargetId, tasksByBlock, pendingTaskKeys, onTaskToggle }: VirtualizedBlocksProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [pinnedVirtualIndexes, setPinnedVirtualIndexes] = useState<Set<number>>(() => new Set());
  const indexByBlock = useMemo(() => new Map(blocks.map((block, index) => [block.block_index, index])), [blocks]);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = defaultRangeExtractor(range);
    const pinned = Array.from(pinnedVirtualIndexes).filter((index) => !indexes.includes(index));
    return pinned.length === 0 ? indexes : [...indexes, ...pinned].sort((left, right) => left - right);
  }, [pinnedVirtualIndexes]);
  const virtualizer = useWindowVirtualizer({
    count: blocks.length,
    estimateSize: (index) => estimateBlockSize(blocks[index]),
    getItemKey: (index) => blocks[index]?.id ?? `${messageId}-${blocks[index]?.block_index ?? index}`,
    measureElement: (element) => element?.getBoundingClientRect().height ?? 0,
    overscan: 8,
    scrollMargin,
    rangeExtractor,
    useAnimationFrameWithResizeObserver: true,
  });

  useVirtualLayoutMeasurements(
    containerRef,
    messageId,
    "window",
    setScrollMargin,
    virtualizer.measure,
    virtualizer.measureElement,
  );
  useVirtualMessageRegistration(messageId, indexByBlock, setPinnedVirtualIndexes);
  const virtualFlow = buildVirtualFlow(virtualizer.getVirtualItems(), scrollMargin, virtualizer.getTotalSize());

  return (
    <div
      ref={containerRef}
      data-virtualized-block-list="true"
      data-virtualized-block-count={blocks.length}
      className="relative w-full"
    >
      {virtualFlow.rows.map(({ item, gapBefore }) => {
        const block = blocks[item.index];
        if (!block) return null;
        return (
          <Fragment key={String(item.key)}>
            {gapBefore > 0 ? <div aria-hidden="true" style={{ height: `${gapBefore}px` }} /> : null}
            <VirtualBlockRow itemIndex={item.index} measureElement={virtualizer.measureElement} gapAfter={blocks[item.index + 1] ? blockGapVariable(block, blocks[item.index + 1] ?? null) : null}>
              <BlockSlot messageId={messageId} block={block} previousBlock={null} hasLeadingContent={false} isAssistant={isAssistant} highlightTargetId={highlightTargetId} taskItems={tasksByBlock.get(block.block_index)} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
            </VirtualBlockRow>
          </Fragment>
        );
      })}
      {virtualFlow.gapAfter > 0 ? <div aria-hidden="true" style={{ height: `${virtualFlow.gapAfter}px` }} /> : null}
    </div>
  );
}

type VirtualizedBlocksProps = {
  messageId: string;
  blocks: RenderBlockRead[];
  isAssistant: boolean;
  highlightTargetId?: string | null;
  tasksByBlock: Map<number, MarkdownTaskItem[]>;
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
};

function useVirtualMessageRegistration(
  messageId: string,
  indexByBlock: Map<number, number>,
  setPinnedVirtualIndexes: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
  const leaseCountsRef = useRef<Map<number, number>>(new Map());
  const acquireBlockLease = useCallback(async (blockIndex: number): Promise<ReaderBlockLease | null> => {
    const index = indexByBlock.get(blockIndex);
    if (index === undefined) return null;
    leaseCountsRef.current.set(index, (leaseCountsRef.current.get(index) ?? 0) + 1);
    setPinnedVirtualIndexes((current) => {
      if (current.has(index)) return current;
      const next = new Set(current);
      next.add(index);
      return next;
    });
    const targetId = `block-${messageId}-${blockIndex}`;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = Math.max(0, (leaseCountsRef.current.get(index) ?? 1) - 1);
      if (remaining > 0) {
        leaseCountsRef.current.set(index, remaining);
        return;
      }
      leaseCountsRef.current.delete(index);
      setPinnedVirtualIndexes((current) => {
        if (!current.has(index)) return current;
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    };
    let previousHeight: number | null = null;
    let measuredFrames = 0;
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const target = document.getElementById(targetId);
      const row = target?.closest<HTMLElement>("[data-index]");
      if (!target || !row) {
        previousHeight = null;
        measuredFrames = 0;
        continue;
      }
      const height = row.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) {
        previousHeight = null;
        measuredFrames = 0;
        continue;
      }
      measuredFrames = previousHeight !== null && Math.abs(previousHeight - height) <= 0.5
        ? measuredFrames + 1
        : 1;
      previousHeight = height;
      if (measuredFrames >= 2) return { targetId, release };
    }
    release();
    return null;
  }, [indexByBlock, messageId, setPinnedVirtualIndexes]);

  useEffect(() => registerVirtualMessage(messageId, acquireBlockLease), [acquireBlockLease, messageId]);
}

/**
 * Keep the virtualizer's coordinate system in sync without throwing away its
 * measured row heights on every content resize. The old implementation
 * observed the entire reader body and called `measure()` whenever its height
 * changed. Measuring one virtual row changes that height, so the freshly
 * measured cache was immediately cleared and rows fell back to estimates.
 * Tall Markdown blocks then overlapped the following absolutely positioned
 * rows.
 *
 * A full reset is only needed when typography or available width changes.
 * Ordinary row growth (images, Mermaid, KaTeX, highlighting) continues to be
 * handled by TanStack Virtual's per-row ResizeObserver.
 */
function useVirtualLayoutMeasurements(
  containerRef: React.RefObject<HTMLDivElement>,
  messageId: string,
  mode: "element" | "window",
  setScrollMargin: React.Dispatch<React.SetStateAction<number>>,
  resetMeasurements: () => void,
  measureElement: (element: Element | null) => void,
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let active = true;
    let frame = 0;
    let remeasureFrame = 0;
    let settleFrame = 0;
    let layoutSignature = readVirtualLayoutSignature(container);

    const measureMountedRows = () => {
      remeasureFrame = 0;
      container.querySelectorAll<HTMLElement>(":scope > [data-index]").forEach((row) => measureElement(row));
    };
    const resetForLayoutChange = () => {
      resetMeasurements();
      if (remeasureFrame) window.cancelAnimationFrame(remeasureFrame);
      if (settleFrame) window.cancelAnimationFrame(settleFrame);
      // `measure()` deliberately clears TanStack's item-size cache. React can
      // reuse the same row nodes, so explicitly feed their real geometry back
      // after layout has committed instead of waiting for a future
      // ResizeObserver tick. A second frame catches late line wrapping caused
      // by width/font/density changes before the browser can leave adjacent
      // absolutely positioned rows on stale offsets.
      remeasureFrame = window.requestAnimationFrame(() => {
        measureMountedRows();
        settleFrame = window.requestAnimationFrame(() => {
          settleFrame = 0;
          measureMountedRows();
        });
      });
    };
    const update = (forceReset = false) => {
      frame = 0;
      const next = mode === "window"
        ? container.getBoundingClientRect().top + window.scrollY
        : (() => {
            const root = container.closest<HTMLElement>('[data-reader-scroll-root="true"]');
            if (!root) return 0;
            return root.scrollTop + container.getBoundingClientRect().top - root.getBoundingClientRect().top;
          })();
      setScrollMargin((current) => Math.abs(current - next) > 0.5 ? next : current);

      const nextSignature = readVirtualLayoutSignature(container);
      if (forceReset || nextSignature !== layoutSignature) {
        layoutSignature = nextSignature;
        resetForLayoutChange();
      }
    };
    const schedule = (forceReset = false) => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => update(forceReset));
    };

    const frameElement = container.closest<HTMLElement>(".reader-frame");
    const resizeObserver = new ResizeObserver(() => schedule());
    resizeObserver.observe(container);
    const preferenceObserver = new MutationObserver(() => schedule());
    if (frameElement) {
      preferenceObserver.observe(frameElement, {
        attributes: true,
        attributeFilter: ["data-reader-density", "data-reader-width", "style"],
      });
    }
    const onWindowResize = () => schedule();
    const onReaderWindowLayout = (event: Event) => {
      const targetMessageId = (event as CustomEvent<{ messageId?: string }>).detail?.messageId;
      if (targetMessageId && targetMessageId !== messageId) return;
      schedule();
    };
    window.addEventListener("resize", onWindowResize);
    window.addEventListener(READER_WINDOW_LAYOUT_EVENT, onReaderWindowLayout);
    void document.fonts?.ready.then(() => {
      if (active) schedule(true);
    });
    schedule();
    return () => {
      active = false;
      if (frame) window.cancelAnimationFrame(frame);
      if (remeasureFrame) window.cancelAnimationFrame(remeasureFrame);
      if (settleFrame) window.cancelAnimationFrame(settleFrame);
      resizeObserver.disconnect();
      preferenceObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener(READER_WINDOW_LAYOUT_EVENT, onReaderWindowLayout);
    };
  }, [containerRef, measureElement, messageId, mode, resetMeasurements, setScrollMargin]);
}

function readVirtualLayoutSignature(container: HTMLElement): string {
  const frame = container.closest<HTMLElement>(".reader-frame");
  const style = window.getComputedStyle(container);
  return [
    Math.round(container.getBoundingClientRect().width * 2) / 2,
    frame?.dataset.readerWidth ?? "",
    frame?.dataset.readerDensity ?? "",
    style.fontSize,
    style.lineHeight,
    // Preferences are sourced on the reader frame, while the virtual list
    // inherits their resolved values. Include both so a 15-22px font switch
    // and every Markdown-spacing preset invalidate stale row estimates.
    frame ? window.getComputedStyle(frame).getPropertyValue("--reader-font-size") : "",
    frame ? window.getComputedStyle(frame).getPropertyValue("--reader-line-height") : "",
    style.getPropertyValue("--reader-paragraph-gap"),
    style.getPropertyValue("--reader-heading-before"),
    style.getPropertyValue("--reader-heading-after"),
    style.getPropertyValue("--reader-list-item-gap"),
    style.getPropertyValue("--reader-block-gap"),
    style.getPropertyValue("--reader-rich-block-gap"),
    style.getPropertyValue("--reader-divider-gap"),
  ].join("|");
}

type VirtualFlowItem = {
  index: number;
  key: string | number | bigint;
  start: number;
  end: number;
};

function buildVirtualFlow(items: VirtualFlowItem[], scrollMargin: number, totalSize: number) {
  const sorted = [...items].sort((left, right) => left.start - right.start);
  let cursor = 0;
  const rows = sorted.map((item) => {
    const localStart = Math.max(0, item.start - scrollMargin);
    const gapBefore = Math.max(0, localStart - cursor);
    cursor = Math.max(cursor, item.end - scrollMargin);
    return { item, gapBefore };
  });
  return {
    rows,
    gapAfter: Math.max(0, totalSize - cursor),
  };
}

function VirtualBlockRow({ itemIndex, measureElement, gapAfter, children }: {
  itemIndex: number;
  measureElement: (element: Element | null) => void;
  gapAfter: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={measureElement}
      data-index={itemIndex}
      className="w-full"
      style={gapAfter ? { paddingBlockEnd: `var(${gapAfter})` } : undefined}
    >
      {children}
    </div>
  );
}

function BlockSlot({ messageId, block, previousBlock, hasLeadingContent, isAssistant, highlightTargetId, taskItems, pendingTaskKeys, onTaskToggle }: {
  messageId: string;
  block: RenderBlockRead;
  previousBlock: RenderBlockRead | null;
  hasLeadingContent: boolean;
  isAssistant: boolean;
  highlightTargetId?: string | null;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
}) {
  return (
    <div className="reader-block-slot" style={hasLeadingContent ? slotGapStyle(blockGapVariable(previousBlock, block)) : undefined}>
      <BlockElement messageId={messageId} block={block} isAssistant={isAssistant} highlightTargetId={highlightTargetId} taskItems={taskItems} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
    </div>
  );
}

function slotGapStyle(variable: string): React.CSSProperties {
  return { marginBlockStart: `var(${variable})` };
}

function blockGapVariable(previous: RenderBlockRead | null, current: RenderBlockRead | null): string {
  if (!current) return "--reader-block-gap";
  if (isDividerBlock(previous) || isDividerBlock(current)) return "--reader-divider-gap";
  if (current.block_type === "heading") return "--reader-heading-before";
  if (previous?.block_type === "heading") return "--reader-heading-after";
  if (isRichBlock(previous) || isRichBlock(current)) return "--reader-rich-block-gap";
  return "--reader-block-gap";
}

function isDividerBlock(block: RenderBlockRead | null): boolean {
  return block?.block_type === "thematic_break" || block?.block_type === "horizontal_rule";
}

function isRichBlock(block: RenderBlockRead | null): boolean {
  return Boolean(block && ["blockquote", "code", "table", "image", "attachment", "mermaid", "math"].includes(block.block_type));
}

function BlockElement({ messageId, block, isAssistant, highlightTargetId, taskItems, pendingTaskKeys, onTaskToggle }: {
  messageId: string;
  block: RenderBlockRead;
  isAssistant: boolean;
  highlightTargetId?: string | null;
  taskItems?: MarkdownTaskItem[];
  pendingTaskKeys?: ReadonlySet<string>;
  onTaskToggle?: (taskKey: string, checked: boolean) => void;
}) {
  const domId = `block-${messageId}-${block.block_index}`;
  const unregisterRef = useRef<(() => void) | null>(null);
  const registerRef = useCallback((element: HTMLDivElement | null) => {
    unregisterRef.current?.();
    unregisterRef.current = element
      ? registerRenderedBlock(messageId, block.block_index, element)
      : null;
  }, [block.block_index, messageId]);

  return (
    <div
      ref={registerRef}
      id={domId}
      data-block-id={block.id}
      data-block-index={block.block_index}
      data-block-type={block.block_type}
      className={`reader-markdown-block max-w-full scroll-mt-3 rounded-xl transition ${
        highlightTargetId === domId
          ? "ring-2 ring-[var(--mark-border)] ring-offset-4 ring-offset-[var(--page)]"
          : ""
      }`}
    >
      <BlockRenderer block={block} isAssistant={isAssistant} taskItems={taskItems} pendingTaskKeys={pendingTaskKeys} onTaskToggle={onTaskToggle} />
    </div>
  );
}

function assignTasksToBlocks(
  blocks: RenderBlockRead[],
  allTasks: MarkdownTaskItem[],
  overrides?: ReadonlyMap<string, boolean>,
): Map<number, MarkdownTaskItem[]> {
  const output = new Map<number, MarkdownTaskItem[]>();
  let cursor = 0;
  for (const block of blocks) {
    const localTasks = extractMarkdownTaskItems(readBlockText(block));
    const localCount = localTasks.length;
    const stored = readStoredTaskItems(block.data.tasks);
    const selected = stored.length > 0
      ? stored
      : allTasks.slice(cursor, cursor + localCount).map((task, index) => ({
          ...task,
          checkedOffset: localTasks[index]?.checkedOffset ?? task.checkedOffset,
        }));
    if (selected.length > 0) output.set(block.block_index, applyTaskOverrides(selected, overrides));
    cursor += localCount;
  }
  return output;
}

function readStoredTaskItems(value: unknown): MarkdownTaskItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const task = item as Record<string, unknown>;
    const taskKey = typeof task.task_key === "string" ? task.task_key : null;
    if (!taskKey) return [];
    return [{
      taskKey,
      checked: Boolean(task.checked),
      checkedOffset: Number(task.local_checked_offset ?? task.checked_offset ?? 0),
      label: typeof task.label === "string" ? task.label : "",
      ordinal: Number(task.ordinal ?? 0),
    }];
  });
}

function applyTaskOverrides(items: MarkdownTaskItem[], overrides?: ReadonlyMap<string, boolean>): MarkdownTaskItem[] {
  if (!overrides || overrides.size === 0) return items;
  return items.map((item) => overrides.has(item.taskKey) ? { ...item, checked: Boolean(overrides.get(item.taskKey)) } : item);
}

function estimateBlockSize(block?: RenderBlockRead): number {
  if (!block) return 96;
  if (block.block_type === "image" || block.block_type === "mermaid") return 420;
  if (block.block_type === "code" || block.block_type === "table") return 260;
  if (block.block_type === "heading") return 72;
  const characters = block.char_count ?? block.plain_text?.length ?? 0;
  return Math.max(64, Math.min(720, 52 + Math.ceil(characters / 72) * 30));
}

function findLeadingThinkingBlocks(blocks: RenderBlockRead[]): { endIndex: number; text: string; label: string } | null {
  let scannedChars = 0;
  const captured: string[] = [];
  for (let index = 0; index < Math.min(blocks.length, 80); index += 1) {
    const text = stripLeadingTimestamp(readBlockText(blocks[index] ?? null)).trim();
    if (!text) {
      continue;
    }
    const lines = text.split(/\r?\n/).map((line) => stripQuote(line).trim()).filter(Boolean);
    scannedChars += text.length;
    if (scannedChars > 8000) {
      return null;
    }
    if (lines.some((line) => ANSWER_START_RE.test(line))) {
      return null;
    }
    captured.push(text);
    const durationLine = lines.find((line) => THINKING_DURATION_RE.test(line));
    if (durationLine) {
      const duration = durationLine.match(THINKING_DURATION_RE)?.[1] ?? null;
      return {
        endIndex: index,
        text: captured.join("\n\n"),
        label: duration ? `${THINKING_LABEL} · ${duration.replace(/\s+/g, " ")}` : THINKING_LABEL,
      };
    }
    if (!looksLikeThinkingBlock(lines)) {
      return null;
    }
  }
  return null;
}

function looksLikeThinkingBlock(lines: string[]): boolean {
  if (lines.length === 0) {
    return true;
  }
  return lines.every((line) => {
    if (line.length <= 180 && TRACE_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      return true;
    }
    if (line.startsWith("[") || line.startsWith("- ") || line.startsWith("* ") || /^\d+[.)]\s+/.test(line)) {
      return true;
    }
    if (line.includes("http://") || line.includes("https://") || line.includes("](")) {
      return true;
    }
    return false;
  });
}

function readBlockText(block: RenderBlockRead | null): string {
  if (!block) {
    return "";
  }
  if (typeof block.plain_text === "string") {
    return block.plain_text;
  }
  const value = block.data.text ?? block.data.title ?? block.data.code;
  return typeof value === "string" ? value : "";
}

function stripQuote(line: string): string {
  let stripped = line.trim();
  while (stripped.startsWith(">")) {
    stripped = stripped.slice(1).trim();
  }
  return stripped;
}
