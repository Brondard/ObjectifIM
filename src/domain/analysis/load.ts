/**
 * Charge d'entraînement (Foster) : charge de séance = RPE × minutes.
 * Sans RPE saisi, RPE estimé selon le type de la séance prévue rattachée, sinon une valeur par défaut :
 * la part estimée est toujours rendue visible.
 */
import { addDays, type LocalDate } from "@/lib/time";
import { alive, completedDuration, type CompletedLike } from "../week";

export type LoadInput = CompletedLike & { rpe: number | null; relative_effort?: number | null; session_type?: string | null };

export type LoadParams = { defaultRpe: number; rpeByType: Record<string, number> };

export function sessionLoad(c: LoadInput, p: LoadParams): { load: number; estimated: boolean } {
  const minutes = completedDuration(c) / 60;
  if (c.rpe != null) return { load: c.rpe * minutes, estimated: false };
  const rpe = (c.session_type && p.rpeByType[c.session_type]) || p.defaultRpe;
  return { load: rpe * minutes, estimated: true };
}

/** Charge par jour, du premier au dernier jour inclus. */
export function dailyLoads(sessions: LoadInput[], from: string, to: string, p: LoadParams) {
  const days: { date: string; load: number; estimated: number }[] = [];
  for (let d = from; d <= to; d = addDays(d as LocalDate, 1)) days.push({ date: d, load: 0, estimated: 0 });
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const c of alive(sessions)) {
    const i = index.get(c.local_date);
    if (i === undefined) continue;
    const l = sessionLoad(c, p);
    days[i].load += l.load;
    if (l.estimated) days[i].estimated += l.load;
  }
  return days;
}

/**
 * Ratio aigu / chronique, jour par jour : charge des 7 derniers jours rapportée à la moyenne
 * hebdomadaire des 28 derniers jours. Null tant que 28 jours d'historique ne sont pas disponibles.
 */
export function acwrSeries(days: { date: string; load: number }[]) {
  return days.map((d, i) => {
    if (i < 27) return { date: d.date, acwr: null as number | null };
    const sum = (n: number) => days.slice(i - n + 1, i + 1).reduce((a, x) => a + x.load, 0);
    const chronic = sum(28) / 4;
    return { date: d.date, acwr: chronic > 0 ? Math.round((sum(7) / chronic) * 100) / 100 : null };
  });
}

/**
 * Indices de Foster sur une semaine : monotonie = moyenne / écart-type des charges quotidiennes
 * (jours de repos compris), contrainte = charge hebdomadaire × monotonie. Une semaine trop uniforme
 * (monotonie > 2) est un facteur de risque.
 */
export function foster(week: { load: number }[]) {
  const loads = week.map((d) => d.load);
  const total = loads.reduce((a, b) => a + b, 0);
  const mean = total / loads.length;
  const sd = Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length);
  const monotony = sd > 0 ? Math.round((mean / sd) * 100) / 100 : null;
  return { load: Math.round(total), monotony, strain: monotony == null ? null : Math.round(total * monotony) };
}
