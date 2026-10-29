import type { MetadataRoute } from "next";

/**
 * Wave PWA manifest — served at /manifest.webmanifest.
 * Next.js auto-injects <link rel="manifest"> when this file exists.
 * Colors match layout.tsx (themeColor #030303).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wave — Your music, your language",
    short_name: "Wave",
    description:
      "Search, play, and discover Indian music across every language. Originals only — free forever.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en",
    background_color: "#030303",
    theme_color: "#030303",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // optional polish later: add "screenshots" (2+ PNGs) for the rich install UI
  };
}
