"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { disciplineStyle } from "@/components/discipline";
import { isDone, isSkipped, volumes } from "@/domain/week";
import { formatDuration } from "@/lib/format";
import { useCompletedBetween, usePlannedBetween } from "@/lib/sync/queries";
import { addDays, formatLocalDate, isLocalDate, localDate, today, weekStart, type LocalDate } from "@/lib/time";

export default function MonthPage() {
  return (
    <Suspense>
      <Month />
    </Suspense>
  );
}

/** Vue Mois : grille des semaines, séances par jour, prévu contre réalisé par semaine. */
function Month() {
  const params = useSearchParams();
  const router = useRouter();
  const now = today();
  const m = params.get("m");
  const first = localDate(`${m && /^\d{4}-\d{2}$/.test(m) && isLocalDate(`${m}-01`) ? m : now.slice(0, 7)}-01`);
  const nextMonth = localDate(`${addDays(first, 32).slice(0, 7)}-01`);
  const prevMonth = localDate(`${addDays(first, -1).slice(0, 7)}-01`);
  const gridStart = weekStart(first);
  const gridEnd = addDays(weekStart(addDays(nextMonth, -1)), 6);
  const planned = usePlannedBetween(gridStart, gridEnd);
  const completed = useCompletedBetween(gridStart, gridEnd);

  const weeks: LocalDate[] = [];
  for (let w = gridStart; w <= gridEnd; w = addDays(w, 7)) weeks.push(w);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <button onClick={() => router.push(`/mois?m=${prevMonth.slice(0, 7)}`)} aria-label="Mois précédent" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">‹</button>
        <h1 className="font-semibold first-letter:uppercase">{formatLocalDate(first, { month: "long", year: "numeric" })}</h1>
        <button onClick={() => router.push(`/mois?m=${nextMonth.slice(0, 7)}`)} aria-label="Mois suivant" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">›</button>
      </header>
      <nav className="flex gap-3 text-sm underline"><Link href="/semaine">Semaine</Link><Link href="/saison">Saison</Link></nav>

      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_auto] gap-px text-xs">
        {["L", "M", "M", "J", "V", "S", "D", "Sem."].map((d, i) => <div key={i} className="py-1 text-center text-neutral-500">{d}</div>)}
        {weeks.map((w) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
          const v = volumes(planned?.filter((p) => p.date >= w && p.date <= days[6]) ?? [], completed?.filter((c) => c.local_date >= w && c.local_date <= days[6]) ?? []).total;
          return [
            ...days.map((d) => {
              const inMonth = d >= first && d < nextMonth;
              const list = planned?.filter((p) => p.date === d) ?? [];
              return (
                <Link key={d} href={`/semaine?d=${d}`} className={`min-h-16 rounded p-1 ${inMonth ? "bg-neutral-50 dark:bg-neutral-900" : "opacity-40"} ${d === now ? "ring-1 ring-foreground" : ""}`}>
                  <span className={d === now ? "font-semibold" : "text-neutral-500"}>{Number(d.slice(8))}</span>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center gap-0.5 truncate" title={s.title ?? s.session_type}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${disciplineStyle(s.discipline).dot}`} />
                        <span className={`truncate ${isSkipped(s.status) ? "line-through opacity-60" : ""}`}>
                          {isDone(s.status) ? "✓ " : ""}{s.priority === "key" ? "●" : ""}{Math.round((s.target_duration_s ?? 0) / 60)}′
                        </span>
                      </li>
                    ))}
                  </ul>
                </Link>
              );
            }),
            <div key={`${w}-total`} className="flex min-w-14 flex-col justify-center px-1 text-right tabular-nums">
              <span>{formatDuration(v.done_s)}</span>
              <span className="text-neutral-500">/ {formatDuration(v.planned_s)}</span>
            </div>,
          ];
        })}
      </div>
      <p className="text-xs text-neutral-500">● séance clé · ✓ faite · barré : manquée. Colonne de droite : réalisé / prévu de la semaine.</p>
    </div>
  );
}
