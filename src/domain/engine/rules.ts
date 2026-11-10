/**
 * Règles du moteur : contrôles durs (jamais violés) et pénalités souples (pondérées).
 * Les paramètres et poids viennent de engine_rules ; une règle absente garde sa valeur par défaut,
 * une règle désactivée n'est pas appliquée.
 */
import { addDays, diffDays, formatLocalDate, isoWeekday, weekStart, type LocalDate } from "@/lib/time";

const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric" });
import type { EngineContext, EngineSession, RuleConfig, Violation } from "./types";

export class Rules {
  private byKey: Map<string, RuleConfig>;
  constructor(list: RuleConfig[]) {
    this.byKey = new Map(list.map((r) => [r.rule_key, r]));
  }
  on(key: string) {
    return this.byKey.get(key)?.enabled ?? true;
  }
  w(key: string, fallback = 1) {
    const r = this.byKey.get(key);
    return r ? (r.enabled ? Number(r.weight) : 0) : fallback;
  }
  p<T>(key: string, name: string, fallback: T): T {
    const v = this.byKey.get(key)?.params?.[name];
    return (v === undefined || v === null ? fallback : v) as T;
  }
}

// ─── Qualification des séances ──────────────────────────────────────────────

export const SKIPPED = new Set(["skipped_choice", "skipped_life", "skipped_injury"]);
const HARD_TYPES = new Set(["long", "tempo", "threshold", "vo2", "short_reps", "race_pace", "race"]);

export const isActive = (s: EngineSession) => !s.deleted_at && !SKIPPED.has(s.status);
export const isKey = (s: EngineSession) => s.priority === "key";
export const isHard = (s: EngineSession) => isKey(s) || HARD_TYPES.has(s.session_type);
export const isLegStrength = (s: EngineSession) => s.session_type === "strength_legs";
export const isLong = (s: EngineSession, rules: Rules) =>
  rules.p<string[]>("long_session_protected", "session_types", ["long"]).includes(s.session_type);

const PRIORITY_RANK: Record<string, number> = { key: 0, secondary: 1, optional: 2 };
export const priorityRank = (s: EngineSession) => PRIORITY_RANK[s.priority] ?? 1;

export const durationOf = (s: EngineSession) => s.target_duration_s ?? 0;

export type Schedule = Map<string, EngineSession>;

export const activeOn = (sched: Schedule, day: string) => [...sched.values()].filter((s) => isActive(s) && s.date === day);

