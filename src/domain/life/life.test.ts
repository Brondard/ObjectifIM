import { describe, expect, it } from "vitest";
import { equipmentAlerts, equipmentKm, matchGear } from "./equipment";
import { bestEffortTime, bestEfforts, bestPower, recordLines } from "./records";
import { checkinAdvice, hrRestBaseline, lighterVersion, weekReview } from "./review";
import { e1rm, exerciseProgress, exercisesForType, nextSetPrefill, previousSets, type SetLike } from "./strength";
import { heatAdjust, parseOpenMeteo, rainSwaps, sessionWeather } from "./weather";

const set = (o: Partial<SetLike>): SetLike => ({ id: Math.random().toString(36), completed_session_id: "s1", exercise_id: "squat", set_index: 1, side: null, load_kg: 80, reps: 8, rir: 2, is_warmup: false, ...o });
const sessions = [{ id: "s1", local_date: "2026-11-02" }, { id: "s2", local_date: "2026-11-06" }, { id: "s3", local_date: "2026-11-10" }];

describe("musculation", () => {
  const sets = [
    set({ completed_session_id: "s1", set_index: 1, load_kg: 80 }), set({ completed_session_id: "s1", set_index: 2, load_kg: 80 }),
    set({ completed_session_id: "s2", set_index: 1, load_kg: 40, is_warmup: true }),
    set({ completed_session_id: "s2", set_index: 2, load_kg: 85, reps: 6 }), set({ completed_session_id: "s2", set_index: 3, load_kg: 85, reps: 5 }),
  ];

  it("pré-remplit avec la dernière série, de la séance en cours sinon de la précédente", () => {
    const prev = previousSets(sets, sessions, "squat", "s3");
    expect(prev.map((s) => s.load_kg)).toEqual([40, 85, 85]);
    expect(nextSetPrefill([], prev)).toMatchObject({ set_index: 1, load_kg: 85, reps: 6 });
    const current = [set({ completed_session_id: "s3", set_index: 1, load_kg: 87.5, reps: 5 })];
    expect(nextSetPrefill(current, prev)).toMatchObject({ set_index: 2, load_kg: 87.5, reps: 5 });
  });

  it("1RM estimé et progression par séance, échauffement exclu", () => {
    expect(e1rm(100, 5)).toBe(116.7);
    expect(e1rm(100, 15)).toBeNull();
    expect(exerciseProgress(sets, sessions, "squat")).toEqual([
      { date: "2026-11-02", top_kg: 80, e1rm: 101.3, volume_kg: 1280, sets: 2 },
      { date: "2026-11-06", top_kg: 85, e1rm: 102, volume_kg: 935, sets: 2 },
    ]);
  });

  it("propose d'abord les exercices de la séance (Jambes : ceux qui chargent les jambes)", () => {
    const ex = [
      { id: "b", name: "Développé couché", muscle_groups: ["pectoraux"], loads_legs: false },
      { id: "s", name: "Squat", muscle_groups: ["quadriceps"], loads_legs: true },
    ];
    expect(exercisesForType(ex, "strength_legs")[0].id).toBe("s");
    expect(exercisesForType(ex, "strength_push")[0].id).toBe("b");
  });
});

describe("matériel", () => {
  const shoes = { id: "sh", kind: "shoes", name: "Pegasus", initial_km: 600, alert_km: null, retired_on: null, strava_gear_id: "g123" };
  const bike = { id: "bk", kind: "bike", name: "Vélo route", initial_km: 0, alert_km: null, retired_on: null, strava_gear_id: null };
  const usage = [{ equipment_id: "sh", distance_m: 100000 }, { equipment_id: "sh", distance_m: 60000, deleted_at: "x" }, { equipment_id: "bk", distance_m: 3200000 }];

  it("kilométrage et alertes d'usure et d'entretien", () => {
    expect(equipmentKm(shoes, usage)).toBe(700);
    const alerts = equipmentAlerts([shoes, bike], usage, [
      { equipment_id: "bk", component: "Chaîne", done_on: "2026-06-01", at_km: 0, interval_km: 3000 },
      { equipment_id: "bk", component: "Pneus", done_on: "2026-06-01", at_km: 1000, interval_km: 4000 },
    ], 700);
    expect(alerts.map((a) => a.key)).toEqual(["wear:sh", "maint:bk:Chaîne"]);
  });

  it("associe l'équipement Strava", () => {
    expect(matchGear([shoes, bike], "g123")).toBe("sh");
    expect(matchGear([shoes, bike], "inconnu")).toBeNull();
  });
});

const hourly = parseOpenMeteo({
  hourly: {
    time: ["2026-11-14T08:00", "2026-11-14T09:00", "2026-11-14T10:00", "2026-11-15T08:00", "2026-11-15T09:00", "2026-11-15T10:00"],
    temperature_2m: [12, 13, 14, 24, 26, 28],
    precipitation: [2, 3, 1, 0, 0, 0],
    precipitation_probability: [90, 95, 80, 5, 0, 0],
    wind_speed_10m: [20, 25, 30, 5, 5, 8],
  },
})!;

