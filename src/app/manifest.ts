import type { MetadataRoute } from "next";

// Installed from Chrome on the kitchen tablet ("Add to Home screen"), the app
// opens straight into Tasks with no browser or system bars, locked to
// landscape because the Tasks layout is built for it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sésamo Tasks",
    short_name: "Sésamo Tasks",
    description: "Internal tools for running the restaurant",
    id: "/staff/tasks",
    start_url: "/staff/tasks",
    scope: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
