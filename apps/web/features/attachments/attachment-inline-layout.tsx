"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Grid2X2 } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { useAttachmentAccess } from "./attachment-access";
import { AttachmentBlock, toViewerItem, type AttachmentBlockProps } from "./attachment-block";
import { useAttachmentViewer, type AttachmentViewerItem } from "./attachment-viewer";
import { computeJustifiedRows } from "./attachment-inline-policy";
import {
  buildAttachmentRenderPlan,
  resolveInlinePresentation,
  type AttachmentRuntimeRenderState,
  type InlinePresentation,
} from "./preview-adapter-registry";

export type AttachmentInlineGroupItem = Omit<AttachmentBlockProps,
  "attachment" | "inlinePresentation" | "grouped" | "galleryItems" | "galleryItemStyle" | "onImageRatio" | "onRuntimeChange"
> & { itemKey: string; attachment?: AttachmentRead };

type ResolvedItem = {
  input: AttachmentInlineGroupItem;
  attachment?: AttachmentRead;
  presentation: InlinePresentation;
  runtime: AttachmentRuntimeRenderState;
};

type PresentationRun = {
  key: string;
  presentation: InlinePresentation;
  items: ResolvedItem[];
};

export function AttachmentInlineGroup({ items }: { items: AttachmentInlineGroupItem[] }) {
  const access = useAttachmentAccess();
  const shareToken = access.kind === "share" ? access.token : undefined;
  const queries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["attachment", access.kind, shareToken ?? "owner", item.attachmentId],
      queryFn: () => access.kind === "offline" ? getOfflineAttachment(item.attachmentId) : getAttachment(item.attachmentId, shareToken),
      staleTime: 5 * 60 * 1000,
      enabled: !item.attachment,
    })),
  });
  const [runtimeByItem, setRuntimeByItem] = useState<Record<string, AttachmentRuntimeRenderState>>({});
  const runtimeCallbacks = useRef(new Map<string, (state: AttachmentRuntimeRenderState) => void>());
  const onRuntimeChange = useCallback((itemKey: string) => {
    const existing = runtimeCallbacks.current.get(itemKey);
    if (existing) return existing;
    const callback = (state: AttachmentRuntimeRenderState) => setRuntimeByItem((current) => {
      if (sameRuntimeState(current[itemKey], state)) return current;
      return { ...current, [itemKey]: state };
    });
    runtimeCallbacks.current.set(itemKey, callback);
    return callback;
  }, []);
  const resolved = items.map((input, index): ResolvedItem => {
    const attachment = input.attachment ?? queries[index]?.data;
    const runtime = runtimeByItem[input.itemKey] ?? { status: "idle" as const };
    return {
      input,
      attachment,
      presentation: attachment ? resolveInlinePresentation(buildAttachmentRenderPlan(attachment, runtime)) : "file-list",
      runtime,
    };
  });
  const runs = partitionPresentationRuns(resolved);

  return (
    <div className="attachment-inline-sequence" data-testid="attachment-inline-sequence">
      {runs.map((run) => (
        <PresentationGroup
          key={run.key}
          run={run}
          access={access}
          onRuntimeChange={onRuntimeChange}
        />
      ))}
    </div>
  );
}

function PresentationGroup({ run, access, onRuntimeChange }: {
  run: PresentationRun;
  access: ReturnType<typeof useAttachmentAccess>;
  onRuntimeChange: (itemKey: string) => (state: AttachmentRuntimeRenderState) => void;
}) {
  const viewer = useAttachmentViewer();
  const [expanded, setExpanded] = useState(false);
  const collapsible = run.presentation === "audio-list" || run.presentation === "file-list";
  const visibleItems = collapsible && !expanded ? run.items.slice(0, 5) : run.items;
  const hiddenCount = run.items.length - visibleItems.length;

  if (run.presentation === "gallery") {
    const galleryItems = run.items.map((item) => toViewerItem(item.input));
    return (
      <AttachmentLane presentation="gallery">
        <JustifiedImageGallery
          items={run.items}
          galleryItems={galleryItems}
          onRuntimeChange={onRuntimeChange}
          onShowAll={(trigger) => viewer.open({
            source: access.kind === "share" ? "share" : access.kind === "offline" ? "offline" : "reader",
            scope: "message-gallery",
            items: galleryItems,
            activeItemKey: galleryItems[Math.min(5, galleryItems.length - 1)]?.itemKey ?? galleryItems[0]?.itemKey ?? "",
            initialMode: "image-overview",
            access,
            permissions: {
              downloadOriginal: true,
              enumerateConversationImages: access.kind === "owner",
              batchDownload: access.kind === "owner",
            },
            trigger,
          })}
        />
      </AttachmentLane>
    );
  }

  const surface = run.presentation === "audio-list" || run.presentation === "file-list";
  return (
    <AttachmentLane presentation={run.presentation}>
      <div
        className={surface ? `attachment-group-surface attachment-${run.presentation}` : `attachment-${run.presentation}-group`}
        data-testid="attachment-group"
        data-attachment-group={run.presentation}
      >
        {visibleItems.map((item) => (
          <AttachmentBlock
            key={item.input.itemKey}
            {...item.input}
            attachment={item.attachment}
            inlinePresentation={run.presentation}
            grouped
            runtimeState={item.runtime}
            onRuntimeChange={onRuntimeChange(item.input.itemKey)}
          />
        ))}
        {collapsible && run.items.length > 5 ? (
          <button type="button" className="attachment-group-expander" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起附件组" : `展开另外 ${hiddenCount} 个`}
          </button>
        ) : null}
      </div>
    </AttachmentLane>
  );
}

