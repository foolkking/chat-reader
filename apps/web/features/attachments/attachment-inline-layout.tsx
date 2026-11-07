"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Grid2X2 } from "lucide-react";
import { getAttachment } from "../../lib/api";
import { getOfflineAttachment } from "../../lib/offline-db";
import type { AttachmentRead } from "../../lib/types";
import { useAttachmentAccess } from "./attachment-access";
import { AttachmentBlock, toViewerItem, type AttachmentBlockProps } from "./attachment-block";
import { useAttachmentViewer, type AttachmentViewerItem } from "./attachment-viewer";
import { registerReaderBlockReveal } from "../conversations/block-virtualization";
import { usePreferences } from "../../components/preferences-provider";
import { registerRenderedBlock } from "../conversations/rendered-block-registry";
import {
  attachmentAssetIdentity,
  buildAttachmentRenderPlan,
  resolveInlinePresentation,
  resolveAttachmentCapability,
  type AttachmentRuntimeRenderState,
  type InlinePresentation,
} from "./preview-adapter-registry";

export type AttachmentInlineGroupItem = Omit<AttachmentBlockProps,
  "attachment" | "inlinePresentation" | "grouped" | "galleryItems" | "galleryItemStyle" | "onImageRatio" | "onRuntimeChange"
> & { itemKey: string; attachment?: AttachmentRead; markdown?: string; blockId?: string };