export function weekOf(day: string): { start: string; end: string; days: string[] } {
  const start = weekStart(day as LocalDate);
  return { start, end: addDays(start, 6), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}

/** Semaine allégée : phase de récupération/affûtage, ou volume prévu nettement sous celui des 3 semaines précédentes. */
export function isDeloadWeek(ctx: EngineContext, rules: Rules, start: string): boolean {
  if (ctx.phaseType === "recovery" || ctx.phaseType === "taper") return true;
  const ratio = rules.p<number>("deload_week_not_catchup", "detect_ratio", 0.75);
  const volume = (from: string) =>
    ctx.sessions
      .filter((s) => !s.deleted_at && s.date >= from && s.date <= addDays(from as LocalDate, 6))
      .reduce((a, s) => a + durationOf(s), 0);
  const prev = [1, 2, 3].map((k) => volume(addDays(start as LocalDate, -7 * k))).filter((v) => v > 0);
  if (prev.length < 2) return false;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  return volume(start) < avg * ratio;
}

export function maxConsecutiveRunDays(ctx: EngineContext, rules: Rules): number {
  const fromPhase = ctx.phaseParams?.max_consecutive_run_days;
  if (typeof fromPhase === "number") return fromPhase;
  const byPhase = rules.p<Record<string, number>>("max_consecutive_run_days", "by_phase_type", {});
  const phaseLimit = ctx.phaseType ? byPhase[ctx.phaseType] : undefined;
  return phaseLimit ?? rules.p<number>("max_consecutive_run_days", "default", 2);
}

// ─── Contrôles durs pour placer une séance un jour donné ────────────────────

export type PlacementInput = {
  sched: Schedule;
  session: EngineSession;
  day: string;
  ctx: EngineContext;
  rules: Rules;
  blocked: Set<string>;
  /** Placer une séance déjà manquée (rattrapage), plutôt qu'anticiper une indisponibilité. */
  catchup: boolean;
  catchupsUsed: number;
};

export function placementViolations(x: PlacementInput): Violation[] {
  const { sched, session: s, day, ctx, rules } = x;
  const v: Violation[] = [];
  const week = weekOf(s.date);
  const others = [...sched.values()].filter((o) => o.id !== s.id && isActive(o));

  if (x.blocked.has(day) || day < ctx.today || day < week.start || day > week.end) {
    v.push({ rule: "calendar", label: "Calendrier", detail: "jour indisponible, passé ou hors de la semaine" });
    return v;
  }
  if (rules.on("a_race_week_frozen") && ctx.aRaceDates.some((d) => weekOf(d).start === week.start)) {
    v.push({ rule: "a_race_week_frozen", label: "Semaine de course A", detail: "aucune séance n'est déplacée dans la semaine d'une course A" });
  }
  if (rules.on("min_gap_key_same_discipline") && isKey(s)) {
    const minDays = Math.ceil(rules.p<number>("min_gap_key_same_discipline", "hours", 48) / 24);
    const clash = others.find((o) => isKey(o) && o.discipline === s.discipline && Math.abs(diffDays(o.date as LocalDate, day as LocalDate)) < minDays);
    if (clash) v.push({ rule: "min_gap_key_same_discipline", label: "48 h entre séances clés", detail: `trop près de « ${clash.title ?? clash.session_type} » (${fr(clash.date)})` });
  }
  if (rules.on("no_leg_strength_before_key")) {
    const sameOrBefore = (legDay: string, keyDay: string) => {
      const d = diffDays(keyDay as LocalDate, legDay as LocalDate);
      return d === 0 || d === 1;
    };
    if (isLegStrength(s)) {
      const key = others.find((o) => isKey(o) && sameOrBefore(day, o.date));
      if (key) v.push({ rule: "no_leg_strength_before_key", label: "Jambes avant séance clé", detail: `musculation des jambes dans les 24 h avant « ${key.title ?? key.session_type} »` });
      const raceDays = rules.p<number>("no_leg_strength_before_key", "days_before_a_race", 10);
      const race = ctx.aRaceDates.find((r) => { const d = diffDays(r as LocalDate, day as LocalDate); return d >= 0 && d <= raceDays; });
      if (race) v.push({ rule: "no_leg_strength_before_key", label: "Jambes avant course A", detail: `moins de ${raceDays} jours avant la course du ${race}` });
    }
    if (isKey(s)) {
      const legs = others.find((o) => isLegStrength(o) && sameOrBefore(o.date, day));
      if (legs) v.push({ rule: "no_leg_strength_before_key", label: "Jambes avant séance clé", detail: `musculation des jambes ${fr(legs.date)}, moins de 24 h avant` });
    }
  }
  if (rules.on("max_consecutive_run_days") && s.discipline === "run") {
    const limit = maxConsecutiveRunDays(ctx, rules);
    const runDays = new Set([...others.filter((o) => o.discipline === "run").map((o) => o.date), day]);
    let streak = 1;
    for (let d = addDays(day as LocalDate, -1); runDays.has(d); d = addDays(d, -1)) streak++;
    for (let d = addDays(day as LocalDate, 1); runDays.has(d); d = addDays(d, 1)) streak++;
    if (streak > limit) v.push({ rule: "max_consecutive_run_days", label: "Jours de course consécutifs", detail: `${streak} jours de suite (maximum ${limit} dans cette phase)` });
  }
  if (rules.on("deload_week_not_catchup") && !isLong(s, rules) && day !== s.date && isDeloadWeek(ctx, rules, week.start)) {
    v.push({ rule: "deload_week_not_catchup", label: "Semaine allégée", detail: "une semaine allégée ne sert pas à rattraper" });
  }
  if (x.catchup && rules.on("catchup_limit")) {
    const max = rules.p<number>("catchup_limit", "max_per_week", 1);
    if (x.catchupsUsed >= max) v.push({ rule: "catchup_limit", label: "Garde-fou du rattrapage", detail: `déjà ${x.catchupsUsed} séance rattrapée cette semaine (maximum ${max})` });
  }
  return v;
}

// ─── Pénalités souples d'un plan résultant ─────────────────────────────────

export function volumeByDiscipline(sessions: EngineSession[]) {
  const out: Record<string, number> = {};
  for (const s of sessions) if (isActive(s)) out[s.discipline] = (out[s.discipline] ?? 0) + durationOf(s);
  return out;
}

const total = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);