function AttachmentLane({ presentation, children }: { presentation: InlinePresentation; children: ReactNode }) {
  return (
    <section
      className={`attachment-lane attachment-lane--${presentation}`}
      data-inline-presentation={presentation}
      aria-label={presentationLabel(presentation)}
    >
      {children}
    </section>
  );
}

function JustifiedImageGallery({ items, galleryItems, onRuntimeChange, onShowAll }: {
  items: ResolvedItem[];
  galleryItems: AttachmentViewerItem[];
  onRuntimeChange: (itemKey: string) => (state: AttachmentRuntimeRenderState) => void;
  onShowAll: (trigger: HTMLElement) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(280, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hiddenCount = items.length > 6 ? items.length - 5 : 0;
  const visible = hiddenCount > 0 ? items.slice(0, 5) : items;
  const layoutItems = [
    ...visible.map((item) => ({ key: item.input.itemKey, ratio: ratios[item.input.itemKey] ?? 1.5, item })),
    ...(hiddenCount > 0 ? [{ key: "__more__", ratio: 1.35, item: null }] : []),
  ];
  const rows = computeJustifiedRows(layoutItems, width);

  return (
    <div ref={rootRef} className="attachment-image-gallery" data-testid="attachment-group" data-attachment-group="gallery">
      {rows.map((row, rowIndex) => (
        <div key={`gallery-row-${rowIndex}`} className="attachment-gallery-row">
          {row.items.map((layoutItem) => {
            const style = { "--attachment-gallery-item-width": `${layoutItem.width}px`, "--attachment-gallery-row-height": `${row.height}px` } as CSSProperties;
            if (!layoutItem.item) {
              return (
                <button
                  key="gallery-more"
                  type="button"
                  className="attachment-gallery-more"
                  style={style}
                  onClick={(event) => onShowAll(event.currentTarget)}
                  aria-label={`当前组还有 ${hiddenCount} 张图片，查看全部图片`}
                >
                  <Grid2X2 className="h-6 w-6" />
                  <strong>+{hiddenCount}</strong>
                  <span>查看全部图片</span>
                </button>
              );
            }
            const resolved = layoutItem.item;
            return (
              <AttachmentBlock
                key={resolved.input.itemKey}
                {...resolved.input}
                attachment={resolved.attachment}
                inlinePresentation="gallery"
                grouped
                runtimeState={resolved.runtime}
                galleryItems={galleryItems}
                galleryItemStyle={style}
                onImageRatio={(ratio) => setRatios((current) => current[resolved.input.itemKey] === ratio ? current : { ...current, [resolved.input.itemKey]: ratio })}
                onRuntimeChange={onRuntimeChange(resolved.input.itemKey)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function partitionPresentationRuns(items: ResolvedItem[]): PresentationRun[] {
  const runs: PresentationRun[] = [];
  for (const item of items) {
    const previous = runs.at(-1);
    if (previous?.presentation === item.presentation) {
      previous.items.push(item);
    } else {
      runs.push({ key: `${item.input.itemKey}:${item.presentation}`, presentation: item.presentation, items: [item] });
    }
  }
  return runs;
}

function sameRuntimeState(left: AttachmentRuntimeRenderState | undefined, right: AttachmentRuntimeRenderState): boolean {
  if (!left || left.status !== right.status) return false;
  if (left.status === "idle") return true;
  if (right.status === "idle") return false;
  return left.requestId === right.requestId;
}

function presentationLabel(presentation: InlinePresentation): string {
  if (presentation === "gallery") return "图片附件";
  if (presentation === "audio-list") return "音频附件";
  if (presentation === "video") return "视频附件";
  if (presentation === "file-list") return "文件附件";
  if (presentation === "data") return "数据附件";
  return "阅读附件";
}
