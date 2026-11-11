/**
 * Records personnels : meilleurs efforts sur les flux (temps le plus court sur une distance, puissance
 * moyenne la plus haute sur une durée) et progression dans le temps. Fonctions pures.
 */
import type { Streams } from "../strava";

export const RUN_DISTANCES = [1000, 5000, 10000, 21097, 42195] as const;
export const BIKE_POWER_S = [300, 1200, 3600] as const;

/** Temps le plus court (s) pour couvrir `distance` mètres d'un seul tenant (deux index glissants). */
export function bestEffortTime(s: Streams, distance: number): number | null {
  const d = s.distance as number[] | undefined;
  const t = s.time as number[];
  if (!d || d.length < 2 || d.at(-1)! < distance) return null;
  let best = Infinity;
  let j = 0;
  for (let i = 0; i < d.length; i++) {
    while (j < d.length && d[j] - d[i] < distance) j++;
    if (j >= d.length) break;
    // Interpolation sur le dernier pas pour ne pas compter la distance en trop.
    const over = d[j] - d[i] - distance;
    const step = d[j] - d[j - 1];
    const dt = t[j] - t[i] - (step > 0 ? (over / step) * (t[j] - t[j - 1]) : 0);
    if (dt > 0 && dt < best) best = dt;
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

/** Puissance moyenne maximale (W) sur une fenêtre de `seconds`. */
export function bestPower(s: Streams, seconds: number): number | null {
  const w = s.watts as number[] | undefined;
  const t = s.time as number[];
  if (!w || t.length < 2 || t.at(-1)! - t[0] < seconds) return null;
  let best = -Infinity;
  let j = 0;
  let energy = 0;
  // Énergie cumulée par pas (le dernier point n'a pas de durée).
  const e = t.slice(0, -1).map((_, i) => (w[i] ?? 0) * Math.min(t[i + 1] - t[i], 10));
  for (let i = 0; i < e.length; i++) {
    while (j < e.length && t[j] - t[i] < seconds) energy += e[j++];
    if (t[j] - t[i] < seconds) break;
    best = Math.max(best, energy / (t[j] - t[i]));
    energy -= e[i];
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

export type BestEfforts = { run?: Partial<Record<(typeof RUN_DISTANCES)[number], number>>; power?: Partial<Record<(typeof BIKE_POWER_S)[number], number>> };

export function bestEfforts(s: Streams, discipline: string): BestEfforts {
  if (discipline === "run") {
    const run: BestEfforts["run"] = {};
    for (const d of RUN_DISTANCES) {
      const v = bestEffortTime(s, d);
      if (v) run[d] = v;
    }
    return { run };
  }
  if (discipline === "bike") {
    const power: BestEfforts["power"] = {};
    for (const sec of BIKE_POWER_S) {
      const v = bestPower(s, sec);
      if (v) power[sec] = v;
    }
    return { power };
  }
  return {};
}

export type RecordEntry = { date: string; value: number; source_id: string };
export type RecordLine = { key: string; best: RecordEntry; history: RecordEntry[] };

/**
 * Pour chaque épreuve : le record actuel et ses améliorations successives dans le temps.
 * `lowerIsBetter` : temps (course) ; sinon puissance (vélo).
 */
export function recordLines(entries: { key: string; date: string; value: number; source_id: string }[], lowerIsBetter: (key: string) => boolean): RecordLine[] {
  const byKey = new Map<string, RecordEntry[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), { date: e.date, value: e.value, source_id: e.source_id }]);
  return [...byKey.entries()].map(([key, list]) => {
    const better = (a: number, b: number) => (lowerIsBetter(key) ? a < b : a > b);
    const history: RecordEntry[] = [];
    for (const e of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      if (!history.length || better(e.value, history.at(-1)!.value)) history.push(e);
    }
    return { key, best: history.at(-1)!, history };
  });
}
