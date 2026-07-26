import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/library/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "chat-reader",
  },
};

export default function LibraryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
