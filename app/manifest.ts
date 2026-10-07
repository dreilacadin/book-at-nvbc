import type { MetadataRoute } from "next";

// Lets the site be added to a phone's Home Screen (needed for push notifications on iPhone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NVBC Courts",
    short_name: "NVBC",
    description: "Badminton & pickleball court reservations at NV Badminton Center.",
    start_url: "/",
    display: "standalone",
    background_color: "#000023",
    theme_color: "#1e274b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
