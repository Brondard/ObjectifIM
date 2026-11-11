/**
 * « Est-ce que je cours trop vite ? » : la réponse chiffrée, sur une période donnée.
 * Deux mesures complémentaires, jamais mélangées :
 *   1. les footings prévus faciles : part de ceux jugés trop intenses (règle FC : > 15 % du temps
 *      au-dessus du plafond, 3 premières minutes écartées) ;
 *   2. tout le temps de course : répartition par zone de FC, prévu ou non.
 */
import { EASY_TYPES, type IntensityAnalysis } from "../intensity";
import type { BestEfforts } from "../life/records";

export type SessionAnalysis = {
  version: 3;
  intensity: IntensityAnalysis | null;
  zones: {
    basis: string;
    method: string;
    seconds: number[];
    outside: number;
    bounds: { zone: number; min: number | null; max: number | null }[];
    /** Zones calculées avec des repères postérieurs à la séance (aucun n'était valable à sa date). */
    approx: boolean;
  } | null;
  drift: { pct: number; analysed_s: number; mode: "pace" | "power" } | null;
  cadence: { early: number; late: number; drop_pct: number } | null;
  blocks: { index: number; target_min: number; target_max: number; actual: number; delta_s: number }[] | null;
  /** Sortie de course non planifiée, comparée au plafond de footing : information, jamais un verdict. */
  unplanned_easy?: IntensityAnalysis | null;
  /** Empreinte des repères, zones et règles utilisés : si elle change, l'analyse est recalculée. */
  ctx_key: string;
  /** Meilleurs efforts de la séance (records) : temps par distance en course, puissance par durée à vélo. */
  best: BestEfforts;
};

export const SESSION_ANALYSIS_VERSION = 3;

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
  /** Part du temps de course par zone de FC (Z1…Zn), en %. Information, pas un verdict. */
  zoneShares: number[] | null;
  /** Sorties non planifiées : part du temps au-dessus du plafond de footing (information seulement). */
  unplannedAnalysed: number;
  unplannedAbovePct: number | null;
  /** Verdict uniquement sur les footings prévus et analysés ; sinon « pas encore de données ». */
  sentence: string;
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export const RIGOR_NO_DATA = "Pas encore de données : aucun footing prévu n'a été analysé sur la période (il faut une séance planifiée rattachée, des flux et une FC fiable).";

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

  // Sorties sans séance prévue : pondérées par le temps analysé, jamais mêlées au verdict.
  const unplanned = rows.filter((r) => r.discipline === "run" && !r.planned_type && r.analysis?.unplanned_easy);
  const uTotal = unplanned.reduce((a, r) => a + r.analysis!.unplanned_easy!.analysed_s, 0);
  const uAbove = unplanned.reduce((a, r) => a + (r.analysis!.unplanned_easy!.analysed_s * r.analysis!.unplanned_easy!.above_pct) / 100, 0);

  const sentence = easy.length
    ? `Sur les ${weeks} dernières semaines, ${pct(tooHard, easy.length)} % de tes footings prévus (${tooHard} sur ${easy.length}) ont dépassé leur plafond plus de 15 % du temps.`
    : RIGOR_NO_DATA;

  return {
    easyAnalysed: easy.length,
    easyTooHard: tooHard,
    easyTooHardPct: pct(tooHard, easy.length),
    meanAboveCeilingPct: meanAbove,
    runSeconds,
    zoneShares,
    unplannedAnalysed: unplanned.length,
    unplannedAbovePct: uTotal ? Math.round((uAbove / uTotal) * 100) : null,
    sentence,
  };
}