type ResolvedItem = {
  input: AttachmentInlineGroupItem;
  attachment?: AttachmentRead;
  assetIdentity: string;
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
      queryKey: ["attachment", access.kind, access.kind === "admin" ? access.userId : shareToken ?? "owner", item.attachmentId],
      queryFn: () => access.kind === "offline" ? getOfflineAttachment(item.attachmentId) : getAttachment(item.attachmentId, shareToken, access.kind === "admin" ? access.userId : undefined),
      staleTime: 5 * 60 * 1000,
      enabled: !item.attachment,
      ...(access.kind === "offline" ? { networkMode: "always" as const } : {}),
    })),
  });
  const [runtimeByItem, setRuntimeByItem] = useState<Record<string, { assetIdentity: string; state: AttachmentRuntimeRenderState }>>({});
  const onRuntimeChange = useCallback((itemKey: string, assetIdentity: string) => (state: AttachmentRuntimeRenderState) => {
    setRuntimeByItem((current) => {
      const existing = current[itemKey];
      if (existing?.assetIdentity === assetIdentity && sameRuntimeState(existing.state, state)) return current;
      return { ...current, [itemKey]: { assetIdentity, state } };
    });
  }, []);
  const resolved = items.map((input, index): ResolvedItem => {
    const attachment = input.attachment ?? queries[index]?.data;
    const assetIdentity = attachmentAssetIdentity(attachment);
    const stored = runtimeByItem[input.itemKey];
    const runtime = stored?.assetIdentity === assetIdentity ? stored.state : { status: "idle" as const };
    return {
      input,
      attachment,
      assetIdentity,
      // A known image keeps its slot even when loading/decoding fails. The
      // RenderPlan still controls what may be opened or downloaded inside it.
      presentation: input.imageHint || (attachment && resolveAttachmentCapability(attachment).viewerKind === "image")
        ? "gallery" : attachment ? resolveInlinePresentation(buildAttachmentRenderPlan(attachment, runtime)) : "file-list",
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
  onRuntimeChange: (itemKey: string, assetIdentity: string) => (state: AttachmentRuntimeRenderState) => void;
}) {
  const viewer = useAttachmentViewer();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (run.presentation === "gallery") return;
    const releases = run.items.map(({ input }) => input.messageId && input.blockIndex !== undefined
      ? registerReaderBlockReveal(input.messageId, input.blockIndex, () => setExpanded(true))
      : () => undefined);
    return () => releases.forEach(release => release());
  }, [run]);
  const collapsible = run.presentation === "audio-list" || run.presentation === "file-list";
  const visibleItems = collapsible && !expanded ? run.items.slice(0, 5) : run.items;
  const hiddenCount = run.items.length - visibleItems.length;

  if (run.presentation === "gallery") {
    const galleryItems = run.items.map((item) => toViewerItem(item.input));
    return (
      <AttachmentLane presentation="gallery">
        <StableImageGallery
          items={run.items}
          galleryItems={galleryItems}
          onRuntimeChange={onRuntimeChange}
          onShowAll={(trigger) => viewer.open({
            source: access.kind === "share" ? "share" : access.kind === "offline" ? "offline" : "reader",
            scope: "message-gallery",
            items: galleryItems,
            activeItemKey: galleryItems[Math.min(5, galleryItems.length - 1)]?.itemKey ?? galleryItems[0]?.itemKey ?? "",
            initialMode: "image-overview",
            initialKind: "image",
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
          <GalleryCell key={item.input.itemKey} item={item.input} gallery={false}><AttachmentBlock
            {...item.input}
            attachment={item.attachment}
            inlinePresentation={run.presentation}
            grouped
            runtimeState={item.runtime}
            onRuntimeChange={onRuntimeChange(item.input.itemKey, item.assetIdentity)}
          /></GalleryCell>
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

function StableImageGallery({ items, galleryItems, onRuntimeChange, onShowAll }: {
  items: ResolvedItem[];
  galleryItems: AttachmentViewerItem[];
  onRuntimeChange: (itemKey: string, assetIdentity: string) => (state: AttachmentRuntimeRenderState) => void;
  onShowAll: (trigger: HTMLElement) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  useEffect(() => {
    const releases = items.map(({ input }) => input.messageId && input.blockIndex !== undefined
      ? registerReaderBlockReveal(input.messageId, input.blockIndex, () => setRevealedKey(input.itemKey))
      : () => undefined);
    return () => releases.forEach(release => release());
  }, [items]);
  const hiddenCount = items.length > 6 ? items.length - 5 : 0;
  const revealed = items.find(item => item.input.itemKey === revealedKey);
  const visible = hiddenCount > 0
    ? revealed && !items.slice(0, 5).includes(revealed) ? [...items.slice(0, 4), revealed] : items.slice(0, 5)
    : items;
  return <div className="attachment-image-gallery" data-gallery-count={Math.min(items.length, 6)} data-single-image={items.length === 1 ? "true" : undefined}
    data-testid="attachment-group" data-attachment-group="gallery">
    {visible.map(resolved => <GalleryCell key={resolved.input.itemKey} item={resolved.input}>
      <AttachmentBlock {...resolved.input} attachment={resolved.attachment} inlinePresentation="gallery"
        grouped singleImage={items.length === 1} runtimeState={resolved.runtime} galleryItems={galleryItems}
        onRuntimeChange={onRuntimeChange(resolved.input.itemKey, resolved.assetIdentity)} />
    </GalleryCell>)}
    {hiddenCount > 0 ? <button type="button" className="attachment-gallery-more" onClick={event => onShowAll(event.currentTarget)}
      aria-label={zh ? `当前组还有 ${hiddenCount} 张图片，查看全部图片` : `${hiddenCount} more images. View all images`}>
      <Grid2X2 className="h-6 w-6" /><strong>+{hiddenCount}</strong><span>{zh ? "查看全部图片" : "View all images"}</span>
    </button> : null}
  </div>;
}

function GalleryCell({ item, children, gallery = true }: { item: AttachmentInlineGroupItem; children: ReactNode; gallery?: boolean }) {
  const register = useCallback((element: HTMLDivElement | null) => {
    if (element && item.messageId && item.blockIndex !== undefined) {
      return registerRenderedBlock(item.messageId, item.blockIndex, element, item.markdown ?? "");
    }
  }, [item.messageId, item.blockIndex, item.markdown]);
  return <div ref={register} className={gallery ? "attachment-gallery-cell" : "min-w-0"}
    id={item.messageId && item.blockIndex !== undefined ? `block-${item.messageId}-${item.blockIndex}` : undefined}
    data-block-index={item.blockIndex} data-block-id={item.blockId} data-block-type={item.imageHint ? "image" : "attachment"} data-reader-copy-block="true">{children}</div>;
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
