"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { chainSignals, niggleSignals } from "@/domain/analysis/signals";
import { PLANNED_STATUSES } from "@/domain/labels";
import { weekReview } from "@/domain/life/review";
import { useSync } from "@/lib/sync/provider";
import { storedSessionAnalysis } from "@/lib/sync/streams";
import { addDays, formatLocalDate, isLocalDate, isoWeekday, today, weekStart, type LocalDate } from "@/lib/time";

export default function ReviewPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}

/** Revue de la semaine en une page : fait, écarts, signaux, semaine suivante. Factuelle. */
function Review() {
  const params = useSearchParams();
  const router = useRouter();
  const { db } = useSync();
  const now = today();
  // Par défaut : la semaine en cours le dimanche, la précédente les autres jours.
  const requested = params.get("w");
  const monday = requested && isLocalDate(requested) ? weekStart(requested) : weekStart(isoWeekday(now) === 7 ? now : addDays(now, -7));
  const sunday = addDays(monday, 6);

  const data = useLiveQuery(async () => {
    const [planned, next, completed, niggles, entries] = await Promise.all([
      db.planned_sessions.where("date").between(monday, sunday, true, true).toArray(),
      db.planned_sessions.where("date").between(addDays(monday, 7), addDays(monday, 13), true, true).toArray(),
      db.completed_sessions.where("local_date").between(monday, sunday, true, true).toArray(),
      db.niggles.toArray(),
      db.niggle_entries.toArray(),
    ]);
    const live = <T extends { deleted_at: string | null }>(r: T[]) => r.filter((x) => !x.deleted_at);
    return { planned: live(planned), next: live(next), completed: live(completed), niggles: live(niggles), entries: live(entries) };
  }, [db, monday]);
  if (!data) return null;

  const byId = new Map(data.planned.map((p) => [p.id, p]));
  const intensityOff = data.completed
    .map((c) => ({ c, a: storedSessionAnalysis(c)?.intensity }))
    .filter((x) => x.a && x.a.verdict !== "ok")
    .map((x) => ({ title: byId.get(x.c.planned_session_id ?? "")?.title ?? x.c.name ?? "séance", verdict: x.a!.verdict, pct: x.a!.verdict === "too_hard" ? x.a!.above_pct : x.a!.below_pct }));
  const signals = [
    ...chainSignals(data.planned.filter((p) => p.status !== "planned" || p.date >= now).map((p) => ({ ...p, done: p.status !== "planned" }))),
    ...niggleSignals(data.niggles, data.entries, sunday),
  ].map((s) => s.message);
  const r = weekReview({ weekStart: monday, planned: data.planned, completed: data.completed, nextWeek: data.next, intensityOff, signals });
  const fr = (d: string) => formatLocalDate(d as LocalDate, { day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        <button onClick={() => router.push(`/revue?w=${addDays(monday, -7)}`)} aria-label="Semaine précédente" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">‹</button>
        <h1 className="text-center font-semibold">Revue du {fr(monday)} au {fr(sunday)}</h1>
        <button onClick={() => router.push(`/revue?w=${addDays(monday, 7)}`)} aria-label="Semaine suivante" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">›</button>
      </header>
      <ul className="flex flex-col gap-1 text-base">{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>

      {r.keys.length > 0 && (
        <section className="text-sm">
          <h2 className="font-medium">Séances clés</h2>
          <ul>{r.keys.map((k, i) => <li key={i}>{k.title} : {PLANNED_STATUSES[k.status as keyof typeof PLANNED_STATUSES] ?? k.status}</li>)}</ul>
        </section>
      )}
      {r.skipped.length > 0 && (
        <section className="text-sm">
          <h2 className="font-medium">Manquées</h2>
          <ul>{r.skipped.map((s, i) => <li key={i}>{s.title} : {PLANNED_STATUSES[s.status as keyof typeof PLANNED_STATUSES]}{s.note ? ` (${s.note})` : ""}</li>)}</ul>
        </section>
      )}
      {r.intensityOff.length > 0 && (
        <section className="text-sm">
          <h2 className="font-medium">Hors consigne d&apos;intensité</h2>
          <ul>{r.intensityOff.map((x, i) => <li key={i} className="text-red-700 dark:text-red-400">{x.verdict === "too_hard" ? "↑" : "↓"} {x.title} : {x.pct} % du temps {x.verdict === "too_hard" ? "au-dessus" : "en dessous"}</li>)}</ul>
        </section>
      )}
      {r.signals.length > 0 && (
        <section className="text-sm">
          <h2 className="font-medium">Signaux</h2>
          <ul>{r.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
      )}
      <nav className="flex gap-3 text-sm underline">
        <Link href={`/semaine?d=${addDays(monday, 7)}`}>Semaine suivante</Link>
        <Link href="/analyse">Analyse</Link>
      </nav>
    </div>
  );
}
