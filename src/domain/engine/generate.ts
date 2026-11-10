/**
 * Moteur de replanification : un déclencheur → 2 ou 3 options distinctes, chacune avec son arbitrage.
 * Déterministe : mêmes entrées, mêmes options, dans le même ordre. Rien n'est appliqué ici.
 *
 * Principe : les séances « déplacées » (tombant sur des jours indisponibles, ou visées par le
 * déclencheur) sont retirées du planning, puis replacées une à une, sortie longue d'abord, puis séances
 * clés, secondaires, optionnelles, sur le jour valide le moins pénalisant. Si aucun jour n'est valide,
 * le moteur peut libérer un jour en déplaçant (option A) ou en retirant (options B, C) une ou deux
 * séances secondaires qui bloquent. On ne déplace jamais une séance hors de sa semaine.
 */
import { addDays, diffDays, formatLocalDate, type LocalDate } from "@/lib/time";
import {
  Rules, acwr, activeOn, durationOf, isActive, isKey, isLong, placementViolations, priorityRank,
  referenceVolume, softViolations, volumeByDiscipline, weekOf, SKIPPED, type Schedule,
} from "./rules";
import type { Change, EngineContext, EngineSession, Option, Proposal, Trigger, Violation } from "./types";

type DropStatus = "skipped_life" | "skipped_injury" | "skipped_choice";

type Setup = {
  ctx: EngineContext;
  rules: Rules;
  week: ReturnType<typeof weekOf>;
  blocked: Set<string>;
  base: Schedule;
  catchup: boolean;
};

const clone = (s: Schedule): Schedule => new Map([...s].map(([k, v]) => [k, { ...v }]));
const label = (s: EngineSession) => s.title ?? s.session_type;
const day = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric" });

const byImportance = (rules: Rules) => (a: EngineSession, b: EngineSession) =>
  Number(isLong(b, rules)) - Number(isLong(a, rules)) || priorityRank(a) - priorityRank(b) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** Coût d'un placement valide, pour départager les jours : doublons, enchaînements durs, distance. */
function placementCost(sched: Schedule, s: EngineSession, d: string, rules: Rules): number {
  const same = activeOn(sched, d).filter((o) => o.id !== s.id).length;
  const hardAround = [addDays(d as LocalDate, -1), addDays(d as LocalDate, 1)].filter((n) =>
    activeOn(sched, n).some((o) => o.id !== s.id && (isKey(o) || ["long", "tempo", "threshold", "vo2", "short_reps", "race_pace"].includes(o.session_type))),
  ).length;
  const hard = isKey(s) || ["long", "tempo", "threshold", "vo2", "short_reps", "race_pace"].includes(s.session_type);
  // Deux séances dures le même jour : bien pire qu'un enchaînement sur deux jours.
  const hardSameDay = hard && activeOn(sched, d).some((o) => o.id !== s.id && (isKey(o) || ["long", "tempo", "threshold", "vo2", "short_reps", "race_pace"].includes(o.session_type)));
  return (
    same * rules.w("avoid_same_day_sessions", 1) * 2 +
    (hard ? hardAround * rules.w("avoid_consecutive_hard", 2) : 0) +
    (hardSameDay ? 3 * rules.w("avoid_consecutive_hard", 2) : 0)
  );
}

type Placement = { day: string; free: EngineSession[] };

/**
 * Meilleur jour pour une séance. Sans jour valide, cherche le jour qu'on peut libérer en retirant
 * une ou deux séances secondaires ou optionnelles (jamais une clé, jamais une sortie longue).
 */
