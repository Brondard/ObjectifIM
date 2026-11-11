/**
 * Respect de l'intensité sur les flux d'une séance (arbitrage 7 et règle FC de Thomas) :
 *   - les 3 premières minutes sont écartées pour la FC (stabilisation, capteur optique à froid) ;
 *   - on juge le temps passé hors de la plage, pas la moyenne ;
 *   - alerte au-delà de 15 % du temps au-dessus du plafond.
 * Pas encore de correction de pente ni de chaleur sur l'allure : l'écran le dit.
 */
import type { Basis } from "./zones";
import type { Streams } from "./strava";

export const ANALYSIS_VERSION = 1;

/** Séances faciles : seul le dépassement du plafond compte. Les autres : les deux sens. */
export const EASY_TYPES = new Set(["endurance", "long", "recovery"]);

export type IntensityParams = { skipFirstS: number; alertPct: number };
export const DEFAULT_INTENSITY_PARAMS: IntensityParams = { skipFirstS: 180, alertPct: 15 };

/**
 * Cible de jugement. `max_end` : plafond relevé sur la fin de la séance (sortie longue : 150 bpm, puis 155
 * à partir de `end_from_pct` % du temps analysé).
 */
export type IntensityTarget = { basis: Basis; min: number | null; max: number | null; max_end?: number | null; end_from_pct?: number | null };

export type IntensityAnalysis = {
  version: number;
  basis: Basis;
  target: { min: number | null; max: number | null; max_end?: number | null; end_from_pct?: number | null };
  analysed_s: number;
  /** Temps trop intense : FC/puissance au-dessus du plafond, allure plus rapide que la borne rapide. */
  above_pct: number;
  /** Temps pas assez intense. */
  below_pct: number;
  in_pct: number;
  /** Moyenne pondérée par le temps, dans l'unité de la grandeur (bpm, W, s/km). */
  mean: number | null;
  verdict: "ok" | "too_hard" | "too_easy";
};

const MIN_SPEED_MPS = 0.5;

/** Valeur instantanée dans l'unité de la cible ; null si inutilisable (arrêt, capteur absent). */
function valueAt(streams: Streams, basis: Basis, i: number): number | null {
  switch (basis) {
    case "hr": {
      const v = (streams.heartrate as number[] | undefined)?.[i];
      return v && v > 30 ? v : null;
    }
    case "power": {
      const v = (streams.watts as number[] | undefined)?.[i];
      return v == null ? null : v;
    }
    case "pace": {
      const v = (streams.velocity_smooth as number[] | undefined)?.[i];
      return v && v > MIN_SPEED_MPS ? 1000 / v : null;
    }
    default:
      return null;
  }
}

/** Plus grand = plus intense pour FC et puissance ; pour une allure, plus petit = plus intense. */
function classify(basis: Basis, v: number, t: IntensityTarget): "above" | "below" | "in" {
  if (basis === "pace" || basis === "swim_pace") {
    if (t.min != null && v < t.min) return "above";
    if (t.max != null && v > t.max) return "below";
    return "in";
  }
  if (t.max != null && v > t.max) return "above";
  if (t.min != null && v < t.min) return "below";
  return "in";
}

export function analyzeIntensity(
  streams: Streams,
  target: IntensityTarget,
  easy: boolean,
  params: IntensityParams = DEFAULT_INTENSITY_PARAMS,
): IntensityAnalysis | null {
  const time = streams.time as number[];
  const moving = streams.moving as boolean[] | undefined;
  const skip = target.basis === "hr" ? params.skipFirstS : 0;
  let total = 0, above = 0, below = 0, weighted = 0;
  // Plafond de fin de séance : appliqué à partir d'une fraction de la durée analysée.
  const first = time.find((t) => t >= skip) ?? 0;
  const span = Math.max(1, (time.at(-1) ?? 0) - first);
  const endFrom = target.max_end != null && target.end_from_pct != null ? first + (span * target.end_from_pct) / 100 : Infinity;

  for (let i = 0; i < time.length - 1; i++) {
    if (time[i] < skip) continue;
    if (moving && moving[i] === false) continue;
    // Un trou de plus de 10 s est une pause d'enregistrement : on ne l'attribue à aucune zone.
    const dt = Math.min(time[i + 1] - time[i], 10);
    if (dt <= 0) continue;
    const v = valueAt(streams, target.basis, i);
    if (v == null) continue;
    total += dt;
    weighted += v * dt;
    const c = classify(target.basis, v, time[i] >= endFrom ? { ...target, max: target.max_end ?? target.max } : target);
    if (c === "above") above += dt;
    else if (c === "below") below += dt;
  }
  if (total < 60) return null;

  const pct = (s: number) => Math.round((s / total) * 1000) / 10;
  const above_pct = pct(above);
  const below_pct = pct(below);
  const verdict = above_pct > params.alertPct ? "too_hard" : !easy && below_pct > params.alertPct ? "too_easy" : "ok";
  return {
    version: ANALYSIS_VERSION,
    basis: target.basis,
    target: { min: target.min, max: target.max, ...(target.max_end != null ? { max_end: target.max_end, end_from_pct: target.end_from_pct } : {}) },
    analysed_s: Math.round(total),
    above_pct,
    below_pct,
    in_pct: Math.round((100 - above_pct - below_pct) * 10) / 10,
    mean: Math.round((weighted / total) * 10) / 10,
    verdict,
  };
}

/** Écart de volume réalisé / prévu (durée), en proportion ; null sans prévu. */
export function volumeDelta(plannedS: number | null, doneS: number | null): number | null {
  if (!plannedS || doneS == null) return null;
  return (doneS - plannedS) / plannedS;
}
