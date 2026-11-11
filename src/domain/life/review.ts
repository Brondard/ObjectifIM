/**
 * Check-in du matin (proposer la version allégée de la séance du jour) et revue hebdomadaire du dimanche.
 * Fonctions pures, ton factuel.
 */
import { isDone, isSkipped, volumes, type CompletedLike, type PlannedLike } from "../week";

export type CheckinLike = {
  sleep_quality: number | null;
  freshness: number | null;
  mood: number | null;
  motivation: number | null;
  soreness: number | null;
  hr_rest: number | null;
};

export type CheckinParams = {
  bad_count: number;
  sleep_quality_max: number;
  freshness_max: number;
  mood_max: number;
  motivation_max: number;
  soreness_min: number;
  hr_rest_above_baseline: number;
  duration_ratio: number;
};

export const DEFAULT_CHECKIN: CheckinParams = {
  bad_count: 2, sleep_quality_max: 2, freshness_max: 2, mood_max: 2, motivation_max: 2, soreness_min: 4, hr_rest_above_baseline: 7, duration_ratio: 0.6,
};

/** Médiane des FC de repos récentes : la référence pour repérer une FC de repos anormalement haute. */
export function hrRestBaseline(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (v.length < 5) return null;
  return v[Math.floor(v.length / 2)];
}

export function checkinAdvice(log: CheckinLike | null, baseline: number | null, p: CheckinParams = DEFAULT_CHECKIN) {
  if (!log) return { bad: [] as string[], lighten: false };
  const bad: string[] = [];
  if (log.sleep_quality != null && log.sleep_quality <= p.sleep_quality_max) bad.push("sommeil");
  if (log.freshness != null && log.freshness <= p.freshness_max) bad.push("fraîcheur");
  if (log.mood != null && log.mood <= p.mood_max) bad.push("humeur");
  if (log.motivation != null && log.motivation <= p.motivation_max) bad.push("motivation");
  if (log.soreness != null && log.soreness >= p.soreness_min) bad.push("courbatures");
  if (log.hr_rest != null && baseline != null && log.hr_rest >= baseline + p.hr_rest_above_baseline) bad.push(`FC de repos (+${log.hr_rest - baseline} bpm)`);
  return { bad, lighten: bad.length >= p.bad_count };
}

/** Version allégée d'une séance : durée réduite, intensité ramenée en endurance facile, plus de structure. */
export function lighterVersion(s: { session_type: string; priority: string; target_duration_s: number | null; discipline: string }, ratio: number) {
  const easyType = s.discipline === "strength" ? s.session_type : ["long", "endurance"].includes(s.session_type) ? s.session_type : "recovery";
  return {
    target_duration_s: s.target_duration_s ? Math.max(900, Math.round((s.target_duration_s * ratio) / 300) * 300) : null,
    session_type: easyType,
    priority: s.priority === "key" ? "secondary" : s.priority,
    target_intensity: s.discipline === "strength" ? null : { basis: s.discipline === "swim" ? "swim_pace" : "hr", zone: easyType === "recovery" ? 1 : 2 },
    structure: null,
  };
}

export type WeekReviewInput = {
  weekStart: string;
  planned: (PlannedLike & { title: string | null; session_type: string; priority: string })[];
  completed: CompletedLike[];
  nextWeek: (PlannedLike & { session_type: string; priority: string })[];
  intensityOff: { title: string; verdict: string; pct: number }[];
  signals: string[];
};

/** Revue de la semaine en une page : fait, écarts, signaux, semaine suivante. */
export function weekReview(i: WeekReviewInput) {
  const v = volumes(i.planned, i.completed).total;
  const next = volumes(i.nextWeek, []).total;
  const keys = i.planned.filter((p) => !p.deleted_at && p.priority === "key");
  const skipped = i.planned.filter((p) => !p.deleted_at && isSkipped(p.status));
  const delta = v.planned_s ? Math.round(((v.done_s - v.planned_s) / v.planned_s) * 100) : null;
  const h = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;
  const lines = [
    `Volume : ${h(v.done_s)} réalisées pour ${h(v.planned_s)} prévues${delta != null ? ` (${delta > 0 ? "+" : ""}${delta} %)` : ""}.`,
    `Séances : ${v.done_count}/${v.planned_count} faites${skipped.length ? `, ${skipped.length} manquée(s)` : ""}. Séances clés : ${keys.filter((k) => isDone(k.status)).length}/${keys.length}.`,
    i.intensityOff.length ? `Intensité : ${i.intensityOff.length} séance(s) hors consigne.` : "Intensité : aucune séance analysée hors consigne.",
    ...(i.signals.length ? [`Signaux : ${i.signals.length}.`] : []),
    `Semaine prochaine : ${h(next.planned_s)}, ${next.planned_count} séance(s) dont ${i.nextWeek.filter((p) => !p.deleted_at && p.priority === "key").length} clé(s).`,
  ];
  return {
    volume: v,
    delta_pct: delta,
    keys: keys.map((k) => ({ title: k.title ?? k.session_type, status: k.status })),
    skipped: skipped.map((s) => ({ title: s.title ?? s.session_type, status: s.status, note: s.skip_note ?? null })),
    intensityOff: i.intensityOff,
    signals: i.signals,
    next,
    lines,
    summary: lines.slice(0, 2).join(" "),
  };
}