function findPlacement(sched: Schedule, s: EngineSession, x: Setup, allowFreeing: boolean, catchupsUsed: number): Placement | null {
  const origin = s.original_date ?? s.date;
  const candidates = [...x.week.days].sort(
    (a, b) =>
      placementCost(sched, s, a, x.rules) - placementCost(sched, s, b, x.rules) ||
      Math.abs(diffDays(a as LocalDate, origin as LocalDate)) - Math.abs(diffDays(b as LocalDate, origin as LocalDate)) ||
      a.localeCompare(b),
  );
  const valid = (sc: Schedule, d: string) =>
    placementViolations({ sched: sc, session: s, day: d, ctx: x.ctx, rules: x.rules, blocked: x.blocked, catchup: x.catchup, catchupsUsed }).length === 0;

  for (const d of candidates) if (valid(sched, d)) return { day: d, free: [] };
  if (!allowFreeing) return null;

  const removable = [...sched.values()]
    .filter((o) => o.id !== s.id && isActive(o) && o.status === "planned" && !isKey(o) && !isLong(o, x.rules) && o.date >= x.ctx.today && x.week.days.includes(o.date))
    .sort((a, b) => priorityRank(b) - priorityRank(a) || durationOf(a) - durationOf(b) || a.id.localeCompare(b.id));
  const subsets: EngineSession[][] = [
    ...removable.map((r) => [r]),
    ...removable.flatMap((r, i) => removable.slice(i + 1).map((q) => [r, q])),
  ];
  let best: (Placement & { cost: number }) | null = null;
  for (const d of candidates) {
    for (const subset of subsets) {
      const trial = clone(sched);
      subset.forEach((r) => trial.delete(r.id));
      if (!valid(trial, d)) continue;
      const cost = subset.reduce((a, r) => a + durationOf(r) + (r.priority === "optional" ? 0 : 3600), 0);
      if (!best || cost < best.cost) best = { day: d, free: subset, cost };
      break;
    }
  }
  return best ? { day: best.day, free: best.free } : null;
}

type Plan = { sched: Schedule; changes: Change[]; notes: string[] };

/**
 * Replace `toPlace` dans `sched`. `relocateFreed` : une séance libérée est replacée ailleurs si possible
 * (option qui garde le volume) plutôt que retirée.
 */
function placeAll(plan: Plan, toPlace: EngineSession[], x: Setup, relocateFreed: boolean, dropStatus: DropStatus, why: string) {
  let catchups = x.ctx.catchupsThisWeek;
  for (const s of [...toPlace].sort(byImportance(x.rules))) {
    const p = findPlacement(plan.sched, s, x, true, catchups);
    if (!p) {
      plan.changes.push({ kind: "drop", id: s.id, status: dropStatus, note: why });
      if (isLong(s, x.rules)) plan.notes.push(`Aucun jour valide pour la sortie longue « ${label(s)} » cette semaine : elle est perdue, pas supprimée par choix.`);
      continue;
    }
    // La séance prend sa place d'abord : les séances libérées se recasent ensuite autour d'elle.
    p.free.forEach((f) => plan.sched.delete(f.id));
    plan.sched.set(s.id, { ...s, date: p.day, status: "planned" });
    for (const f of p.free) {
      const again = relocateFreed ? findPlacement(plan.sched, f, x, false, catchups) : null;
      if (again) {
        plan.sched.set(f.id, { ...f, date: again.day });
        plan.changes.push({ kind: "move", id: f.id, from: f.date, to: again.day });
      } else {
        plan.changes.push({ kind: "drop", id: f.id, status: "skipped_choice", note: `Retirée pour faire de la place à « ${label(s)} »` });
      }
    }
    if (x.catchup) catchups++;
    plan.changes.push({ kind: "move", id: s.id, from: s.date, to: p.day, reopen: SKIPPED.has(s.status) || undefined });
  }
}

