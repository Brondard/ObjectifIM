"use client";

import Link from "next/link";
import { CheckIn, DayNote } from "@/components/daily-log";
import { disciplineStyle } from "@/components/discipline";
import { SessionCard } from "@/components/session-card";
import { DISCIPLINES } from "@/domain/labels";
import { formatDistance, formatDuration } from "@/lib/format";
import { useCompletedBetween, usePlannedBetween } from "@/lib/sync/queries";
import { addDays, formatLocalDate, today } from "@/lib/time";

/** Écran d'accueil mobile : la séance du jour en grand, le check-in, la validation en un geste. */
export default function TodayPage() {
  const day = today();
  const planned = usePlannedBetween(day, day);
  const completed = useCompletedBetween(day, day);
  const tomorrow = addDays(day, 1);
  const next = usePlannedBetween(tomorrow, tomorrow);
  const unplanned = completed?.filter((c) => !c.planned_session_id) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-neutral-500">Aujourd&apos;hui</p>
        <h1 className="text-2xl font-semibold first-letter:uppercase">{formatLocalDate(day)}</h1>
      </header>

      <section className="flex flex-col gap-3">
        {planned === undefined ? null : planned.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
            Aucune séance prévue.
          </p>
        ) : (
          planned.map((s) => <SessionCard key={s.id} session={s} />)
        )}

        {unplanned.map((c) => (
          <div key={c.id} className={`rounded-lg border border-l-4 border-dashed border-neutral-300 p-3 text-sm dark:border-neutral-700 ${disciplineStyle(c.discipline).bar}`}>
            Imprévue · {DISCIPLINES[c.discipline as keyof typeof DISCIPLINES]} · {formatDuration(c.moving_s ?? c.elapsed_s)}
            {c.distance_m ? ` · ${formatDistance(c.distance_m, c.discipline)}` : ""}
            {c.rpe ? ` · RPE ${c.rpe}` : ""}
          </div>
        ))}

        <Link
          href={`/seance/nouvelle?date=${day}&faite=1`}
          className="self-start text-sm text-neutral-600 underline dark:text-neutral-400"
        >
          + Séance imprévue déjà faite
        </Link>
      </section>

      <CheckIn date={day} />

      {next && next.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">Demain</h2>
          {next.map((s) => (
            <Link key={s.id} href={`/seance/${s.id}`} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${disciplineStyle(s.discipline).dot}`} />
              {s.title || DISCIPLINES[s.discipline as keyof typeof DISCIPLINES]} · {formatDuration(s.target_duration_s)}
            </Link>
          ))}
        </section>
      )}

      <DayNote date={day} />
    </div>
  );
}
