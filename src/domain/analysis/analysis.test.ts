import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/time";
import { PRESETS, type ZoneModel } from "../zones";
import { adherenceByWeek, skipReasons, weeksBack } from "./adherence";
import { acwrSeries, dailyLoads, foster, sessionLoad } from "./load";
import { rigor, type SessionAnalysis } from "./rigor";
import { analyzeSession, contextKey } from "./session";
import { chainSignals, niggleSignals } from "./signals";
import { blockPaces, cadenceDrop, cardiacDrift, timeInZones } from "./streams";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("assiduité", () => {
  const planned = [
    { id: "a", date: "2026-11-02", discipline: "run", status: "completed", target_duration_s: 3600, target_distance_m: null, deleted_at: null },
    { id: "b", date: "2026-11-03", discipline: "run", status: "skipped_life", target_duration_s: 2700, target_distance_m: null, deleted_at: null },
    { id: "c", date: "2026-11-04", discipline: "swim", status: "partial", target_duration_s: 2700, target_distance_m: null, deleted_at: null },
    { id: "d", date: "2026-11-12", discipline: "run", status: "planned", target_duration_s: 2700, target_distance_m: null, deleted_at: null },
  ];
  const done = [{ id: "x", local_date: "2026-11-02", discipline: "run", planned_session_id: "a", elapsed_s: 3700, moving_s: 3500, distance_m: null, deleted_at: null }];

  it("taux sur les séances échues, raisons d'abandon distinguées", () => {
    const [w1, w2] = adherenceByWeek(planned, done, ["2026-11-02", "2026-11-09"], "2026-11-10");
    expect(w1).toMatchObject({ planned: 3, done: 1, partial: 1, rate: 0.67, skipped: { life: 1 }, planned_s: 9000, done_s: 3500 });
    expect(w2).toMatchObject({ planned: 1, open: 1, rate: null });
    expect(skipReasons([w1, w2])).toEqual({ choice: 0, life: 1, injury: 0 });
    expect(adherenceByWeek(planned, done, ["2026-11-02"], "2026-11-10", "swim")[0]).toMatchObject({ planned: 1, rate: 1 });
  });

  it("semaines glissantes se terminant sur la semaine courante", () => {
    expect(weeksBack(localDate("2026-11-10"), 3)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
  });
});

describe("charge", () => {
  const p = { defaultRpe: 4, rpeByType: { long: 4, threshold: 7 } };
  const c = (date: string, min: number, rpe: number | null, session_type: string | null = null) => ({
    id: date + min, local_date: date, discipline: "run", planned_session_id: null, elapsed_s: min * 60, moving_s: min * 60, distance_m: null, deleted_at: null, rpe, session_type,
  });

  it("RPE × minutes, RPE estimé signalé", () => {
    expect(sessionLoad(c("2026-11-01", 60, 6), p)).toEqual({ load: 360, estimated: false });
    expect(sessionLoad(c("2026-11-01", 60, null, "threshold"), p)).toEqual({ load: 420, estimated: true });
    expect(sessionLoad(c("2026-11-01", 30, null), p)).toEqual({ load: 120, estimated: true });
  });

  it("ratio aigu / chronique : stable à 1, pic au-dessus", () => {
    const sessions = range(35).map((i) => c(`2026-10-${String(1 + i).padStart(2, "0")}`.replace(/2026-10-3[2-5]/, (m) => `2026-11-0${Number(m.slice(-2)) - 31}`), 60, 5));
    const days = dailyLoads(sessions, "2026-10-01", "2026-11-04", p);
    const series = acwrSeries(days);
    expect(series[26].acwr).toBeNull();
    expect(series[27].acwr).toBe(1);
    const spike = dailyLoads([...sessions, c("2026-11-04", 300, 8)], "2026-10-01", "2026-11-04", p);
    expect(acwrSeries(spike).at(-1)!.acwr).toBeGreaterThan(1.5);
  });

  it("monotonie et contrainte de Foster", () => {
    expect(foster([100, 100, 100, 100, 100, 100, 100].map((load) => ({ load })))).toEqual({ load: 700, monotony: null, strain: null });
    const varied = foster([0, 300, 0, 400, 0, 600, 100].map((load) => ({ load })));
    expect(varied.load).toBe(1400);
    expect(varied.monotony).toBeLessThan(1);
    const uniform = foster([200, 210, 190, 200, 205, 195, 0].map((load) => ({ load })));
    expect(uniform.monotony).toBeGreaterThan(2);
  });
});

const zonesHr = PRESETS.pct_hrmax.map((b) => ({ zone: b.zone, min: Math.round(b.lo! * 194), max: Math.round(b.hi! * 194) }));

describe("flux", () => {
  it("temps par zone de FC, FC au-delà de la dernière borne comptée en Z5", () => {
    const s = { time: range(601), heartrate: range(601).map((t) => (t < 300 ? 120 : t < 500 ? 150 : 200)) };
    expect(timeInZones(s, "hr", zonesHr)).toEqual({ seconds: [0, 300, 200, 0, 100], outside: 0 });
  });

  it("dérive cardiaque : la FC monte à allure égale", () => {
    const n = 4200;
    const s = { time: range(n), velocity_smooth: Array(n).fill(3), heartrate: range(n).map((t) => (t < 2400 ? 140 : 150)) };
    const d = cardiacDrift(s, "pace")!;
    expect(d.pct).toBeGreaterThan(5);
    expect(cardiacDrift({ time: range(1200), velocity_smooth: Array(1200).fill(3), heartrate: Array(1200).fill(140) }, "pace")).toBeNull();
  });

  it("décrochage de cadence en fin de sortie longue (course : ×2)", () => {
    const n = 4200;
    const s = { time: range(n), cadence: range(n).map((t) => (t > 3200 ? 82 : 86)) };
    expect(cadenceDrop(s, "run")).toMatchObject({ early: 172, late: 164 });
  });

  it("isole les blocs d'allure prévus dans le flux", () => {
    // 10 min d'échauffement à 3 m/s, 1 000 m à 4 m/s (4:10/km), 5 min de récup.
    const t = range(1100);
    const v = t.map((x) => (x < 600 ? 3 : x < 850 ? 4 : 2.5));
    let acc = 0;
    const dist = v.map((x) => (acc += x) - x);
    const structure = { version: 1 as const, steps: [
      { kind: "warmup" as const, duration_s: 600 },
      { kind: "work" as const, distance_m: 1000, intensity: { basis: "pace" as const, min: 260, max: 265 } },
      { kind: "recovery" as const, duration_s: 300 },
    ] };
    expect(blockPaces({ time: t, distance: dist, velocity_smooth: v }, structure)).toEqual([
      { index: 1, target_min: 260, target_max: 265, actual: 250, delta_s: -10 },
    ]);
    expect(blockPaces({ time: t, distance: dist }, { version: 1, steps: [{ kind: "warmup" }, { kind: "work", distance_m: 1000 }] })).toBeNull();
  });
});

describe("analyse d'une séance", () => {
  const models: ZoneModel[] = [{ discipline: "run", basis: "hr", method: "pct_hrmax", bounds: PRESETS.pct_hrmax, valid_from: "2026-01-01" }];
  const ctx = {
    models,
    metrics: [{ kind: "hr_max", value: 194, measured_on: "2026-01-01" }],
    rules: { defaultZoneByType: { endurance: 2 }, judgementByType: { endurance: "hr" }, intensity: { skipFirstS: 180, alertPct: 15 } },
  };
  const n = 3000;
  const streams = { time: range(n), heartrate: range(n).map((t) => (t < 1500 ? 125 : 145)), velocity_smooth: Array(n).fill(3) };
  const completion = { local_date: "2026-11-02", discipline: "run", moving_s: n, elapsed_s: n, hr_reliable: null };

  it("footing prévu : verdict, temps par zone", () => {
    const a = analyzeSession(completion, { date: "2026-11-02", discipline: "run", session_type: "endurance", target_intensity: null, structure: null }, streams, ctx);
    expect(a.intensity).toMatchObject({ verdict: "too_hard", basis: "hr" });
    expect(a.zones?.basis).toBe("hr");
    expect(a.zones!.seconds[2]).toBeGreaterThan(1400);
  });

  it("FC déclarée aberrante : temps par zone à l'allure, pas de verdict FC", () => {
    const a = analyzeSession({ ...completion, hr_reliable: false }, { date: "2026-11-02", discipline: "run", session_type: "endurance", target_intensity: null, structure: null }, streams, ctx);
    expect(a.intensity).toBeNull();
    expect(a.zones).toBeNull(); // pas de modèle d'allure configuré : rien d'inventé
  });

  it("séance antérieure aux premiers repères : zones approximatives, signalées", () => {
    const late = { ...ctx, models: [{ ...models[0], valid_from: "2026-11-10" }], metrics: [{ kind: "hr_max", value: 194, measured_on: "2026-11-10" }] };
    const a = analyzeSession({ ...completion, local_date: "2026-10-20" }, null, streams, late);
    expect(a.zones).toMatchObject({ basis: "hr", approx: true });
    expect(analyzeSession(completion, null, streams, ctx).zones?.approx).toBe(false);
  });

  it("l'empreinte change avec les repères, pas d'un appel à l'autre", () => {
    expect(contextKey(ctx)).toBe(contextKey({ ...ctx }));
    expect(contextKey(ctx)).not.toBe(contextKey({ ...ctx, metrics: [{ kind: "hr_max", value: 191, measured_on: "2026-01-01" }] }));
  });

  it("séance imprévue : zones mais pas de verdict", () => {
    const a = analyzeSession(completion, null, streams, ctx);
    expect(a.intensity).toBeNull();
    expect(a.zones?.seconds.reduce((x, y) => x + y, 0)).toBeGreaterThan(2700);
  });
});

describe("rigueur : est-ce que je cours trop vite ?", () => {
  const easy = (verdict: "ok" | "too_hard", above: number, zones: number[]): SessionAnalysis => ({
    version: 2,
    intensity: { version: 1, basis: "hr", target: { min: 116, max: 136 }, analysed_s: 2700, above_pct: above, below_pct: 0, in_pct: 100 - above, mean: 130, verdict },
    zones: { basis: "hr", method: "pct_hrmax", seconds: zones, outside: 0, bounds: [], approx: false },
    drift: null, cadence: null, blocks: null, ctx_key: "k",
  });

  it("donne une réponse chiffrée", () => {
    const r = rigor([
      { local_date: "2026-11-02", discipline: "run", planned_type: "endurance", analysis: easy("too_hard", 40, [0, 1000, 1500, 200, 0]) },
      { local_date: "2026-11-04", discipline: "run", planned_type: "endurance", analysis: easy("ok", 5, [100, 2400, 200, 0, 0]) },
      { local_date: "2026-11-05", discipline: "run", planned_type: "endurance", analysis: easy("too_hard", 22, [0, 1800, 700, 0, 0]) },
      { local_date: "2026-11-07", discipline: "run", planned_type: "threshold", analysis: easy("ok", 0, [0, 600, 600, 1600, 200]) },
    ], 4);
    expect(r).toMatchObject({ easyAnalysed: 3, easyTooHard: 2, easyTooHardPct: 67, meanAboveCeilingPct: 22.3 });
    expect(r.aboveZ2Pct).toBe(46);
    expect(r.sentence).toMatch(/^Sur les 4 dernières semaines, 67 % de tes footings faciles \(2 sur 3\)/);
  });

  it("dit honnêtement quand il n'y a pas de quoi répondre", () => {
    expect(rigor([], 4).sentence).toMatch(/Pas encore assez/);
  });
});

describe("signaux", () => {
  it("enchaînements à risque", () => {
    const s = chainSignals([
      { date: "2026-11-10", session_type: "threshold", priority: "key", title: "Club", done: true },
      { date: "2026-11-11", session_type: "vo2", priority: "secondary", title: "VMA", done: false },
      { date: "2026-11-13", session_type: "strength_legs", priority: "secondary", title: null, done: false },
      { date: "2026-11-14", session_type: "long", priority: "key", title: "Sortie longue", done: false },
    ]);
    expect(s.map((x) => x.key)).toEqual(["hard:2026-11-10", "legs:2026-11-13"]);
  });

  it("gêne récurrente, ancienne ou en hausse", () => {
    const niggles = [
      { id: "1", body_zone: "achilles", side: "left", started_on: "2026-08-01", resolved_on: "2026-08-20" },
      { id: "2", body_zone: "achilles", side: "left", started_on: "2026-10-20", resolved_on: null },
      { id: "3", body_zone: "knee", side: "right", started_on: "2026-07-01", resolved_on: "2026-07-10" },
    ];
    const entries = [{ niggle_id: "2", date: "2026-10-20", intensity: 2 }, { niggle_id: "2", date: "2026-11-05", intensity: 4 }];
    expect(niggleSignals(niggles, entries, "2026-11-10").map((s) => s.key)).toEqual(["recur:achilles|left", "long:2", "rising:2"]);
  });
});
