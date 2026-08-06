"use client";

import { createContext, useContext } from "react";

export type AttachmentAccess =
  | { kind: "owner" }
  | { kind: "share"; token: string }
  | { kind: "offline" };

const AttachmentAccessContext = createContext<AttachmentAccess>({ kind: "owner" });

export function AttachmentAccessProvider({
  access,
  children,
}: {
  access: AttachmentAccess;
  children: React.ReactNode;
}) {
  return <AttachmentAccessContext.Provider value={access}>{children}</AttachmentAccessContext.Provider>;
}

export function useAttachmentAccess(): AttachmentAccess {
  return useContext(AttachmentAccessContext);
}
