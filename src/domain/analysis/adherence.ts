/**
 * Assiduité et respect du volume, semaine par semaine. Trois indicateurs distincts, jamais mélangés :
 * assiduité (séances faites), volume (durée), intensité (voir rigor.ts).
 */
import { addDays, weekStart, type LocalDate } from "@/lib/time";
import { alive, completedDuration, type CompletedLike, type PlannedLike } from "../week";

export type WeekAdherence = {
  week: string;
  planned: number;
  done: number;
  partial: number;
  skipped: { choice: number; life: number; injury: number };
  /** Séances prévues encore à venir ou non marquées : exclues du taux. */
  open: number;
  /** Faites / (prévues échues). Null sans séance échue. */
  rate: number | null;
  planned_s: number;
  done_s: number;
};

export function weeksBack(anchor: LocalDate, count: number): string[] {
  const start = weekStart(anchor);
  return Array.from({ length: count }, (_, i) => addDays(start, -7 * (count - 1 - i)));
}

/** Assiduité par semaine (lundi), sur les séances prévues échues au jour `today`. */
export function adherenceByWeek(planned: PlannedLike[], completed: CompletedLike[], weeks: string[], today: string, discipline?: string): WeekAdherence[] {
  return weeks.map((w) => {
    const end = addDays(w as LocalDate, 6);
    const inWeek = alive(planned).filter((p) => p.date >= w && p.date <= end && (!discipline || p.discipline === discipline));
    const due = inWeek.filter((p) => p.date < today || p.status !== "planned");
    const count = (status: string) => inWeek.filter((p) => p.status === status).length;
    const done = count("completed");
    const partial = count("partial");
    const doneS = alive(completed)
      .filter((c) => c.local_date >= w && c.local_date <= end && (!discipline || c.discipline === discipline))
      .reduce((a, c) => a + completedDuration(c), 0);
    return {
      week: w,
      planned: inWeek.length,
      done,
      partial,
      skipped: { choice: count("skipped_choice"), life: count("skipped_life"), injury: count("skipped_injury") },
      open: inWeek.length - due.length,
      rate: due.length ? Math.round(((done + partial) / due.length) * 100) / 100 : null,
      planned_s: inWeek.reduce((a, p) => a + (p.target_duration_s ?? 0), 0),
      done_s: doneS,
    };
  });
}

/** Raisons des séances manquées sur la période, pour distinguer choix, vie et blessure. */
export function skipReasons(rows: WeekAdherence[]) {
  return rows.reduce(
    (a, r) => ({ choice: a.choice + r.skipped.choice, life: a.life + r.skipped.life, injury: a.injury + r.skipped.injury }),
    { choice: 0, life: 0, injury: 0 },
  );
}
