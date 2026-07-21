import type { Metadata, Viewport } from "next";
import { QueryProvider } from "../components/query-provider";
import { PreferencesProvider } from "../components/preferences-provider";
import { ImportDialogProvider } from "../components/import-dialog-provider";
import { ShortcutManager } from "../components/shortcut-manager";
import { InteractionDialogProvider } from "../components/interaction-dialog-provider";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import { resolveLocale } from "../lib/i18n";
import type { UserPreferenceRead } from "../lib/types";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "chat-reader",
  description: "ChatGPT export archive reader foundation",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "chat-reader",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f7f5",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const preferences = await loadInitialPreferences();
  const initialLocale = resolveLocale(preferences.locale_mode, headers().get("accept-language") ?? "");
  const initialTheme = preferences.theme_mode === "dark" ? "dark" : "light";
  return (
    <html lang={initialLocale} data-theme={initialTheme} suppressHydrationWarning>
      <body>
        <QueryProvider>
          <PreferencesProvider initialPreferences={preferences} initialLocale={initialLocale}>
            <InteractionDialogProvider><ImportDialogProvider><ShortcutManager />{children}</ImportDialogProvider></InteractionDialogProvider>
          </PreferencesProvider>
        </QueryProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

async function loadInitialPreferences(): Promise<UserPreferenceRead> {
  const fallback: UserPreferenceRead = {
    theme_mode: "light",
    locale_mode: "auto",
    reader_width_mode: "standard",
    conversation_sort_mode: "recent_read",
    conversation_sort_direction: "desc",
    project_sort_mode: "recent_read",
    project_sort_direction: "desc",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  try {
    const apiUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${apiUrl}/api/preferences`, { cache: "no-store" });
    return response.ok ? await response.json() as UserPreferenceRead : fallback;
  } catch {
    return fallback;
  }
}
