import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "chat-reader",
    short_name: "chat-reader",
    description: "ChatGPT export archive reader",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f7f8",
    theme_color: "#10a37f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