function finish(key: string, title: string, plan: Plan, x: Setup, explain: (o: Omit<Option, "explanation">) => string): Option {
  const inWeek = (sched: Schedule) => [...sched.values()].filter((s) => x.week.days.includes(s.date));
  const before = inWeek(x.base);
  const after = inWeek(plan.sched);
  const byId = new Map(before.map((s) => [s.id, s]));
  const moved = plan.changes
    .filter((c): c is Extract<Change, { kind: "move" }> => c.kind === "move" && c.from !== c.to)
    .map((c) => ({ session: byId.get(c.id)!, from: c.from, to: c.to }));
  // Seules les suppressions décidées par le moteur comptent pour « optionnelles d’abord », pas les séances perdues.
  const dropped = plan.changes
    .filter((c) => c.kind === "drop" && c.status === "skipped_choice")
    .map((c) => byId.get(c.id)!)
    .filter(Boolean);
  const soft = softViolations(before, after, moved, dropped, x.rules, x.week.days);

  const alerts: string[] = [];
  const ref = referenceVolume(x.ctx, x.week.start);
  const pct = x.rules.p<number>("max_weekly_volume_increase", "pct", 10);
  const vol = Object.values(volumeByDiscipline(after)).reduce((a, b) => a + b, 0);
  if (ref && x.rules.on("max_weekly_volume_increase") && vol > ref * (1 + pct / 100)) {
    alerts.push(`Le volume de la semaine (${Math.round(vol / 3600 * 10) / 10} h) dépasse de ${Math.round((vol / ref - 1) * 100)} % la moyenne réalisée des 4 dernières semaines (${Math.round(ref / 3600 * 10) / 10} h).`);
  }
  const acwrBefore = acwr(x.ctx, x.rules, before, x.week.start);
  const acwrAfter = acwr(x.ctx, x.rules, after, x.week.start);
  const high = x.rules.p<number>("load_ratio", "high", 1.5);
  const low = x.rules.p<number>("load_ratio", "low", 0.8);
  if (acwrAfter != null && acwrAfter > high) alerts.push(`Ratio de charge ${acwrAfter} : au-dessus de ${high}.`);
  if (acwrAfter != null && acwrAfter < low) alerts.push(`Ratio de charge ${acwrAfter} : sous ${low}.`);

  const option: Omit<Option, "explanation"> = {
    key, title,
    changes: plan.changes.filter((c) => !(c.kind === "move" && c.from === c.to && !c.reopen)),
    volumeBefore: volumeByDiscipline(before),
    volumeAfter: volumeByDiscipline(after),
    soft,
    penalty: Math.round(soft.reduce((a, s) => a + (s.penalty ?? 0), 0) * 10) / 10,
    acwrBefore, acwrAfter,
    alerts: [...alerts, ...plan.notes],
  };
  return { ...option, explanation: explain(option) };
}

// ─── Faits utiles aux explications ─────────────────────────────────────────

const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
const volumeDelta = (o: Omit<Option, "explanation">) => {
  const b = sum(o.volumeBefore);
  return b ? Math.round(((sum(o.volumeAfter) - b) / b) * 100) : 0;
};
const count = (o: Omit<Option, "explanation">, kind: Change["kind"]) => o.changes.filter((c) => c.kind === kind).length;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function denseDays(o: Omit<Option, "explanation">) {
  const v = o.soft.find((s) => s.rule === "avoid_same_day_sessions");
  return v ? ` (doubles séances : ${v.detail})` : "";
}

// ─── Déclencheurs ──────────────────────────────────────────────────────────

function setup(ctx: EngineContext, anchor: string, blocked: Set<string>, catchup: boolean): Setup {
  const rules = new Rules(ctx.rules);
  const base: Schedule = new Map(ctx.sessions.filter((s) => !s.deleted_at).map((s) => [s.id, { ...s }]));
  return { ctx, rules, week: weekOf(anchor), blocked, base, catchup };
}

const range = (from: string, days: number) => Array.from({ length: days }, (_, i) => addDays(from as LocalDate, i));

/** Séances encore à faire qui tombent sur des jours bloqués. */
function displacedBy(x: Setup, keep: (s: EngineSession) => boolean = () => true) {
  return [...x.base.values()].filter((s) => isActive(s) && s.status === "planned" && x.blocked.has(s.date) && x.week.days.includes(s.date) && keep(s));
}

