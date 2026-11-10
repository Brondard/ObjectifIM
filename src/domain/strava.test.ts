import { describe, expect, it } from "vitest";
import { analyzeIntensity } from "./intensity";
import { planConfirm, planReject, suggestMatch } from "./matching";
import { completedFieldsFrom, disciplineOf, streamsFrom, type StravaActivity } from "./strava";
import type { CompletedLike, PlannedLike } from "./week";

const activity: StravaActivity = {
  id: 123, name: "Footing", sport_type: "TrailRun",
  start_date: "2026-10-24T22:30:00Z", start_date_local: "2026-10-25T00:30:00Z",
  elapsed_time: 3700, moving_time: 3600, distance: 10200, total_elevation_gain: 120,
  average_heartrate: 141.4, max_heartrate: 165, suffer_score: 42,
};

describe("activité Strava", () => {
  it("classe les sports", () => {
    expect(["Run", "TrailRun", "Ride", "VirtualRide", "Swim", "WeightTraining", "Workout", "Walk"].map(disciplineOf))
      .toEqual(["run", "run", "bike", "bike", "swim", "strength", "other", "other"]);
  });

  it("garde le jour local du lieu, la nuit du changement d'heure comprise", () => {
    const f = completedFieldsFrom(activity);
    expect(f).toMatchObject({ local_date: "2026-10-25", discipline: "run", moving_s: 3600, avg_hr: 141, relative_effort: 42, source: "strava" });
    expect(f).not.toHaveProperty("rpe");
    expect(f).not.toHaveProperty("planned_session_id");
  });

  it("lit les flux par type", () => {
    expect(streamsFrom({ time: { data: [0, 1] }, heartrate: { data: [100, 101] }, foo: { data: [1] } })).toEqual({ time: [0, 1], heartrate: [100, 101] });
    expect(streamsFrom({ heartrate: { data: [1] } })).toBeNull();
  });
});

const planned = (o: Partial<PlannedLike>): PlannedLike => ({
  id: "p", date: "2026-10-25", discipline: "run", status: "planned", target_duration_s: 3600,
  target_distance_m: null, deleted_at: null, ...o,
});

describe("rapprochement", () => {
  const act = { local_date: "2026-10-25", discipline: "run", moving_s: 3500 };

  it("même jour, même discipline, durée la plus proche", () => {
    const list = [planned({ id: "a", target_duration_s: 1800 }), planned({ id: "b", target_duration_s: 3600 }), planned({ id: "c", discipline: "bike" })];
    expect(suggestMatch(act, list, new Set())).toBe("b");
    expect(suggestMatch(act, list, new Set(["b"]))).toBe("a");
    expect(suggestMatch({ ...act, local_date: "2026-10-26" }, list, new Set())).toBeNull();
  });

  const imported = { id: "s", local_date: "2026-10-25", discipline: "run", planned_session_id: "p", elapsed_s: 3700, moving_s: 3600, distance_m: 10200, deleted_at: null, rpe: null, feeling: null } as CompletedLike & { rpe: number | null; feeling: string | null };

  it("confirmer remplace la saisie manuelle en gardant son RPE et son ressenti", () => {
    const manual = { ...imported, id: "m", rpe: 4, feeling: "facile" };
    expect(planConfirm(imported, planned({ status: "completed" }), manual, "T")).toEqual([
      { table: "completed_sessions", id: "s", fields: { planned_session_id: "p", match_status: "confirmed", rpe: 4, feeling: "facile" } },
      { table: "planned_sessions", id: "p", fields: { status: "completed", skip_note: null } },
      { table: "completed_sessions", id: "m", fields: { deleted_at: "T" } },
    ]);
  });

  it("confirmer une séance marquée manquée la passe en faite ; partielle reste partielle", () => {
    expect(planConfirm(imported, planned({ status: "skipped_life", skip_note: "boulot" }), null, "T")[1].fields).toEqual({ status: "completed", skip_note: null });
    expect(planConfirm(imported, planned({ status: "partial" }), null, "T")[1].fields.status).toBe("partial");
  });

  it("refuser détache l'activité", () => {
    expect(planReject(imported).fields).toEqual({ planned_session_id: null, match_status: "standalone" });
  });
});

/** Flux d'une seconde par point, FC donnée par une fonction du temps. */
const hrStreams = (seconds: number, hr: (t: number) => number) => ({
  time: Array.from({ length: seconds }, (_, t) => t),
  heartrate: Array.from({ length: seconds }, (_, t) => hr(t)),
});

describe("respect de l'intensité", () => {
  const z2 = { basis: "hr" as const, min: 116, max: 136 };

  it("juge le temps au-dessus du plafond, pas la moyenne", () => {
    // 20 min à 120 puis 20 min à 150 : moyenne 135, dans la cible, mais la moitié du temps au-dessus.
    const r = analyzeIntensity(hrStreams(2400 + 180, (t) => (t < 180 ? 90 : t < 1380 ? 120 : 150)), z2, true);
    expect(r).toMatchObject({ above_pct: 50, below_pct: 0, verdict: "too_hard" });
    expect(r!.mean).toBe(135);
  });

  it("écarte les 3 premières minutes de FC", () => {
    const r = analyzeIntensity(hrStreams(1800, (t) => (t < 180 ? 170 : 125)), z2, true);
    expect(r).toMatchObject({ above_pct: 0, verdict: "ok", analysed_s: 1619 });
  });

  it("tolère jusqu'à 15 % au-dessus du plafond", () => {
    const r = analyzeIntensity(hrStreams(180 + 1000, (t) => (t >= 180 + 860 ? 140 : 125)), z2, true);
    expect(r!.above_pct).toBeCloseTo(14, 0);
    expect(r!.verdict).toBe("ok");
  });

  it("séance facile : être sous la zone n'est pas un écart ; séance dure : si", () => {
    const low = hrStreams(1200, () => 100);
    expect(analyzeIntensity(low, z2, true)!.verdict).toBe("ok");
    expect(analyzeIntensity(low, z2, false)!.verdict).toBe("too_easy");
  });

  it("allure : plus rapide que la borne rapide = trop intense", () => {
    // 5:20/km (3,125 m/s) pour une cible 5:35–5:45 (335–345 s/km).
    const s = { time: Array.from({ length: 600 }, (_, t) => t), velocity_smooth: Array(600).fill(1000 / 320) };
    expect(analyzeIntensity(s, { basis: "pace", min: 335, max: 345 }, false)).toMatchObject({ above_pct: 100, verdict: "too_hard", mean: 320 });
  });

  it("ignore les arrêts et refuse de conclure sur trop peu de données", () => {
    const s = { ...hrStreams(600, () => 150), moving: Array.from({ length: 600 }, (_, t) => t > 550) };
    expect(analyzeIntensity(s, z2, true)).toBeNull();
  });
});
