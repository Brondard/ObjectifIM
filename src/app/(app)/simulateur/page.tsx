"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";
import { Field, inputClass } from "@/components/session-form";
import { simulateGap } from "@/domain/life/day";
import { DISCIPLINES } from "@/domain/labels";
import { formatDuration } from "@/lib/format";
import { useSync } from "@/lib/sync/provider";
import { addDays, formatLocalDate, today, weekStart, type LocalDate } from "@/lib/time";

const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "short", day: "numeric", month: "long" });

/** « Si je manque les N prochaines semaines, où est-ce que ça me laisse ? » Simulation, rien n'est modifié. */
export default function SimulatorPage() {
  const { db } = useSync();
  const [from, setFrom] = useState<string>(addDays(weekStart(today()), 7));
  const [weeks, setWeeks] = useState(2);
  const data = useLiveQuery(async () => {
    const [planned, done, races, rules] = await Promise.all([
      db.planned_sessions.where("date").between(from, addDays(from as LocalDate, 7 * weeks + 7), true, true).toArray(),
      db.completed_sessions.where("local_date").between(addDays(from as LocalDate, -35), from, true, true).toArray(),
      db.races.toArray(),
      db.engine_rules.where("rule_key").equals("max_weekly_volume_increase").toArray(),
    ]);
    const race = races.filter((r) => !r.deleted_at && r.priority === "A" && r.date > from).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const pct = Number((rules.find((r) => !r.deleted_at)?.params as { pct?: number } | undefined)?.pct ?? 10);
    return { planned, done, race, pct };
  }, [db, from, weeks]);
  if (!data) return null;
  const r = simulateGap({ from, weeks, planned: data.planned, done: data.done, raceDate: data.race?.date ?? null, increasePct: data.pct });
  const over = r.returnPlannedSeconds > r.returnAllowedSeconds && r.returnAllowedSeconds > 0;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Simulateur</h1>
      <p className="text-sm text-neutral-500">Que se passe-t-il si je ne m&apos;entraîne pas pendant quelques semaines ? Simulation seulement : le plan n&apos;est pas modifié.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="À partir du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="Pendant (semaines)">
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={inputClass}>
            {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>

      <section className="flex flex-col gap-2 text-sm">
        <p className="text-base">
          Du {fr(r.from)} au {fr(r.to)} : {r.lostSessions} séance(s) prévue(s) perdue(s), {formatDuration(r.lostSeconds)} de volume,
          dont {r.lostKey.length} séance(s) clé(s).
        </p>
        {Object.keys(r.byDiscipline).length > 0 && (
          <ul className="text-neutral-600 dark:text-neutral-400">
            {Object.entries(r.byDiscipline).map(([d, s]) => <li key={d}>{DISCIPLINES[d as keyof typeof DISCIPLINES] ?? d} : {formatDuration(s)}</li>)}
          </ul>
        )}
        <p>
          Reprise la semaine du {fr(r.returnWeek)} : {formatDuration(r.returnPlannedSeconds)} prévues.
          {r.returnAllowedSeconds > 0 ? (
            <> La règle des +{data.pct} % (moyenne des 4 dernières semaines réalisées, coupure comprise) autoriserait <strong>{formatDuration(r.returnAllowedSeconds)}</strong>.</>
          ) : (
            <> Pas d&apos;historique réalisé avant la coupure : la règle des +{data.pct} % ne peut pas servir de repère.</>
          )}
        </p>
        {over && (
          <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Reprendre le plan tel quel dépasserait de {Math.round((r.returnPlannedSeconds / r.returnAllowedSeconds - 1) * 100)} % ce que la règle autorise : prévoir une semaine de reprise allégée.
          </p>
        )}
        {data.race && r.weeksToRaceAfter != null && (
          <p>Il resterait {r.weeksToRaceAfter} semaine(s) avant {data.race.name} ({fr(data.race.date)}).</p>
        )}
      </section>
      <nav className="flex gap-3 text-sm underline">
        <Link href="/replanifier">Replanifier</Link>
        <Link href="/saison">Saison</Link>
      </nav>
    </div>
  );
}
