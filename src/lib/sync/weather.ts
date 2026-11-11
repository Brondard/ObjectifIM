"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { OPEN_METEO_URL, parseOpenMeteo, type Hourly } from "@/domain/life/weather";
import { now } from "@/lib/time";
import { useSync } from "./provider";

const KEY = "weather";
const MAX_AGE_MS = 3 * 3600 * 1000;

/**
 * Prévisions horaires à 7 jours (Open-Meteo, sans clé), gardées en local : relues hors ligne, rafraîchies
 * toutes les 3 heures quand le réseau est là. Lieu : règle « weather » (Valbonne par défaut).
 */
export function useForecast(): Hourly | null | undefined {
  const { db } = useSync();
  const cached = useLiveQuery(() => db.meta.get(KEY), [db]);
  const place = useLiveQuery(async () => {
    const r = (await db.engine_rules.where("rule_key").equals("weather").toArray()).find((x) => !x.deleted_at);
    const p = (r?.params ?? {}) as { home_lat?: number; home_lng?: number };
    return { lat: p.home_lat ?? 43.6416, lng: p.home_lng ?? 7.0089 };
  }, [db]);

  useEffect(() => {
    if (cached === undefined || !place || !navigator.onLine) return;
    const value = cached?.value as { fetched_at: number; lat: number; lng: number } | undefined;
    if (value && now().getTime() - value.fetched_at < MAX_AGE_MS && value.lat === place.lat && value.lng === place.lng) return;
    void fetch(OPEN_METEO_URL(place.lat, place.lng))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const hourly = json ? parseOpenMeteo(json) : null;
        if (hourly) return db.meta.put({ key: KEY, value: { fetched_at: now().getTime(), lat: place.lat, lng: place.lng, hourly } });
      })
      .catch(() => {});
  }, [cached, place, db]);

  if (cached === undefined) return undefined;
  return ((cached?.value as { hourly?: Hourly } | undefined)?.hourly ?? null);
}
