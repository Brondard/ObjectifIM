import { describe, expect, it } from "vitest";
import { planApply, catchupsIn } from "./apply";
import { propose } from "./generate";
import { Rules, placementViolations, isActive } from "./rules";
import type { EngineContext, EngineSession, Option, Proposal } from "./types";

// Semaine de base type, du lundi 16 au dimanche 22 novembre 2026.
const s = (id: string, date: string, discipline: string, session_type: string, priority: string, minutes: number, extra: Partial<EngineSession> = {}): EngineSession => ({
  id, date, discipline, session_type, priority, status: "planned", title: extra.title ?? id, local_time: null,
  target_duration_s: minutes * 60, ...extra,
});

const WEEK: EngineSession[] = [
  s("mon_swim", "2026-11-16", "swim", "endurance", "secondary", 45, { local_time: "07:30" }),
  s("mon_push", "2026-11-16", "strength", "strength_push", "optional", 30),
  s("tue_run", "2026-11-17", "run", "endurance", "secondary", 45, { title: "Footing" }),
  s("tue_swim", "2026-11-17", "swim", "technique", "secondary", 45, { local_time: "07:30" }),
  s("wed_club", "2026-11-18", "run", "threshold", "key", 60, { title: "Club", local_time: "19:00" }),
  s("thu_swim", "2026-11-19", "swim", "endurance", "secondary", 50, { local_time: "07:30" }),
  s("fri_legs", "2026-11-20", "strength", "strength_legs", "secondary", 45),
  s("sat_long", "2026-11-21", "run", "long", "key", 100, { title: "Sortie longue", local_time: "09:00" }),
  s("sat_swim", "2026-11-21", "swim", "endurance", "secondary", 45),
  s("sun_bike", "2026-11-22", "bike", "endurance", "key", 150, { title: "Vélo foncier" }),
];

const ctx = (o: Partial<EngineContext> = {}): EngineContext => ({
  today: "2026-11-16",
  sessions: WEEK,
  done: [
    // Quatre semaines précédentes à ~8 h réalisées, RPE 4.
    ...[0, 1, 2, 3].flatMap((w) => [1, 2, 3, 4, 5, 6].map((d) => ({
      local_date: `2026-10-${String(19 + w * 7 + d - 1).padStart(2, "0")}`.replace("2026-10-3", "2026-10-3").replace(/2026-10-(3[2-9]|4\d)/, (m) => `2026-11-${String(Number(m.slice(-2)) - 31).padStart(2, "0")}`),
      discipline: "run", moving_s: 4800, elapsed_s: 4800, rpe: 4,
    }))),
  ],
  rules: [],
  phaseType: "base",
  phaseParams: {},
  aRaceDates: [],
  substitutions: [
    { from_discipline: "bike", from_session_type: "endurance", to_discipline: "run", to_session_type: "endurance", to_label: "Course à pied en Z2", duration_ratio: 0.75, loss_note: "Impact plus élevé." },
  ],
  catchupsThisWeek: 0,
  ...o,
});

/** Rejoue chaque option et vérifie qu'aucune séance déplacée ne viole une règle dure. */
function expectNoHardViolation(p: Proposal, c: EngineContext, blocked: string[]) {
  const rules = new Rules(c.rules);
  for (const o of p.options) {
    const sched = new Map(c.sessions.map((x) => [x.id, { ...x }]));
    for (const ch of o.changes) {
      const cur = sched.get(ch.id)!;
      if (ch.kind === "move") sched.set(ch.id, { ...cur, date: ch.to, status: "planned" });
      if (ch.kind === "drop") sched.set(ch.id, { ...cur, status: ch.status });
    }
    for (const ch of o.changes.filter((x) => x.kind === "move")) {
      const moved = sched.get(ch.id)!;
      const v = placementViolations({ sched, session: moved, day: moved.date, ctx: c, rules, blocked: new Set(blocked), catchup: false, catchupsUsed: 0 });
      expect(v, `${o.key} : ${ch.id} le ${moved.date}`).toEqual([]);
    }
  }
}

