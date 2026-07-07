import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "chat-reader",
  description: "ChatGPT export archive reader foundation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
