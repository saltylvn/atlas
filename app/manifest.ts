import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas — personal chief of staff",
    short_name: "Atlas",
    description: "Morning brief, week plan, people, jobs and news in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#141414",
    theme_color: "#141414",
    categories: ["productivity", "lifestyle"],
    prefer_related_applications: false,
    icons: [
      { src: "/icon/small", sizes: "192x192", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home-screen icon to jump straight to a tab.
    shortcuts: [
      { name: "Plan", short_name: "Plan", url: "/plan", icons: [{ src: "/icon/small", sizes: "192x192", type: "image/png" }] },
      { name: "People", short_name: "People", url: "/people", icons: [{ src: "/icon/small", sizes: "192x192", type: "image/png" }] },
      { name: "News", short_name: "News", url: "/news", icons: [{ src: "/icon/small", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