describe("météo", () => {
  it("conditions pendant la séance", () => {
    expect(sessionWeather(hourly, "2026-11-14", "08:00", 7200)).toEqual({ temp_max: 13, temp_avg: 12.5, rain_mm: 5, rain_probability: 95, wind_max: 25 });
    expect(sessionWeather(hourly, "2026-11-20", "08:00", 3600)).toBeNull();
  });

  it("propose d'intervertir la sortie longue sous la pluie avec une séance d'un jour sec", () => {
    const base = { local_time: "08:00", target_duration_s: 7200, indoor: false, discipline: "run", status: "planned", title: null };
    const s = [
      { ...base, id: "sl", date: "2026-11-14", session_type: "long", priority: "key" },
      { ...base, id: "ft", date: "2026-11-15", session_type: "endurance", priority: "secondary" },
    ];
    expect(rainSwaps(s, hourly, "2026-11-11", "2026-11-15", { rain_mm: 3, probability: 70 }).map((x) => [x.session.id, x.with.id])).toEqual([["sl", "ft"]]);
  });

  it("correction de chaleur au-delà de 20 °C, affichée", () => {
    expect(heatAdjust({ min: 330, max: 345 }, 28)).toEqual({ pct: 3.2, min: 341, max: 356 });
    expect(heatAdjust({ min: 330, max: 345 }, 18)).toBeNull();
  });
});

describe("records", () => {
  const n = 3000;
  // 3 m/s puis 4 m/s pendant 1 000 m au milieu.
  const v = Array.from({ length: n }, (_, t) => (t >= 1000 && t < 1250 ? 4 : 3));
  let acc = 0;
  const distance = v.map((x) => (acc += x) - x);
  const s = { time: Array.from({ length: n }, (_, t) => t), distance, watts: Array.from({ length: n }, (_, t) => (t < 400 ? 300 : 200)) };

  it("meilleur temps sur une distance, d'un seul tenant", () => {
    expect(bestEffortTime(s, 1000)).toBe(250);
    expect(bestEffortTime(s, 100000)).toBeNull();
    expect(bestEfforts(s, "run").run?.[5000]).toBeLessThan(1667);
  });

  it("meilleure puissance moyenne sur une durée", () => {
    expect(bestPower(s, 300)).toBe(300);
    expect(bestPower(s, 1200)).toBe(233);
  });

  it("progression d'un record dans le temps", () => {
    const lines = recordLines([
      { key: "run:5000", date: "2026-03-01", value: 1500, source_id: "a" },
      { key: "run:5000", date: "2026-05-01", value: 1520, source_id: "b" },
      { key: "run:5000", date: "2026-09-01", value: 1440, source_id: "c" },
    ], (k) => k.startsWith("run"));
    expect(lines[0].best.value).toBe(1440);
    expect(lines[0].history.map((h) => h.source_id)).toEqual(["a", "c"]);
  });
});

describe("check-in et revue", () => {
  it("deux indicateurs mauvais : proposer la version allégée", () => {
    const base = hrRestBaseline([50, 51, 49, 52, 50, 48]);
    expect(base).toBe(50);
    expect(checkinAdvice({ sleep_quality: 2, freshness: 3, mood: 4, motivation: 4, soreness: 2, hr_rest: 58 }, base)).toEqual({ bad: ["sommeil", "FC de repos (+8 bpm)"], lighten: true });
    expect(checkinAdvice({ sleep_quality: 4, freshness: 2, mood: 4, motivation: 4, soreness: 2, hr_rest: 51 }, base).lighten).toBe(false);
  });

  it("version allégée : plus courte, facile, plus de structure", () => {
    expect(lighterVersion({ session_type: "threshold", priority: "key", target_duration_s: 3600, discipline: "run" }, 0.6)).toEqual({
      target_duration_s: 2100, session_type: "recovery", priority: "secondary", target_intensity: { basis: "hr", zone: 1 }, structure: null,
    });
  });

  it("revue de la semaine, factuelle", () => {
    const p = (o: object) => ({ id: Math.random().toString(), date: "2026-11-10", discipline: "run", status: "completed", target_duration_s: 3600, target_distance_m: null, deleted_at: null, title: null, session_type: "endurance", priority: "secondary", ...o });
    const r = weekReview({
      weekStart: "2026-11-09",
      planned: [p({}), p({ status: "skipped_life", priority: "key", title: "Club" })],
      completed: [{ id: "c", local_date: "2026-11-10", discipline: "run", planned_session_id: null, elapsed_s: 3600, moving_s: 3600, distance_m: null, deleted_at: null }],
      nextWeek: [p({ priority: "key", status: "planned" })],
      intensityOff: [{ title: "Footing", verdict: "too_hard", pct: 30 }],
      signals: [],
    });
    expect(r.lines[0]).toBe("Volume : 1 h 00 réalisées pour 2 h 00 prévues (-50 %).");
    expect(r.lines[1]).toBe("Séances : 1/2 faites, 1 manquée(s). Séances clés : 0/1.");
    expect(r.lines.at(-1)).toBe("Semaine prochaine : 1 h 00, 1 séance(s) dont 1 clé(s).");
  });
});
