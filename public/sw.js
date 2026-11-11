/*
 * Service worker d'ObjectifIM : l'application s'ouvre sans réseau (bord de piscine, salle, départ de course).
 * Les données vivent dans IndexedDB (copie locale synchronisée) ; ce fichier ne met en cache que l'application :
 *   - fichiers statiques de Next : cache d'abord (noms versionnés, immuables) ;
 *   - pages et requêtes de navigation : réseau d'abord, cache si hors ligne ;
 *   - API et Supabase : jamais mis en cache ici.
 * Il reçoit aussi les notifications push.
 */
const VERSION = "v4";
const STATIC_CACHE = `objectifim-static-${VERSION}`;
const PAGE_CACHE = `objectifim-pages-${VERSION}`;

// Écrans indispensables hors ligne, mis en cache dès l'installation.
const SHELL = [
  "/", "/semaine", "/mois", "/saison", "/plan", "/seance/nouvelle", "/analyse", "/reglages", "/courses", "/nutrition", "/genes", "/replanifier",
  "/musculation", "/materiel", "/records", "/revue", "/simulateur",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precache(SHELL).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("objectifim-") && ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Met des pages en cache ; une page qui redirige vers la connexion n'est pas gardée. */
async function precache(urls) {
  const cache = await caches.open(PAGE_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: "include", redirect: "follow" });
        if (res.ok && !res.redirected) await cache.put(url, res);
      } catch {
        /* hors ligne : on réessaiera */
      }
    }),
  );
}

// Le client envoie les pages utiles des jours à venir (séances, mode course) pour qu'elles s'ouvrent hors ligne.
self.addEventListener("message", (event) => {
  if (event.data?.type === "precache" && Array.isArray(event.data.urls)) {
    event.waitUntil(precache(event.data.urls));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/sw.js") return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  const isRsc = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (request.mode === "navigate" || isRsc) {
    event.respondWith(networkFirst(request, isRsc));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, isRsc) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(request);
    // Ne garde pas une redirection vers /login : hors ligne, on veut la dernière page valide.
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(request)) ?? (isRsc ? undefined : await cache.match(new URL(request.url).pathname));
    if (hit) return hit;
    if (!isRsc) {
      const home = await cache.match("/");
      if (home) return home;
    }
    return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/192",
      badge: "/icons/192",
      tag: data.tag,
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((c) => c?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
