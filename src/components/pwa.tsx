"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useSync, useSyncStatus } from "@/lib/sync/provider";
import { addDays, today } from "@/lib/time";

/** Enregistre le service worker (en production : en développement, il gênerait le rechargement à chaud). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }, []);
  return null;
}

/**
 * Demande au service worker de garder les fiches utiles hors ligne : séances d'hier à J+7, courses à venir
 * et leur mode course. Relancé quand ces listes changent et que le réseau est là.
 */
export function OfflinePrecache() {
  const { db } = useSync();
  const { online } = useSyncStatus();
  const urls = useLiveQuery(async () => {
    const now = today();
    const [sessions, races] = await Promise.all([
      db.planned_sessions.where("date").between(addDays(now, -1), addDays(now, 7), true, true).toArray(),
      db.races.toArray(),
    ]);
    return [
      ...sessions.filter((s) => !s.deleted_at).map((s) => `/seance/${s.id}`),
      ...races.filter((r) => !r.deleted_at && r.date >= now).flatMap((r) => [`/courses/${r.id}`, `/courses/${r.id}/mode`]),
    ].sort();
  }, [db]);
  const key = urls?.join("|");

  useEffect(() => {
    if (!online || !key || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "precache", urls: key.split("|") }));
  }, [online, key]);
  return null;
}
