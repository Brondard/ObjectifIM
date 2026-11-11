/**
 * Construire le plan sans y passer des heures : motifs de semaine avec progression et semaine allégée,
 * modification en masse, structure de phases à rebours depuis une course. Fonctions pures.
 */
import { addDays, diffDays, isoWeekday, weekStart, type LocalDate } from "@/lib/time";
import { planMove } from "../planning";
import { BLOCK_FORMAT_VERSION, type BlockSession, type PlanBlock } from "./block";

// ─── Motifs de semaine ─────────────────────────────────────────────────────

export type PatternItem = {
  id: string;
  weekday: number; // 1 = lundi
  local_time: string | null;
  discipline: string;
  session_type: string;
  priority: string;
  duration_s: number | null;
  distance_m: number | null;
  target_intensity: unknown;
  structure: unknown;
  instructions: string | null;
  title?: string | null;
  /** Progression : +step_min toutes les every_weeks semaines de charge, plafonnée à max_min. */
  progression?: { step_min?: number; every_weeks?: number; max_min?: number } | null;
};

export type PatternOptions = {
  from: string;
  to: string;
  /** Semaine allégée toutes les N semaines (0 : jamais). */
  deloadEvery: number;
  /** Volume de la semaine allégée, en fraction (0,6 = 60 %). */
  deloadRatio: number;
};

export type PatternWeek = { start: string; deload: boolean; minutes: number };

/**
 * Séances générées par un motif sur une plage, comme un bloc importable : même aperçu, même import
 * idempotent (réappliquer remplace au lieu de doubler).
 */
export function applyPattern(items: PatternItem[], opts: PatternOptions, phase?: PlanBlock["phase"]): { block: PlanBlock; weeks: PatternWeek[] } {
  const sessions: BlockSession[] = [];
  const weeks: PatternWeek[] = [];
  const first = weekStart(opts.from as LocalDate);
  let loadWeeks = 0;
  for (let w = 0, monday: string = first; monday <= opts.to; w++, monday = addDays(monday as LocalDate, 7)) {
    const deload = opts.deloadEvery > 0 && (w + 1) % opts.deloadEvery === 0;
    let minutes = 0;
    for (const it of [...items].sort((a, b) => a.weekday - b.weekday || (a.local_time ?? "").localeCompare(b.local_time ?? ""))) {
      const date = addDays(monday as LocalDate, it.weekday - 1);
      if (date < opts.from || date > opts.to) continue;
      const p = it.progression ?? {};
      const base = (it.duration_s ?? 0) / 60;
      const steps = p.step_min ? Math.floor(loadWeeks / Math.max(1, p.every_weeks ?? 1)) : 0;
      let duration = base + steps * (p.step_min ?? 0);
      if (p.max_min) duration = Math.min(duration, p.max_min);
      if (deload) duration = Math.round((duration * opts.deloadRatio) / 5) * 5;
      if (!duration && !it.structure) continue;
      minutes += duration;
      sessions.push({
        key: `${it.id}:${date}`,
        date,
        local_time: it.local_time?.slice(0, 5) ?? undefined,
        discipline: it.discipline as BlockSession["discipline"],
        session_type: it.session_type as BlockSession["session_type"],
        priority: (deload && it.priority === "key" ? "secondary" : it.priority) as BlockSession["priority"],
        title: it.title ?? undefined,
        duration_min: duration || undefined,
        distance_m: it.distance_m && !deload ? it.distance_m : undefined,
        target_intensity: (it.target_intensity ?? undefined) as BlockSession["target_intensity"],
        structure: deload ? undefined : ((it.structure ?? undefined) as BlockSession["structure"]),
        instructions: [deload ? "Semaine allégée." : null, it.instructions].filter(Boolean).join(" ") || undefined,
      });
    }
    weeks.push({ start: monday, deload, minutes: Math.round(minutes) });
    if (!deload) loadWeeks++;
  }
  return {
    block: { format_version: BLOCK_FORMAT_VERSION, period: { start: opts.from as LocalDate, end: opts.to as LocalDate }, phase, sessions },
    weeks,
  };
}