const change = (o: Option, id: string) => o.changes.find((c) => c.id === id);
const total = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);

describe("« Je pars ce week-end »", () => {
  const c = ctx();
  const p = propose(c, { kind: "unavailable", from: "2026-11-21", to: "2026-11-22", reason: "week-end en famille" });

  it("propose trois options distinctes, avec leur arbitrage", () => {
    expect(p.options.map((o) => o.key)).toEqual(["keep_volume", "protect_quality", "accept_light"]);
    for (const o of p.options) {
      expect(o.explanation.length).toBeGreaterThan(30);
      expect(Object.keys(o.volumeAfter).length).toBeGreaterThan(0);
    }
  });

  it("la sortie longue n'est jamais supprimée, ni coupée", () => {
    for (const o of p.options) {
      const ch = change(o, "sat_long");
      expect(ch?.kind, o.key).toBe("move");
    }
  });

  it("les options s'échelonnent : volume gardé, puis qualité, puis semaine allégée", () => {
    const [a, b, light] = p.options.map((o) => total(o.volumeAfter));
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThan(light);
    expect(change(p.options[1], "sun_bike")?.kind).toBe("move"); // clé gardée
    expect(change(p.options[1], "sat_swim")?.kind).toBe("drop"); // secondaire sacrifiée
    expect(change(p.options[2], "sun_bike")?.kind).toBe("drop");
  });

  it("aucune option ne viole une règle dure", () => {
    expectNoHardViolation(p, c, ["2026-11-21", "2026-11-22"]);
  });

  it("est déterministe", () => {
    expect(propose(c, { kind: "unavailable", from: "2026-11-21", to: "2026-11-22", reason: "week-end en famille" })).toEqual(p);
  });

  it("le choix devient des écritures et une entrée de journal complète", () => {
    const writes = planApply(p, p.options[1], c.sessions, "chg1", "week-end en famille");
    const log = writes.find((w) => w.table === "plan_changes")!;
    expect(log.fields).toMatchObject({ trigger: "unavailable", chosen_option: "protect_quality", engine_version: "1" });
    expect((log.fields.options as { options: Option[] }).options).toHaveLength(3);
    const sat = writes.find((w) => w.id === "sat_swim")!;
    expect(sat.fields).toMatchObject({ status: "skipped_life" });
    const long = writes.find((w) => w.id === "sat_long")!;
    expect(long.fields.original_date).toBe("2026-11-21");
  });
});

describe("règles dures", () => {
  it("semaine de course A : aucun déplacement", () => {
    const c = ctx({ aRaceDates: ["2026-11-22"] });
    const p = propose(c, { kind: "unavailable", from: "2026-11-21", to: "2026-11-21" });
    for (const o of p.options) expect(o.changes.every((ch) => ch.kind !== "move")).toBe(true);
    expect(p.options.some((o) => o.alerts.some((a) => a.includes("sortie longue")))).toBe(true);
  });

  it("semaine allégée : seule la sortie longue se déplace", () => {
    const p = propose(ctx({ phaseType: "recovery" }), { kind: "unavailable", from: "2026-11-21", to: "2026-11-22" });
    for (const o of p.options) {
      const moved = o.changes.filter((ch) => ch.kind === "move").map((ch) => ch.id);
      expect(moved.every((id) => id === "sat_long"), o.key).toBe(true);
    }
  });

  it("une règle désactivée n'est plus appliquée", () => {
    const rules = [{ rule_key: "max_consecutive_run_days", kind: "hard", enabled: false, weight: 1, params: {} }];
    const p = propose(ctx({ rules }), { kind: "unavailable", from: "2026-11-21", to: "2026-11-22" });
    // Sans la limite de jours de course consécutifs, la sortie longue n'a plus besoin de chasser une séance.
    expect(p.options[0].changes.some((ch) => ch.kind === "drop" && ch.id === "fri_legs")).toBe(false);
  });
});

