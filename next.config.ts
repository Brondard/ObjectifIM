import type { NextConfig } from "next";

// cacheComponents désactivé : les données sont pilotées côté client (hors ligne, cf. docs/decisions.md D1)
// et chaque lecture de session sous cacheComponents imposerait une frontière <Suspense>.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
