import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BY Tickets — Buy. Attend. Earn. Connect.",
    short_name: "BY Tickets",
    description: "Blockchain-verified event tickets and rewards for Africa's creative scene.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1a1220",
    theme_color: "#e2366b",
    categories: ["entertainment", "lifestyle", "events"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My Tickets", url: "/tickets" },
      { name: "Scanner", url: "/scan" },
    ],
  };
}
