import type { Metadata } from "next";
import { QueryProvider } from "../components/query-provider";
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
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
