import type { ImageSize } from "../../lib/image-display";

export type ImageViewMode = "fit" | "width" | "original";
/** Intrinsic image pixels are the transform's base coordinate system. */
export function imageViewerTransform(image: ImageSize, canvas: ImageSize, mode: ImageViewMode) {
  const fit = Math.min(1, canvas.width / Math.max(1, image.width), canvas.height / Math.max(1, image.height));
  const scale = mode === "original" ? 1 : mode === "width" ? Math.min(1, canvas.width / Math.max(1, image.width)) : fit;
  return {
    scale: Math.max(.000001, scale),
    x: (canvas.width - image.width * scale) / 2,
    y: mode === "width" ? 0 : Math.max(0, (canvas.height - image.height * scale) / 2),
  };
}
