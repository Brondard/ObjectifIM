"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useEffect, useState } from "react";
import { agendaConflicts, isAllowedCalendarUrl } from "@/domain/life/agenda";
import { daylightNote, wakeTime, yearAgo } from "@/domain/life/day";
import { formatDuration } from "@/lib/format";
import type { PlannedSession } from "@/lib/sync/db";
import { invalidateAgenda, useAgenda } from "@/lib/sync/agenda";
import { useSync, useSyncStatus } from "@/lib/sync/provider";
import { addDays, formatLocalDate, localTimeOf, today, type LocalDate } from "@/lib/time";

/** Séances prévues en conflit avec l'agenda personnel, avec un raccourci vers la replanification. */
export function AgendaConflicts({ sessions }: { sessions: PlannedSession[] }) {
  const events = useAgenda();
  if (!events?.length) return null;
  const conflicts = agendaConflicts(sessions.filter((s) => s.date >= today()), events);
  if (!conflicts.length) return null;
  const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric" });
  return (
    <ul className="flex flex-col gap-1">
      {conflicts.map((c) => (
        <li key={`${c.session.id}-${c.event.uid}`} className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {c.kind === "overlap"
            ? `Agenda : « ${c.event.summary} » ${localTimeOf(c.event.start).slice(0, 5)}–${localTimeOf(c.event.end).slice(0, 5)} chevauche « ${c.session.title ?? c.session.session_type} » ${fr(c.session.date)} à ${c.session.local_time?.slice(0, 5)}.`
            : `Agenda : « ${c.event.summary} » occupe ${fr(c.session.date)}, jour de « ${c.session.title ?? c.session.session_type} ».`}{" "}
          <Link href={`/replanifier?kind=move&session=${c.session.id}`} className="underline">Replanifier</Link>
        </li>
      ))}
    </ul>
  );
}

function usePlace() {
  const { db } = useSync();
  return useLiveQuery(async () => {
    const [weather, wake] = await Promise.all([
      db.engine_rules.where("rule_key").equals("weather").toArray(),
      db.engine_rules.where("rule_key").equals("wake").toArray(),
    ]);
    const w = (weather.find((r) => !r.deleted_at)?.params ?? {}) as { home_lat?: number; home_lng?: number };
    const k = (wake.find((r) => !r.deleted_at)?.params ?? {}) as { prep_min?: number; morning_before?: string };
    return { lat: w.home_lat ?? 43.6416, lng: w.home_lng ?? 7.0089, prep: k.prep_min ?? 30, morningBefore: k.morning_before ?? "10:00" };
  }, [db]);
}

/** Heure de lever pour une séance matinale (préparation + trajet vers le lieu). */
export function WakeLine({ session }: { session: PlannedSession }) {
  const { db } = useSync();
  const place = usePlace();
  const venue = useLiveQuery(async () => (session.venue_id ? (await db.venues.get(session.venue_id)) ?? null : null), [db, session.venue_id]);
  if (!place || venue === undefined || !session.local_time || session.local_time.slice(0, 5) >= place.morningBefore) return null;
  const travel = venue?.travel_min ?? 0;
  return (
    <p className="text-sm text-neutral-600 dark:text-neutral-400">
      Lever {wakeTime(session.local_time.slice(0, 5), place.prep, travel)} (préparation {place.prep} min{travel ? `, trajet ${travel} min` : ""})
    </p>
  );
}

/** Séance qui commence avant le lever du soleil ou finit après son coucher : lampe et gilet. */
export function DaylightLine({ session }: { session: PlannedSession }) {
  const place = usePlace();
  if (!place || !session.local_time || session.indoor || !["run", "bike"].includes(session.discipline)) return null;
  const n = daylightNote(session.date, session.local_time.slice(0, 5), session.target_duration_s ?? 3600, place.lat, place.lng);
  if (!n || (!n.darkAtStart && !n.darkAtEnd)) return null;
  return (
    <p className="text-sm text-amber-700 dark:text-amber-400">
      {n.darkAtEnd ? `Coucher du soleil ${n.sunset}, fin prévue ${n.end} : fin de nuit, lampe et vêtement visible.` : `Lever du soleil ${n.sunrise} : départ de nuit, lampe et vêtement visible.`}
    </p>
  );
}

/** Ce que je faisais la même semaine l'an dernier. */
export function YearAgo() {
  const { db } = useSync();
  const day = today();
  const data = useLiveQuery(async () => (await db.completed_sessions.where("local_date").between(addDays(day, -372), day, true, true).toArray()), [db, day]);
  if (!data) return null;
  const r = yearAgo(day, data);
  if (!r.hasHistory || !r.thenSessions) return null;
  return (
    <section className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
      <p className="font-medium">Il y a un an</p>
      <p>
        Semaine du {formatLocalDate(r.weekStart as LocalDate, { day: "numeric", month: "long", year: "numeric" })} : {formatDuration(r.thenSeconds)} en {r.thenSessions} séance(s).
        Cette semaine, à ce jour : {formatDuration(r.nowSeconds)}.
      </p>
      {r.onThatDay.length > 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">Ce jour-là : {r.onThatDay.map((c) => `${c.name ?? c.discipline} (${formatDuration(c.moving_s ?? c.elapsed_s)})`).join(", ")}.</p>
      )}
    </section>
  );
}

/** Brancher l'agenda personnel en lecture seule, par son adresse secrète iCal. */
export function AgendaSettings() {
  const engine = useSync();
  const { online } = useSyncStatus();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    void engine.supabase.rpc("calendar_connected").then(({ data }) => setConnected(Boolean(data)));
  }, [engine, online]);

  async function save(value: string) {
    if (value && !isAllowedCalendarUrl(value)) return setError("Colle l'« adresse secrète au format iCal » de Google Agenda (https://calendar.google.com/calendar/ical/…/basic.ics).");
    setError(null);
    const { error: e } = await engine.supabase.rpc("calendar_set_url", { p_url: value });
    if (e) return setError(e.message);
    setConnected(Boolean(value));
    setUrl("");
    await invalidateAgenda(engine.db);
  }

  if (!online) return <p className="text-sm text-neutral-500">Agenda : réglage disponible avec du réseau.</p>;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <h3 className="font-medium">Agenda personnel (lecture seule)</h3>
      <p className="text-neutral-500">
        Pour signaler un événement qui chevauche une séance. Google Agenda → Paramètres de l&apos;agenda → « Adresse secrète au format iCal ».
        L&apos;adresse reste sur le serveur ; l&apos;app ne garde que les créneaux occupés.
      </p>
      {connected ? (
        <div className="flex gap-3">
          <span>Agenda branché.</span>
          <button onClick={() => void save("")} className="text-neutral-500 underline">Débrancher</button>
        </div>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void save(url.trim()); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className="h-10 flex-1 rounded border border-neutral-300 bg-transparent px-2 dark:border-neutral-700" />
          <button className="rounded-md bg-foreground px-3 text-background">Brancher</button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </section>
  );
}