// ─── Modification en masse ────────────────────────────────────────────────

export type BulkFilter = { from: string; to: string; disciplines?: string[]; weekdays?: number[]; sessionTypes?: string[] };
export type BulkAction =
  | { kind: "shift"; days: number }
  | { kind: "scale"; factor: number }
  | { kind: "set"; fields: { indoor?: boolean; session_type?: string; discipline?: string; priority?: string; title?: string | null } };

export type BulkSession = {
  id: string; date: string; original_date?: string | null; discipline: string; session_type: string;
  status: string; target_duration_s: number | null; target_distance_m?: number | null; deleted_at?: string | null;
};

/** Séances prévues (non réalisées) visées par le filtre. */
export function bulkTargets(sessions: BulkSession[], f: BulkFilter): BulkSession[] {
  return sessions.filter(
    (s) => !s.deleted_at && s.status === "planned" && s.date >= f.from && s.date <= f.to &&
      (!f.disciplines?.length || f.disciplines.includes(s.discipline)) &&
      (!f.weekdays?.length || f.weekdays.includes(isoWeekday(s.date as LocalDate))) &&
      (!f.sessionTypes?.length || f.sessionTypes.includes(s.session_type)),
  );
}

/** Écritures d'une modification en masse ; un décalage garde la date d'origine (comme un glisser-déposer). */
export function planBulk(targets: BulkSession[], action: BulkAction) {
  return targets.map((s) => {
    switch (action.kind) {
      case "shift":
        return { id: s.id, before: { date: s.date }, fields: planMove(s, addDays(s.date as LocalDate, action.days)) as Record<string, unknown> };
      case "scale":
        return {
          id: s.id,
          before: { target_duration_s: s.target_duration_s, target_distance_m: s.target_distance_m ?? null },
          fields: {
            target_duration_s: s.target_duration_s ? Math.round((s.target_duration_s * action.factor) / 300) * 300 : null,
            target_distance_m: s.target_distance_m ? Math.round(s.target_distance_m * action.factor) : null,
          } as Record<string, unknown>,
        };
      case "set": {
        const fields = Object.fromEntries(Object.entries(action.fields).filter(([, v]) => v !== undefined));
        return { id: s.id, before: Object.fromEntries(Object.keys(fields).map((k) => [k, (s as Record<string, unknown>)[k] ?? null])), fields };
      }
    }
  });
}

// ─── Planification à rebours ───────────────────────────────────────────────

export type PhaseDraft = { type: "base" | "build" | "specific" | "taper"; name: string; start_date: string; end_date: string; weeks: number };

/**
 * Structure de phases vide, de N semaines, terminée par la semaine de la course : base, construction,
 * spécifique, affûtage (2 semaines, 3 au-delà de 20 semaines de préparation). Semaines du lundi au dimanche.
 */
export function backwardPhases(raceDate: string, weeks: number): PhaseDraft[] {
  const n = Math.max(4, Math.round(weeks));
  const taper = n >= 20 ? 3 : 2;
  const specific = Math.max(1, Math.round(n * 0.25));
  const build = Math.max(1, Math.round(n * 0.3));
  const base = Math.max(1, n - taper - specific - build);
  const lastMonday = weekStart(raceDate as LocalDate);
  let start = addDays(lastMonday, -7 * (n - 1));
  const parts: [PhaseDraft["type"], string, number][] = [
    ["base", "Base", base], ["build", "Construction", build], ["specific", "Spécifique", specific], ["taper", "Affûtage", taper],
  ];
  return parts.map(([type, name, w]) => {
    const phase = { type, name, start_date: start, end_date: addDays(start, 7 * w - 1), weeks: w };
    start = addDays(start, 7 * w);
    return phase;
  });
}

export const weeksUntil = (from: string, raceDate: string) =>
  Math.floor(diffDays(weekStart(raceDate as LocalDate), weekStart(from as LocalDate)) / 7) + 1;
