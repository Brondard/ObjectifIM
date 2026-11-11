"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import type { BusyEvent } from "@/domain/life/agenda";
import { addDays, now, today } from "@/lib/time";
import { useSync } from "./provider";

const KEY = "agenda";
const MAX_AGE_MS = 3600 * 1000;

/**
 * Créneaux occupés de l'agenda personnel sur 3 semaines, gardés en local (relus hors ligne) et
 * rafraîchis toutes les heures quand le réseau est là. undefined : lecture en cours ; [] : rien ou non branché.
 */
export function useAgenda(): BusyEvent[] | undefined {
  const { db } = useSync();
  const cached = useLiveQuery(() => db.meta.get(KEY), [db]);

  useEffect(() => {
    if (cached === undefined || !navigator.onLine) return;
    const value = cached?.value as { fetched_at: number } | undefined;
    if (value && now().getTime() - value.fetched_at < MAX_AGE_MS) return;
    const from = addDays(today(), -1);
    void fetch(`/api/calendar/busy?from=${from}&to=${addDays(today(), 21)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json && db.meta.put({ key: KEY, value: { fetched_at: now().getTime(), events: json.events ?? [], connected: json.connected } }))
      .catch(() => {});
  }, [cached, db]);

  if (cached === undefined) return undefined;
  return ((cached?.value as { events?: BusyEvent[] } | undefined)?.events ?? []);
}

/** Force la relecture (après avoir branché ou retiré un agenda). */
export const invalidateAgenda = (db: { meta: { delete: (k: string) => Promise<void> } }) => db.meta.delete(KEY);
