/**
 * Analyses sur les flux d'une séance : temps par zone, dérive cardiaque, décrochage de cadence,
 * respect des blocs d'allure. Fonctions pures, testées.
 */
import { flattenSteps, type SessionStructure } from "../session-structure";
import type { Streams } from "../strava";
import type { Basis, ZoneRange } from "../zones";

const nums = (s: Streams, k: keyof Streams) => s[k] as number[] | undefined;

/** Points exploitables : en mouvement, avec un pas de temps borné à 10 s (au-delà, c'est une pause). */
function* samples(s: Streams, skipFirstS = 0) {
  const moving = s.moving as boolean[] | undefined;
  for (let i = 0; i < s.time.length - 1; i++) {
    if (s.time[i] < skipFirstS) continue;
    if (moving && moving[i] === false) continue;
    const dt = Math.min(s.time[i + 1] - s.time[i], 10);
    if (dt > 0) yield { i, dt };
  }
}

/** Valeur dans l'unité de la zone : bpm, W, ou allure s/km (null à l'arrêt). */
function value(s: Streams, basis: Basis, i: number): number | null {
  if (basis === "hr") { const v = nums(s, "heartrate")?.[i]; return v && v > 30 ? v : null; }
  if (basis === "power") { const v = nums(s, "watts")?.[i]; return v ?? null; }
  if (basis === "pace") { const v = nums(s, "velocity_smooth")?.[i]; return v && v > 0.5 ? 1000 / v : null; }
  return null;
}

/** Temps passé dans chaque zone (secondes), plus le temps hors de toute zone définie. */
export function timeInZones(s: Streams, basis: Basis, zones: ZoneRange[], skipFirstS = 0) {
  const seconds = zones.map(() => 0);
  let outside = 0;
  const isPace = basis === "pace" || basis === "swim_pace";
  for (const { i, dt } of samples(s, skipFirstS)) {
    const v = value(s, basis, i);
    if (v == null) continue;
    // Pour une allure, la zone la plus intense a les plus petites valeurs : on cherche de Z5 vers Z1.
    const idx = zones.findIndex((z) => (z.min == null || v >= z.min) && (z.max == null || v < z.max));
    const fallback = isPace
      ? (zones[0].max != null && v >= zones[0].max ? 0 : -1)
      : (zones.at(-1)!.max != null && v >= zones.at(-1)!.max! ? zones.length - 1 : -1);
    const k = idx >= 0 ? idx : fallback;
    if (k >= 0) seconds[k] += dt;
    else outside += dt;
  }
  return { seconds: seconds.map(Math.round), outside: Math.round(outside) };
}

/**
 * Dérive cardiaque (découplage) : rapport vitesse/FC (ou puissance/FC) de la seconde moitié comparé à
 * la première, échauffement de 10 min écarté. Positif = la FC monte à effort égal. Sous 5 % : endurance
 * solide. Exige au moins 45 min analysables.
 */
export function cardiacDrift(s: Streams, mode: "pace" | "power", warmupS = 600) {
  const hr = nums(s, "heartrate");
  const effort = mode === "pace" ? nums(s, "velocity_smooth") : nums(s, "watts");
  if (!hr || !effort) return null;
  const pts = [...samples(s, warmupS)].filter(({ i }) => hr[i] > 30 && effort[i] > (mode === "pace" ? 0.5 : 0));
  const total = pts.reduce((a, p) => a + p.dt, 0);
  if (total < 45 * 60) return null;
  let acc = 0;
  const halves = [{ e: 0, h: 0, t: 0 }, { e: 0, h: 0, t: 0 }];
  for (const { i, dt } of pts) {
    const half = acc < total / 2 ? 0 : 1;
    halves[half].e += effort[i] * dt;
    halves[half].h += hr[i] * dt;
    halves[half].t += dt;
    acc += dt;
  }
  const ratio = (x: { e: number; h: number }) => x.e / x.h;
  const r1 = ratio(halves[0]);
  const r2 = ratio(halves[1]);
  return { pct: Math.round(((r1 - r2) / r1) * 1000) / 10, analysed_s: Math.round(total), mode };
}

/**
 * Décrochage de cadence en fin de séance longue : cadence moyenne du dernier quart comparée à celle
 * de la première moitié (échauffement écarté). Positif = la cadence baisse. Course : Strava donne des
 * pas par minute pour une jambe, d'où le ×2.
 */
export function cadenceDrop(s: Streams, discipline: string, warmupS = 600) {
  const cad = nums(s, "cadence");
  if (!cad) return null;
  const pts = [...samples(s, warmupS)].filter(({ i }) => cad[i] > 20);
  const total = pts.reduce((a, p) => a + p.dt, 0);
  if (total < 45 * 60) return null;
  let acc = 0;
  const first = { c: 0, t: 0 };
  const last = { c: 0, t: 0 };
  for (const { i, dt } of pts) {
    if (acc < total / 2) { first.c += cad[i] * dt; first.t += dt; }
    else if (acc >= total * 0.75) { last.c += cad[i] * dt; last.t += dt; }
    acc += dt;
  }
  const k = discipline === "run" ? 2 : 1;
  const early = (first.c / first.t) * k;
  const late = (last.c / last.t) * k;
  return { early: Math.round(early), late: Math.round(late), drop_pct: Math.round(((early - late) / early) * 1000) / 10 };
}

export type BlockResult = { index: number; target_min: number; target_max: number; actual: number; delta_s: number };

/**
 * Respect des blocs d'allure : on suit la structure prévue sur le flux (temps ou distance cumulés)
 * et on mesure l'allure réelle de chaque bloc d'effort à cible d'allure. Approximation : suppose que la
 * séance a été faite dans l'ordre et aux durées prévues. Exige que chaque étape ait une durée ou une
 * distance ; sinon, null (l'alignement serait arbitraire).
 */
export function blockPaces(s: Streams, structure: SessionStructure): BlockResult[] | null {
  const steps = flattenSteps(structure.steps);
  if (!steps.length || steps.some((st) => st.duration_s == null && st.distance_m == null)) return null;
  const dist = nums(s, "distance");
  if (!dist) return null;
  const results: BlockResult[] = [];
  let i = 0;
  steps.forEach((st, index) => {
    const startT = s.time[i];
    const startD = dist[i];
    let j = i;
    while (j < s.time.length - 1 && (st.duration_s != null ? s.time[j] - startT < st.duration_s : dist[j] - startD < st.distance_m!)) j++;
    const intensity = st.intensity;
    if (st.kind === "work" && intensity && "min" in intensity && intensity.basis === "pace" && dist[j] > startD) {
      const actual = ((s.time[j] - startT) / (dist[j] - startD)) * 1000;
      const delta = actual < intensity.min ? actual - intensity.min : actual > intensity.max ? actual - intensity.max : 0;
      results.push({ index, target_min: intensity.min, target_max: intensity.max, actual: Math.round(actual), delta_s: Math.round(delta) });
    }
    i = j;
  });
  return results;
}