describe("autres déclencheurs", () => {
  it("malade : jamais de compression, pas d'option « conserver le volume »", () => {
    const p = propose(ctx(), { kind: "sick", from: "2026-11-16", days: 3 });
    expect(p.options.map((o) => o.key)).toEqual(["gentle_return", "resume_plan"]);
    expect(p.options[0].changes.find((ch) => ch.kind === "shorten")?.id).toBe("sat_long");
    for (const o of p.options) expect(o.changes.filter((ch) => ["mon_swim", "tue_run", "wed_club"].includes(ch.id)).every((ch) => ch.kind === "drop")).toBe(true);
  });

  it("temps réduit sur une sortie longue : on ne la raccourcit pas, on la déplace", () => {
    const p = propose(ctx({ today: "2026-11-21" }), { kind: "short_time", sessionId: "sat_long", minutes: 45 });
    expect(p.eliminated.find((e) => e.key === "shorten")?.reasons[0].rule).toBe("long_session_protected");
  });

  it("temps réduit sur un footing : raccourcir est proposé en premier", () => {
    const p = propose(ctx(), { kind: "short_time", sessionId: "tue_run", minutes: 30 });
    expect(p.options[0]).toMatchObject({ key: "shorten" });
    expect(p.options[0].changes[0]).toMatchObject({ kind: "shorten", to_s: 1800 });
  });

  it("séance clé manquée : un seul rattrapage par semaine", () => {
    const missed = WEEK.map((x) => (x.id === "wed_club" ? { ...x, status: "skipped_life" } : x));
    const free = propose(ctx({ sessions: missed, today: "2026-11-19" }), { kind: "missed", sessionId: "wed_club" });
    expect(free.options.map((o) => o.key)).toContain("let_go");
    const capped = propose(ctx({ sessions: missed, today: "2026-11-19", catchupsThisWeek: 1 }), { kind: "missed", sessionId: "wed_club" });
    expect(capped.options.map((o) => o.key)).not.toContain("catch_up");
    expect(capped.eliminated.find((e) => e.key === "catch_up")?.reasons.map((r) => r.rule)).toContain("catchup_limit");
  });

  it("déplacement sans vélo : substitution avec ce qu'elle fait perdre", () => {
    const p = propose(ctx(), { kind: "travel", from: "2026-11-22", to: "2026-11-22", noBike: true, noPool: false });
    expect(p.options[0].key).toBe("substitute");
    expect(p.options[0].changes[0]).toMatchObject({ kind: "substitute", id: "sun_bike", to_discipline: "run", duration_s: 6780, loss: "Impact plus élevé." });
  });

  it("déplacer vers un jour interdit : le moteur dit pourquoi", () => {
    const p = propose(ctx(), { kind: "move", sessionId: "fri_legs", to: "2026-11-17" });
    expect(p.notes.join(" ")).toMatch(/24 h/);
    expect(p.options.length).toBeGreaterThanOrEqual(2);
  });
});

describe("journal", () => {
  it("compte les rattrapages de la semaine", () => {
    const log = [
      { trigger: "missed_key", chosen_option: "catch_up", occurred_at: "2026-11-18T10:00:00Z" },
      { trigger: "missed_key", chosen_option: "let_go", occurred_at: "2026-11-18T10:00:00Z" },
      { trigger: "missed_key", chosen_option: "swap", occurred_at: "2026-11-10T10:00:00Z" },
    ];
    expect(catchupsIn(log, "2026-11-16", "2026-11-22")).toBe(1);
  });

  it("aucune option n'est appliquée sans choix : propose ne modifie pas ses entrées", () => {
    const c = ctx();
    const copy = JSON.stringify(c);
    propose(c, { kind: "unavailable", from: "2026-11-21", to: "2026-11-22" });
    expect(JSON.stringify(c)).toBe(copy);
    expect(c.sessions.every(isActive)).toBe(true);
  });
});