function absenceOptions(x: Setup, displaced: EngineSession[], dropStatus: DropStatus, why: string, health: boolean): Option[] {
  const removed = () => {
    const sched = clone(x.base);
    displaced.forEach((s) => sched.delete(s.id));
    return { sched, changes: [] as Change[], notes: [] as string[] };
  };
  const drop = (plan: Plan, list: EngineSession[]) =>
    list.forEach((s) => plan.changes.push({ kind: "drop", id: s.id, status: dropStatus, note: why }));
  const long = displaced.filter((s) => isLong(s, x.rules));
  const keys = displaced.filter((s) => isKey(s) && !isLong(s, x.rules));
  const rest = displaced.filter((s) => !isKey(s) && !isLong(s, x.rules));
  const options: Option[] = [];

  if (health) {
    // Maladie ou blessure : on ne rattrape rien, pas même la sortie longue (la santé prime sur la règle 1).
    const gentle = removed();
    drop(gentle, displaced);
    const lastBlocked = [...x.blocked].sort().at(-1)!;
    const firstHard = [...gentle.sched.values()]
      .filter((o) => isActive(o) && o.status === "planned" && o.date > lastBlocked && x.week.days.includes(o.date) && (isKey(o) || isLong(o, x.rules)))
      .sort((m, n) => m.date.localeCompare(n.date))[0];
    if (firstHard?.target_duration_s) {
      const to = Math.round((firstHard.target_duration_s * 0.7) / 300) * 300;
      gentle.sched.set(firstHard.id, { ...firstHard, target_duration_s: to });
      gentle.changes.push({ kind: "shorten", id: firstHard.id, from_s: firstHard.target_duration_s, to_s: to });
    }
    options.push(finish("gentle_return", "Reprise douce", gentle, x, (o) =>
      firstHard
        ? `On ne rattrape rien et la première séance dure au retour, « ${label(firstHard)} », est raccourcie de 30 % : le volume baisse de ${-volumeDelta(o)} %.`
        : `On ne rattrape rien : le volume baisse de ${-volumeDelta(o)} %.`));
    const plan = removed();
    drop(plan, displaced);
    options.push(finish("resume_plan", "Reprendre le plan prévu", plan, x, (o) =>
      `On ne rattrape rien et on reprend le plan tel quel au retour : le volume baisse de ${-volumeDelta(o)} %, uniquement par les séances perdues.`));
    return options;
  }

  const a = removed();
  placeAll(a, displaced, x, true, dropStatus, why);
  options.push(finish("keep_volume", "Conserver le volume", a, x, (o) =>
    `On replace tout ce qui peut l'être (${count(o, "move")} déplacement(s), volume ${signed(volumeDelta(o))} %) : la semaine est plus dense${denseDays(o)}, la fatigue augmente.`));

  const b = removed();
  placeAll(b, [...long, ...keys], x, false, dropStatus, why);
  drop(b, rest);
  options.push(finish("protect_quality", "Protéger la qualité", b, x, (o) =>
    `On garde la sortie longue et les séances clés, on renonce à ${count(o, "drop")} séance(s) : le volume baisse de ${-volumeDelta(o)} %.`));

  const c = removed();
  placeAll(c, long, x, false, dropStatus, why);
  drop(c, [...keys, ...rest]);
  options.push(finish("accept_light", "Accepter la semaine allégée", c, x, (o) =>
    `On ne rattrape rien${long.length ? " sauf la sortie longue, qui ne se supprime pas" : ""} : le volume baisse de ${-volumeDelta(o)} %, on repart propre la semaine suivante.`));
  return options;
}

