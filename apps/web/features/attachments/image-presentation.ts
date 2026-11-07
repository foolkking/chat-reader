"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAttachment, getImageDisplay, type ImageDisplayRead } from "../../lib/api";
import type { AttachmentRead } from "../../lib/types";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import { imageBodyGeometry, validatedImageDisplay, validatedImageGeometry, type ImageSize } from "../../lib/image-display";
import { useAttachmentAccess } from "./attachment-access";

type Source = { id: string; sha256?: string; metadata?: Record<string, unknown> };
let inspecting = 0;
const waiting: Array<() => void> = [];
let smallViewport: { key: string; height: number } | undefined;
function smallViewportHeight() {
  const key = `${window.innerWidth}:${window.innerHeight}`;
  if (smallViewport?.key === key) return smallViewport.height;
  // innerHeight can follow mobile browser chrome; the fold contract uses svh.
  // Measure once per viewport size, outside the reading DOM/virtual rows.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none;contain:strict";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height || window.innerHeight;
  probe.remove();
  smallViewport = { key, height };
  return height;
}
async function boundedRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (inspecting >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else inspecting++;
  try { signal.throwIfAborted(); return await read(); }
  finally {
    // Transfer the occupied slot directly to the next waiter so a new read
    // cannot overtake its microtask and briefly exceed the concurrency bound.
    const next = waiting.shift();
    if (next) next(); else inspecting--;
  }
}

export function useImageSource(source: Source, element?: RefObject<HTMLElement | null>) {
  const access = useAttachmentAccess();
  const [generation, setGeneration] = useState(authenticationGeneration);
  useEffect(() => {
    const changed = () => setGeneration(authenticationGeneration());
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
  }, []);
  const scope = access.kind === "share" ? access.token : access.kind === "admin" ? access.userId : "";
  const identity = [generation, access.kind, scope, source.id, source.sha256];
  const queryKey = ["image-display", ...identity];
  const query = useQuery<ImageDisplayRead>({ queryKey, queryFn: () => getImageDisplay(source.id),
    enabled: false, staleTime: Infinity, gcTime: Infinity });
  const saved = validatedImageDisplay(source.metadata?.image_display_v1, source.sha256);
  // Only the owner mutation cache may override an online snapshot. Offline
  // never consults it, even when an attachment ID exists in both contexts.
  const display = access.kind === "owner" ? validatedImageDisplay(query.data, source.sha256) ?? saved : saved;
  const stored = validatedImageGeometry(source.metadata?.image_geometry_v1, source.sha256);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element?.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [element, source.id, source.sha256]);
  const detail = useQuery({
    queryKey: ["image-geometry", ...identity],
    queryFn: ({ signal }) => boundedRead(() => {
      if (generation !== authenticationGeneration()) throw new DOMException("Retired", "AbortError");
      return getAttachment(source.id, access.kind === "share" ? access.token : undefined,
        access.kind === "admin" ? access.userId : undefined, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
    }, signal),
    enabled: Boolean(element && visible && source.id && source.sha256 && !stored && !display && access.kind !== "offline"),
    staleTime: Infinity, retry: false,
  });
  const fetched = detail.data?.asset_object?.sha256 === source.sha256 ? detail.data : undefined;
  const fetchedDisplay = validatedImageDisplay(fetched?.metadata?.image_display_v1, source.sha256);
  const effective = display ?? fetchedDisplay;
  const geometry = stored ?? validatedImageGeometry(fetched?.metadata?.image_geometry_v1, source.sha256) ?? effective;
  const client = useQueryClient();
  const decodedKey = ["image-decoded-geometry", ...identity];
  const decoded = useQuery<ImageSize>({ queryKey: decodedKey, enabled: false, staleTime: Infinity, gcTime: Infinity });
  // When an online legacy read may still supply a saved percentage, avoid
  // normalizing to original pixels and immediately normalizing a second time.
  // A bounded failed/empty read still permits browser decode as the fallback.
  const fallback = access.kind === "offline" || !source.sha256 || detail.isFetched ? decoded.data : undefined;
  const size = effective ? { width: effective.width, height: effective.height }
    : geometry ? { width: geometry.original_width, height: geometry.original_height } : fallback;
  return { display: effective, geometry, size, generation, queryKey, identity,
    onDecoded: (width: number, height: number) => {
      if (generation === authenticationGeneration() && width > 0 && height > 0 && width <= 1_000_000 && height <= 1_000_000) {
        client.setQueryData(decodedKey, { width, height });
      }
    } };
}

export function useImageDisplay(attachment: Pick<AttachmentRead, "id" | "metadata" | "asset_object">) {
  return useImageSource({ id: attachment.id, sha256: attachment.asset_object?.sha256, metadata: attachment.metadata });
}

export function useImageLane(element: RefObject<HTMLElement | null>) {
  const [lane, setLane] = useState({ width: 320, height: 900 });
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    // Observe the reading lane, not a size-dependent image/figure.
    const parent = node.closest<HTMLElement>(".attachment-lane, .reader-image-paragraph") ?? node.parentElement;
    if (!parent) return;
    const measure = () => {
      const width = parent.clientWidth || 320, height = smallViewportHeight();
      setLane(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [element]);
  return lane;
}

/** Query-client memory only, keyed by source, authority and true occurrence. */
export function useImageFold(identity: unknown[], occurrence: string) {
  const client = useQueryClient();
  const queryKey = ["image-expanded", ...identity, occurrence];
  const query = useQuery<boolean>({ queryKey, enabled: false, gcTime: Infinity, staleTime: Infinity });
  return { expanded: query.data === true, setExpanded: (value: boolean) => client.setQueryData(queryKey, value) };
}

export function useBodyImage(attachment: AttachmentRead, occurrence: string) {
  const ref = useRef<HTMLElement | null>(null);
  const source = useImageSource({ id: attachment.id, sha256: attachment.asset_object?.sha256, metadata: attachment.metadata }, ref);
  const lane = useImageLane(ref);
  const fold = useImageFold(source.identity, occurrence);
  return { ...source, ...fold, ref, lane, body: imageBodyGeometry(source.size, lane.width, lane.height, fold.expanded) };
}
