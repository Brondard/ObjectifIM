import type { NextConfig } from "next";

// cacheComponents désactivé : les données sont pilotées côté client (hors ligne, cf. docs/decisions.md D1)
// et chaque lecture de session sous cacheComponents imposerait une frontière <Suspense>.
const nextConfig: NextConfig = {
  // Le service worker n'est jamais mis en cache par le navigateur : une nouvelle version s'installe aussitôt.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
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