export function softViolations(
  before: EngineSession[],
  after: EngineSession[],
  moved: { session: EngineSession; from: string; to: string }[],
  dropped: EngineSession[],
  rules: Rules,
  days: string[],
): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, label: string, detail: string, penalty: number) => {
    if (penalty > 0) v.push({ rule, label, detail, penalty: Math.round(penalty * 10) / 10 });
  };
  const volB = volumeByDiscipline(before);
  const volA = volumeByDiscipline(after);
  const tB = total(volB);
  const tA = total(volA);

  const tol = rules.p<number>("preserve_weekly_volume", "tolerance_pct", 15);
  const deltaPct = tB > 0 ? ((tA - tB) / tB) * 100 : 0;
  if (Math.abs(deltaPct) > tol) {
    add("preserve_weekly_volume", "Volume hebdomadaire", `${Math.round(deltaPct)} % (tolérance ±${tol} %)`, (rules.w("preserve_weekly_volume", 3) * (Math.abs(deltaPct) - tol)) / 5);
  }

  if (tB > 0 && tA > 0) {
    const ds = new Set([...Object.keys(volB), ...Object.keys(volA)]);
    let gap = 0;
    for (const d of ds) gap += Math.abs((volA[d] ?? 0) / tA - (volB[d] ?? 0) / tB);
    if (gap > 0.05) add("preserve_discipline_split", "Répartition entre disciplines", `écart de ${Math.round(gap * 50)} points`, rules.w("preserve_discipline_split", 2) * gap * 5);
  }

  const longWeekend = rules.p<number[]>("long_session_weekend", "weekdays", [6, 7]);
  for (const m of moved) {
    if (isLong(m.session, rules) && longWeekend.includes(isoWeekday(m.from as LocalDate)) && !longWeekend.includes(isoWeekday(m.to as LocalDate))) {
      add("long_session_weekend", "Sortie longue le week-end", `sortie longue placée ${fr(m.to)}`, rules.w("long_session_weekend", 2));
    }
    const clubDay = rules.p<number>("club_wednesday_evening", "weekday", 3);
    const isClub = /club/i.test(m.session.title ?? "") || (isoWeekday(m.from as LocalDate) === clubDay && (m.session.local_time ?? "") >= "17:00");
    if (isClub) add("club_wednesday_evening", "Club du mercredi soir", "séance de club déplacée", rules.w("club_wednesday_evening", 2));
    if (m.session.discipline === "swim" && (m.session.local_time ?? "00:00") >= "12:00") {
      add("swim_morning", "Natation le matin", `natation l'après-midi, ${fr(m.to)}`, rules.w("swim_morning", 1));
    }
    const maxDays = rules.p<number>("max_move_days", "days", 2);
    const dist = Math.abs(diffDays(m.to as LocalDate, m.from as LocalDate));
    if (dist > maxDays) add("max_move_days", "Déplacement limité", `« ${m.session.title ?? m.session.session_type} » déplacée de ${dist} jours`, rules.w("max_move_days", 1) * (dist - maxDays));
  }

  const optionalLeft = after.filter((s) => isActive(s) && s.priority === "optional" && days.includes(s.date)).length;
  const droppedImportant = dropped.filter((s) => s.priority !== "optional").length;
  if (optionalLeft && droppedImportant) {
    add("prefer_drop_optional", "Optionnelles d'abord", `${droppedImportant} séance(s) non optionnelle(s) supprimée(s) alors qu'il reste ${optionalLeft} optionnelle(s)`, rules.w("prefer_drop_optional", 2) * droppedImportant);
  }

  const perDay = (list: EngineSession[], d: string) => list.filter((s) => isActive(s) && s.date === d);
  const doubled = days.filter((d) => perDay(after, d).length >= 2 && perDay(before, d).length < 2);
  if (doubled.length) add("avoid_same_day_sessions", "Deux séances le même jour", doubled.map(fr).join(", "), rules.w("avoid_same_day_sessions", 1) * doubled.length);

  const hardDay = (list: EngineSession[], d: string) => perDay(list, d).some(isHard);
  const pairs = (list: EngineSession[]) => days.slice(0, -1).filter((d, i) => hardDay(list, d) && hardDay(list, days[i + 1])).length;
  const newPairs = pairs(after) - pairs(before);
  if (newPairs > 0) add("avoid_consecutive_hard", "Séances dures enchaînées", `${newPairs} enchaînement(s) de jours durs en plus`, rules.w("avoid_consecutive_hard", 2) * newPairs);

  return v;
}

