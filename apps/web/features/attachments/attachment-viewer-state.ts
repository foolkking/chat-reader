"use client";

import { createContext, useContext } from "react";

// Keep visibility separate from the stable open/close commands. Consumers such
// as AttachmentPreviewDialog must not reopen their session on visibility changes.
export const AttachmentViewerOpenContext = createContext(false);

export function useAttachmentViewerOpen(): boolean {
  return useContext(AttachmentViewerOpenContext);
}
