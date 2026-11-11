/**
 * Tableaux de temps de passage pour un objectif de temps, ajustés à la pente portion par portion.
 *
 * Course à pied : coût énergétique de Minetti (2002) selon la pente, à puissance métabolique constante ;
 * le facteur est borné pour rester réaliste en descente (on ne court pas 40 % plus vite en descente).
 * Vélo : puissance constante, modèle physique simple (roulement, gravité, aérodynamique).
 */
import type { CourseProfile } from "./gpx";

/** Coût de Minetti en J/kg/m pour une pente i (fraction, ex. 0,05 pour 5 %). */
export function minettiCost(i: number): number {
  const g = Math.max(-0.45, Math.min(0.45, i));
  return 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
}

/** Multiplicateur d'allure dû à la pente, borné à [0,8 ; 3]. */
export function gradeFactor(i: number): number {
  return Math.max(0.8, Math.min(3, minettiCost(i) / minettiCost(0)));
}

export type Split = {
  /** Fin du tronçon, en mètres depuis le départ. */
  at_m: number;
  length_m: number;
  time_s: number;
  cumulative_s: number;
  grade_pct: number;
  /** Allure (s/km) en course, vitesse (km/h) à vélo. */
  pace_s_km?: number;
  speed_kmh?: number;
  /** Écart avec l'allure ou la vitesse à plat équivalente : ce qu'il faut attendre en montée et en descente. */
  delta: number;
};

type Segment = { length: number; grade: number; end: number };

function segments(profile: CourseProfile): Segment[] {
  const s = profile.samples;
  if (s.length >= 2) {
    return s.slice(1).map((b, k) => {
      const a = s[k];
      const length = b.d - a.d;
      return { length, grade: length > 0 ? (b.ele - a.ele) / length : 0, end: b.d };
    }).filter((x) => x.length > 0);
  }
  // Sans altitude : parcours plat, découpé au pas du profil.
  const out: Segment[] = [];
  for (let d = 0; d < profile.distance_m; d += profile.step_m) {
    const length = Math.min(profile.step_m, profile.distance_m - d);
    out.push({ length, grade: 0, end: d + length });
  }
  return out;
}

function groupBy(segs: (Segment & { time: number })[], every: number) {
  const groups: { end: number; length: number; time: number; climb: number }[] = [];
  for (const s of segs) {
    const idx = Math.ceil(s.end / every - 1e-9) - 1;
    const g = (groups[idx] ??= { end: 0, length: 0, time: 0, climb: 0 });
    g.end = s.end;
    g.length += s.length;
    g.time += s.time;
    g.climb += s.grade * s.length;
  }
  return groups.filter(Boolean);
}

/** Course à pied : temps de passage tous les `every_m` mètres pour un temps cible. */
export function runSplits(profile: CourseProfile, goal_s: number, every_m = 1000): { flatPace_s_km: number; splits: Split[] } {
  const segs = segments(profile);
  const weighted = segs.reduce((a, s) => a + s.length * gradeFactor(s.grade), 0);
  const p0 = goal_s / weighted; // s/m à plat
  const timed = segs.map((s) => ({ ...s, time: s.length * p0 * gradeFactor(s.grade) }));
  let cum = 0;
  const splits = groupBy(timed, every_m).map((g) => {
    cum += g.time;
    const pace = (g.time / g.length) * 1000;
    return {
      at_m: Math.round(g.end), length_m: Math.round(g.length), time_s: Math.round(g.time), cumulative_s: Math.round(cum),
      grade_pct: Math.round((g.climb / g.length) * 1000) / 10, pace_s_km: Math.round(pace), delta: Math.round(pace - p0 * 1000),
    };
  });
  return { flatPace_s_km: Math.round(p0 * 1000), splits };
}

export type BikeParams = { mass_kg: number; cda: number; crr: number; rho: number; maxSpeed_kmh: number; drivetrain: number };
export const DEFAULT_BIKE: Omit<BikeParams, "mass_kg"> = { cda: 0.3, crr: 0.004, rho: 1.2, maxSpeed_kmh: 65, drivetrain: 0.975 };

/** Vitesse (m/s) tenue à puissance P sur une pente donnée. */
export function speedAt(power: number, grade: number, p: BikeParams): number {
  const g = 9.81;
  const theta = Math.atan(grade);
  const need = (v: number) => (v * p.mass_kg * g * (p.crr * Math.cos(theta) + Math.sin(theta)) + 0.5 * p.rho * p.cda * v ** 3) / p.drivetrain;
  let lo = 0.3, hi = p.maxSpeed_kmh / 3.6;
  if (need(hi) <= power) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (need(mid) > power) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Vélo : puissance constante qui atteint le temps cible, et passages tous les `every_m` mètres. */
export function bikeSplits(profile: CourseProfile, goal_s: number, p: BikeParams, every_m = 5000): { power_w: number; flatSpeed_kmh: number; splits: Split[] } {
  const segs = segments(profile);
  const total = (power: number) => segs.reduce((a, s) => a + s.length / speedAt(power, s.grade, p), 0);
  let lo = 10, hi = 1500;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > goal_s) lo = mid; else hi = mid;
  }
  const power = (lo + hi) / 2;
  const flat = speedAt(power, 0, p) * 3.6;
  const timed = segs.map((s) => ({ ...s, time: s.length / speedAt(power, s.grade, p) }));
  let cum = 0;
  const splits = groupBy(timed, every_m).map((g) => {
    cum += g.time;
    const speed = (g.length / g.time) * 3.6;
    return {
      at_m: Math.round(g.end), length_m: Math.round(g.length), time_s: Math.round(g.time), cumulative_s: Math.round(cum),
      grade_pct: Math.round((g.climb / g.length) * 1000) / 10, speed_kmh: Math.round(speed * 10) / 10, delta: Math.round((speed - flat) * 10) / 10,
    };
  });
  return { power_w: Math.round(power), flatSpeed_kmh: Math.round(flat * 10) / 10, splits };
}

/** Plafonds de FC par tronçon, en fraction de la FC au seuil selon la part de parcours déjà faite. */
export function hrCaps(splits: Split[], lthr: number, steps: { until_pct: number; pct_lthr: number | null }[]) {
  const total = splits.at(-1)?.at_m ?? 0;
  return splits.map((s) => {
    const done = total ? (s.at_m / total) * 100 : 0;
    const rule = steps.find((r) => done <= r.until_pct) ?? steps.at(-1);
    return { at_m: s.at_m, cap_bpm: rule?.pct_lthr == null ? null : Math.round(lthr * rule.pct_lthr) };
  });
}

/** Paliers par défaut : prudence en première moitié, libre sur la fin (format long). */
export const DEFAULT_HR_STEPS = [
  { until_pct: 50, pct_lthr: 0.9 },
  { until_pct: 85, pct_lthr: 0.94 },
  { until_pct: 100, pct_lthr: null },
];
