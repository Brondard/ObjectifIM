import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ObjectifIM",
    short_name: "ObjectifIM",
    description: "Planification et suivi d'entraînement triathlon",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Aujourd'hui", url: "/" },
      { name: "Semaine", url: "/semaine" },
      { name: "Ajouter une séance", url: "/seance/nouvelle" },
    ],
  };
}
