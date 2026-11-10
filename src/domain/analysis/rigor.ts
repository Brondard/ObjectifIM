/**
 * « Est-ce que je cours trop vite ? » : la réponse chiffrée, sur une période donnée.
 * Deux mesures complémentaires, jamais mélangées :
 *   1. les footings prévus faciles : part de ceux jugés trop intenses (règle FC : > 15 % du temps
 *      au-dessus du plafond, 3 premières minutes écartées) ;
 *   2. tout le temps de course : répartition par zone de FC, prévu ou non.
 */
import { EASY_TYPES, type IntensityAnalysis } from "../intensity";

export type SessionAnalysis = {
  version: 2;
  intensity: IntensityAnalysis | null;
  zones: { basis: string; method: string; seconds: number[]; outside: number; bounds: { zone: number; min: number | null; max: number | null }[] } | null;
  drift: { pct: number; analysed_s: number; mode: "pace" | "power" } | null;
  cadence: { early: number; late: number; drop_pct: number } | null;
  blocks: { index: number; target_min: number; target_max: number; actual: number; delta_s: number }[] | null;
};

export const SESSION_ANALYSIS_VERSION = 2;

export type RigorInput = {
  local_date: string;
  discipline: string;
  /** Type de la séance prévue rattachée (null si imprévue). */
  planned_type: string | null;
  analysis: SessionAnalysis | null;
};

export type Rigor = {
  easyAnalysed: number;
  easyTooHard: number;
  easyTooHardPct: number | null;
  meanAboveCeilingPct: number | null;
  runSeconds: number;
  /** Part du temps de course par zone de FC (Z1…Zn), en %. */
  zoneShares: number[] | null;
  aboveZ2Pct: number | null;
  sentence: string;
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export function rigor(rows: RigorInput[], weeks: number): Rigor {
  const easy = rows.filter((r) => r.discipline === "run" && r.planned_type && EASY_TYPES.has(r.planned_type) && r.analysis?.intensity);
  const tooHard = easy.filter((r) => r.analysis!.intensity!.verdict === "too_hard").length;
  const meanAbove = easy.length
    ? Math.round((easy.reduce((a, r) => a + r.analysis!.intensity!.above_pct, 0) / easy.length) * 10) / 10
    : null;

  const zoned = rows.filter((r) => r.discipline === "run" && r.analysis?.zones?.basis === "hr");
  const n = Math.max(0, ...zoned.map((r) => r.analysis!.zones!.seconds.length));
  const totals = Array.from({ length: n }, (_, k) => zoned.reduce((a, r) => a + (r.analysis!.zones!.seconds[k] ?? 0), 0));
  const runSeconds = totals.reduce((a, b) => a + b, 0);
  const zoneShares = runSeconds ? totals.map((t) => Math.round((t / runSeconds) * 1000) / 10) : null;
  const aboveZ2 = runSeconds ? pct(totals.slice(2).reduce((a, b) => a + b, 0), runSeconds) : null;

  const parts: string[] = [];
  if (easy.length) parts.push(`sur les ${weeks} dernières semaines, ${pct(tooHard, easy.length)} % de tes footings faciles (${tooHard} sur ${easy.length}) ont été courus au-dessus de la zone cible`);
  if (aboveZ2 != null) parts.push(`${aboveZ2} % de ton temps de course est au-dessus de la zone 2`);
  const sentence = parts.length
    ? parts.join(" ; ").replace(/^./, (c) => c.toUpperCase()) + "."
    : "Pas encore assez de séances analysées : il faut des footings rattachés à une séance prévue, des flux et des zones de FC configurées.";

  return {
    easyAnalysed: easy.length,
    easyTooHard: tooHard,
    easyTooHardPct: pct(tooHard, easy.length),
    meanAboveCeilingPct: meanAbove,
    runSeconds,
    zoneShares,
    aboveZ2Pct: aboveZ2,
    sentence,
  };
}