// ─── Charge : ratio aigu / chronique ───────────────────────────────────────

const DEFAULT_RPE: Record<string, number> = {
  recovery: 2, endurance: 3, technique: 3, long: 4, tempo: 6, race_pace: 6, threshold: 7, vo2: 8,
  short_reps: 8, race: 9, strength_push: 5, strength_pull: 5, strength_legs: 6, strength_core: 4, other: 4,
};

/** Charge (RPE × minutes, Foster) : réalisée sur 4 semaines contre semaine en cours, prévu compris. */
export function acwr(ctx: EngineContext, rules: Rules, weekSessions: EngineSession[], start: string): number | null {
  const rpeByType = rules.p<Record<string, number>>("planned_rpe_by_type", "by_type", DEFAULT_RPE);
  const defaultRpe = rules.p<number>("planned_rpe_by_type", "default_done_rpe", 4);
  const doneLoad = (from: string, to: string) =>
    ctx.done
      .filter((d) => !d.deleted_at && d.local_date >= from && d.local_date <= to)
      .reduce((a, d) => a + ((d.moving_s ?? d.elapsed_s ?? 0) / 60) * (d.rpe ?? defaultRpe), 0);
  const chronicFrom = addDays(start as LocalDate, -28);
  const chronic = doneLoad(chronicFrom, addDays(start as LocalDate, -1)) / 4;
  if (chronic <= 0) return null;
  const acute =
    doneLoad(start, addDays(ctx.today as LocalDate, -1)) +
    weekSessions
      .filter((s) => isActive(s) && s.date >= ctx.today && s.status === "planned")
      .reduce((a, s) => a + (durationOf(s) / 60) * (rpeByType[s.session_type] ?? 4), 0);
  return Math.round((acute / chronic) * 100) / 100;
}

/** Volume réalisé moyen des 4 semaines précédentes (référence de la règle des +10 %). */
export function referenceVolume(ctx: EngineContext, start: string): number | null {
  const from = addDays(start as LocalDate, -28);
  const sum = ctx.done
    .filter((d) => !d.deleted_at && d.local_date >= from && d.local_date < start)
    .reduce((a, d) => a + (d.moving_s ?? d.elapsed_s ?? 0), 0);
  return sum > 0 ? sum / 4 : null;
}