export function propose(ctx: EngineContext, trigger: Trigger): Proposal {
  const notes: string[] = [];
  let options: Option[] = [];
  let anchor = ctx.today;

  switch (trigger.kind) {
    case "unavailable": {
      anchor = trigger.from < ctx.today ? ctx.today : trigger.from;
      const days = range(trigger.from, diffDays(trigger.to as LocalDate, trigger.from as LocalDate) + 1);
      const x = setup(ctx, anchor, new Set(days), false);
      const displaced = displacedBy(x);
      if (!displaced.length) notes.push("Aucune séance prévue sur ces jours : rien à replanifier.");
      else options = absenceOptions(x, displaced, "skipped_life", trigger.reason ? `Indisponible : ${trigger.reason}` : `Indisponible du ${trigger.from} au ${trigger.to}`, false);
      if (diffDays(trigger.to as LocalDate, weekOf(anchor).end as LocalDate) > 0) notes.push("Seule la semaine en cours est replanifiée ; relance le moteur sur la suivante si besoin.");
      return finalize(ctx, trigger, x.week.start, options, notes);
    }
    case "sick": {
      anchor = trigger.from < ctx.today ? ctx.today : trigger.from;
      const days = range(trigger.from, trigger.days);
      const x = setup(ctx, anchor, new Set(days), false);
      const displaced = displacedBy(x);
      const why = trigger.injury ? "Blessure" : "Malade";
      if (!displaced.length) notes.push("Aucune séance prévue sur ces jours : rien à replanifier.");
      else options = absenceOptions(x, displaced, trigger.injury ? "skipped_injury" : "skipped_life", why, true);
      notes.push("Pendant une maladie ou une blessure, le moteur ne compresse jamais la semaine pour garder le volume.");
      return finalize(ctx, trigger, x.week.start, options, notes);
    }
    case "travel": {
      anchor = trigger.from < ctx.today ? ctx.today : trigger.from;
      const days = new Set(range(trigger.from, diffDays(trigger.to as LocalDate, trigger.from as LocalDate) + 1));
      const needsGear = (s: EngineSession) => (trigger.noBike && s.discipline === "bike") || (trigger.noPool && s.discipline === "swim");
      const x = setup(ctx, anchor, days, false);
      const displaced = displacedBy(x, needsGear);
      if (!displaced.length) {
        notes.push("Aucune séance de vélo ou de natation prévue pendant le déplacement.");
        return finalize(ctx, trigger, x.week.start, [], notes);
      }
      // A : substitutions équivalentes, avec ce qu'elles font perdre.
      const sub: Plan = { sched: clone(x.base), changes: [], notes: [] };
      for (const s of displaced) {
        const rule = ctx.substitutions.find((r) => r.from_discipline === s.discipline && (!r.from_session_type || r.from_session_type === s.session_type))
          ?? ctx.substitutions.find((r) => r.from_discipline === s.discipline);
        if (!rule) {
          sub.changes.push({ kind: "drop", id: s.id, status: "skipped_life", note: "Déplacement : pas de substitution" });
          sub.sched.delete(s.id);
          continue;
        }
        const duration = s.target_duration_s ? Math.round((s.target_duration_s * rule.duration_ratio) / 60) * 60 : null;
        sub.sched.set(s.id, { ...s, discipline: rule.to_discipline, session_type: rule.to_session_type, target_duration_s: duration });
        sub.changes.push({ kind: "substitute", id: s.id, to_discipline: rule.to_discipline, to_session_type: rule.to_session_type, label: rule.to_label, duration_s: duration, loss: rule.loss_note });
      }
      const optSub = finish("substitute", "Substituer sur place", sub, x, (o) =>
        `On remplace ${count(o, "substitute")} séance(s) par un équivalent faisable sans matériel ; ce qu'on perd est indiqué pour chacune.`);
      // B et C : comme une indisponibilité, limitée aux séances qui demandent le matériel absent.
      const [keep, , light] = absenceOptions(x, displaced, "skipped_life", "Déplacement sans matériel", false);
      options = [optSub, { ...keep, key: "move_out", title: "Décaler hors du déplacement" }, light];
      return finalize(ctx, trigger, x.week.start, options, notes);
    }
    case "move": {
      const s = ctx.sessions.find((o) => o.id === trigger.sessionId);
      if (!s) return finalize(ctx, trigger, weekOf(ctx.today).start, [], ["Séance introuvable."]);
      const x = setup(ctx, s.date, new Set([s.date]), false);
      const without = clone(x.base);
      without.delete(s.id);
      const days = x.week.days
        .filter((d) => placementViolations({ sched: without, session: s, day: d, ctx, rules: x.rules, blocked: x.blocked, catchup: false, catchupsUsed: 0 }).length === 0)
        .sort((a, b) =>
          Number(b === trigger.to) - Number(a === trigger.to) ||
          placementCost(without, s, a, x.rules) - placementCost(without, s, b, x.rules) ||
          Math.abs(diffDays(a as LocalDate, s.date as LocalDate)) - Math.abs(diffDays(b as LocalDate, s.date as LocalDate)) ||
          a.localeCompare(b));
      if (trigger.to && !days.includes(trigger.to)) {
        const why = placementViolations({ sched: without, session: s, day: trigger.to, ctx, rules: x.rules, blocked: x.blocked, catchup: false, catchupsUsed: 0 });
        notes.push(`Impossible le ${day(trigger.to)} : ${why.map((v) => v.detail).join(" ; ")}.`);
      }
      options = days.slice(0, 3).map((d, i) => {
        const plan: Plan = { sched: clone(without), changes: [{ kind: "move", id: s.id, from: s.date, to: d }], notes: [] };
        plan.sched.set(s.id, { ...s, date: d });
        return finish(`move_${i}`, `Déplacer au ${day(d)}`, plan, x, (o) =>
          o.soft.length ? `Déplacée au ${day(d)}, avec ${o.soft.map((v) => v.label.toLowerCase()).join(", ")}.` : `Déplacée au ${day(d)}, sans règle souple enfreinte.`);
      });
      if (options.length < 3 && !isLong(s, x.rules) && !isKey(s)) {
        const plan: Plan = { sched: clone(without), changes: [{ kind: "drop", id: s.id, status: "skipped_choice", note: "Pas de jour disponible" }], notes: [] };
        options.push(finish("drop", "La laisser tomber", plan, x, (o) => `On renonce à cette séance : le volume baisse de ${-volumeDelta(o)} %.`));
      }
      return finalize(ctx, trigger, x.week.start, options, notes);
    }
    case "short_time": {
      const s = ctx.sessions.find((o) => o.id === trigger.sessionId);
      if (!s) return finalize(ctx, trigger, weekOf(ctx.today).start, [], ["Séance introuvable."]);
      const x = setup(ctx, s.date, new Set([s.date]), false);
      const eliminated: Violation[] = [];
      const short: Plan = { sched: clone(x.base), changes: [{ kind: "shorten", id: s.id, from_s: s.target_duration_s, to_s: trigger.minutes * 60 }], notes: [] };
      short.sched.set(s.id, { ...s, target_duration_s: trigger.minutes * 60 });
      if (isLong(s, x.rules) && x.rules.on("long_session_protected")) {
        eliminated.push({ rule: "long_session_protected", label: "Sortie longue intouchable", detail: "une sortie longue ne se raccourcit pas : on la déplace" });
      } else {
        options.push(finish("shorten", `Raccourcir à ${trigger.minutes} min`, short, x, (o) =>
          `On fait la séance aujourd'hui en ${trigger.minutes} min : on garde le stimulus, le volume baisse de ${-volumeDelta(o)} %. Garde l'échauffement et le cœur de séance, coupe le retour au calme et le volume facile.`));
      }
      const moved = propose(ctx, { kind: "move", sessionId: s.id }).options.slice(0, 2).map((o, i) => ({ ...o, key: `move_${i}` }));
      options.push(...moved);
      const result = finalize(ctx, trigger, x.week.start, options, notes);
      if (eliminated.length) result.eliminated.push({ key: "shorten", title: `Raccourcir à ${trigger.minutes} min`, reasons: eliminated });
      return result;
    }
    case "missed": {
      const s = ctx.sessions.find((o) => o.id === trigger.sessionId);
      if (!s) return finalize(ctx, trigger, weekOf(ctx.today).start, [], ["Séance introuvable."]);
      const x = setup(ctx, s.date < ctx.today ? ctx.today : s.date, new Set([s.date]), true);
      if (x.week.start !== weekOf(s.date).start) notes.push("La séance manquée est d'une semaine passée : elle ne se rattrape plus.");
      // A : rattraper (une seule par semaine, jamais en semaine allégée).
      const a: Plan = { sched: clone(x.base), changes: [], notes: [] };
      a.sched.delete(s.id);
      const p = x.week.start === weekOf(s.date).start ? findPlacement(a.sched, { ...s, status: "planned" }, x, false, ctx.catchupsThisWeek) : null;
      const eliminated: { key: string; title: string; reasons: Violation[] }[] = [];
      if (p) {
        a.sched.set(s.id, { ...s, date: p.day, status: "planned" });
        a.changes.push({ kind: "move", id: s.id, from: s.date, to: p.day, reopen: true });
        options.push(finish("catch_up", `Rattraper le ${day(p.day)}`, a, x, (o) =>
          `On rattrape « ${label(s)} » le ${day(p.day)}${o.soft.length ? `, au prix de : ${o.soft.map((v) => v.label.toLowerCase()).join(", ")}` : ""}. C'est le seul rattrapage autorisé cette semaine.`));
      } else {
        const probe = x.week.days.map((d) => placementViolations({ sched: a.sched, session: { ...s, status: "planned" }, day: d, ctx, rules: x.rules, blocked: x.blocked, catchup: true, catchupsUsed: ctx.catchupsThisWeek })).flat();
        const reasons = [...new Map(probe.filter((v) => v.rule !== "calendar").map((v) => [v.rule, v])).values()];
        eliminated.push({ key: "catch_up", title: "Rattraper la séance", reasons: reasons.length ? reasons : [{ rule: "calendar", label: "Calendrier", detail: "plus aucun jour disponible cette semaine" }] });
      }
      // B : échanger avec une séance secondaire de la même discipline plus tard dans la semaine.
      const swapWith = [...x.base.values()]
        .filter((o) => o.id !== s.id && isActive(o) && o.status === "planned" && o.discipline === s.discipline && !isKey(o) && !isLong(o, x.rules) && o.date >= ctx.today && x.week.days.includes(o.date))
        .sort((m, n) => m.date.localeCompare(n.date))
        .find((o) => {
          const trial = clone(x.base);
          trial.delete(o.id);
          trial.delete(s.id);
          return placementViolations({ sched: trial, session: { ...s, status: "planned" }, day: o.date, ctx, rules: x.rules, blocked: new Set(), catchup: true, catchupsUsed: ctx.catchupsThisWeek }).length === 0;
        });
      if (swapWith) {
        const b: Plan = { sched: clone(x.base), changes: [], notes: [] };
        b.sched.delete(swapWith.id);
        b.sched.set(s.id, { ...s, date: swapWith.date, status: "planned" });
        b.changes.push({ kind: "move", id: s.id, from: s.date, to: swapWith.date, reopen: true });
        b.changes.push({ kind: "drop", id: swapWith.id, status: "skipped_choice", note: `Remplacée par « ${label(s)} »` });
        options.push(finish("swap", `Remplacer « ${label(swapWith)} »`, b, x, () =>
          `« ${label(s)} » prend la place de « ${label(swapWith)} » le ${day(swapWith.date)} : la qualité est gardée sans ajouter de volume.`));
      }
      // C : laisser filer.
      const c: Plan = { sched: clone(x.base), changes: [], notes: [] };
      c.sched.delete(s.id);
      options.push(finish("let_go", "Laisser filer", c, x, () => "On ne rattrape pas : la semaine continue comme prévue, sans séance doublée."));
      const result = finalize(ctx, trigger, x.week.start, options, notes);
      result.eliminated.push(...eliminated);
      return result;
    }
  }
}

/** Retire les options identiques, garde l'ordre, explique si une seule reste. */
function finalize(_ctx: EngineContext, trigger: Trigger, weekStartDay: string, options: Option[], notes: string[]): Proposal {
  const seen = new Set<string>();
  const distinct: Option[] = [];
  const duplicates: string[] = [];
  for (const o of options) {
    const sig = JSON.stringify([...o.changes].sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind)));
    if (seen.has(sig)) duplicates.push(o.title);
    else {
      seen.add(sig);
      distinct.push(o);
    }
  }
  if (duplicates.length) notes.push(`Identique à une autre option, donc non proposée : ${duplicates.join(", ")}.`);
  if (distinct.length === 1) notes.push("Une seule option reste possible ; les autres sont éliminées par les règles ci-dessous ou identiques.");
  return { trigger, weekStart: weekStartDay, options: distinct, eliminated: [], notes };
}

