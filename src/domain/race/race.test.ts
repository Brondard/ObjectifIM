import { describe, expect, it } from "vitest";
import { courseProfile, elevationGain, findClimbs, haversine, parseGpx, repeatProfile, type GpxPoint } from "./gpx";
import { bikeSplits, DEFAULT_BIKE, DEFAULT_HR_STEPS, gradeFactor, hrCaps, runSplits, speedAt } from "./pacing";
import { DEFAULT_TIMELINE, carbLoading, distanceAtTime, fuelPlan, morningTimeline, raceReminders } from "./plan";

/** Parcours synthétique vers l'est, le long de l'équateur : 1° de longitude ≈ 111,2 km. */
function line(km: number, ele: (d_m: number) => number, every_m = 20): GpxPoint[] {
  const n = Math.round((km * 1000) / every_m);
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: 0, lon: (i * every_m) / 111195, ele: ele(i * every_m) }));
}

describe("GPX", () => {
  it("lit les points de trace et de route, avec ou sans altitude", () => {
    const xml = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="43.7" lon="7.26"><ele>3.5</ele></trkpt>
      <trkpt lon="7.27" lat="43.71"><ele>10</ele><time>x</time></trkpt>
      <trkpt lat="43.72" lon="7.28"/>
    </trkseg></trk><rte><rtept lat="1" lon="2"><ele>5</ele></rtept></rte></gpx>`;
    expect(parseGpx(xml)).toEqual([
      { lat: 43.7, lon: 7.26, ele: 3.5 }, { lat: 43.71, lon: 7.27, ele: 10 }, { lat: 43.72, lon: 7.28, ele: null }, { lat: 1, lon: 2, ele: 5 },
    ]);
  });

  it("mesure les distances", () => {
    expect(haversine({ lat: 0, lon: 0, ele: null }, { lat: 0, lon: 1, ele: null })).toBeCloseTo(111195, -1);
  });

  it("le seuil anti-bruit empêche le bruit GPS de gonfler le dénivelé", () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 2 : -2));
    expect(elevationGain(noisy, 5)).toEqual({ gain: 0, loss: 0 });
    expect(elevationGain([0, 10, 20, 15, 30], 5)).toEqual({ gain: 35, loss: 5 });
  });

  it("profil : distance, dénivelé, montée notable", () => {
    // 2 km plats, montée de 100 m sur 1 km, 2 km plats.
    const p = courseProfile(line(5, (d) => (d < 2000 ? 0 : d < 3000 ? (d - 2000) / 10 : 100)));
    expect(p.distance_m).toBeCloseTo(5000, -1);
    expect(p.gain_m).toBeGreaterThan(90);
    expect(p.gain_m).toBeLessThan(105);
    expect(p.climbs).toHaveLength(1);
    expect(p.climbs[0].grade_pct).toBeGreaterThan(8);
    expect(p.samples[0]).toEqual({ d: 0, ele: 0 });
  });

  it("repère plusieurs montées et ignore les petites bosses", () => {
    const s = [0, 5, 0, 40, 20, 70, 65].map((ele, i) => ({ d: i * 500, ele }));
    expect(findClimbs(s, 30, 400).map((c) => c.gain_m)).toEqual([40, 50]);
  });
});

describe("plan de passage course à pied", () => {
  it("à plat, allure constante qui tombe sur le temps cible", () => {
    const p = courseProfile(line(10, () => 0));
    const r = runSplits(p, 3000);
    expect(r.flatPace_s_km).toBe(300);
    expect(r.splits).toHaveLength(10);
    expect(r.splits.at(-1)!.cumulative_s).toBeCloseTo(3000, -1);
    expect(r.splits.every((s) => Math.abs(s.delta) <= 1)).toBe(true);
  });

  it("plus lent en montée, plus vite en descente, total respecté", () => {
    const p = courseProfile(line(4, (d) => (d < 2000 ? d * 0.05 : 100 - (d - 2000) * 0.05)));
    const r = runSplits(p, 1440);
    expect(r.splits[0].pace_s_km).toBeGreaterThan(r.flatPace_s_km);
    expect(r.splits[3].pace_s_km).toBeLessThan(r.flatPace_s_km);
    expect(Math.abs(r.splits.at(-1)!.cumulative_s - 1440)).toBeLessThanOrEqual(2);
  });

  it("le gain en descente est borné", () => {
    expect(gradeFactor(0)).toBe(1);
    expect(gradeFactor(-0.3)).toBe(0.8);
    expect(gradeFactor(0.1)).toBeGreaterThan(1.4);
  });

  it("plafonds de FC par tronçon", () => {
    const r = runSplits(courseProfile(line(10, () => 0)), 3000);
    const caps = hrCaps(r.splits, 173, DEFAULT_HR_STEPS);
    expect(caps[0].cap_bpm).toBe(156);
    expect(caps[6].cap_bpm).toBe(163);
    expect(caps[9].cap_bpm).toBeNull();
  });
});

describe("plan de passage vélo", () => {
  const params = { ...DEFAULT_BIKE, mass_kg: 89 };

  it("vitesse cohérente : ~35 km/h à 200 W à plat, lent en côte, bornée en descente", () => {
    expect(speedAt(200, 0, params) * 3.6).toBeGreaterThan(32);
    expect(speedAt(200, 0, params) * 3.6).toBeLessThan(38);
    expect(speedAt(200, 0.08, params) * 3.6).toBeLessThan(14);
    expect(speedAt(200, -0.1, params) * 3.6).toBe(65);
  });

  it("puissance constante qui tient le temps cible", () => {
    const p = courseProfile(line(40, (d) => (d < 20000 ? d * 0.02 : 400 - (d - 20000) * 0.02)), { step_m: 200 });
    const r = bikeSplits(p, 4800, params);
    expect(Math.abs(r.splits.at(-1)!.cumulative_s - 4800)).toBeLessThanOrEqual(3);
    expect(r.splits[0].speed_kmh!).toBeLessThan(r.splits.at(-1)!.speed_kmh!);
    expect(r.power_w).toBeGreaterThan(100);
  });
});

describe("autour de la course", () => {
  it("plan de ravitaillement par produit et position sur le parcours", () => {
    const splits = [{ at_m: 10000, cumulative_s: 3000 }, { at_m: 20000, cumulative_s: 6000 }];
    const plan = fuelPlan(6000, { carbs_per_h: 60, items: [{ product_id: "g", every_min: 30 }] }, [{ id: "g", name: "Gel", carbs_g: 30 }], distanceAtTime(splits));
    expect(plan.events.map((e) => e.t_s)).toEqual([1800, 3600]);
    expect(plan.events[0].at_m).toBe(6000);
    expect(plan).toMatchObject({ total_g: 60, target_g: 100 });
  });

  it("sans produit : prise de 25 g calée sur l'objectif horaire", () => {
    const plan = fuelPlan(3 * 3600, { carbs_per_h: 75, items: [] }, []);
    expect(plan.events[0].t_s).toBe(1200);
    expect(plan.events.length).toBeGreaterThanOrEqual(8);
  });

  it("charge glucidique et déroulé du matin", () => {
    expect(carbLoading(80)).toBe(720);
    const t = morningTimeline("07:00", DEFAULT_TIMELINE);
    expect(t[0]).toMatchObject({ label: "Réveil", time: "03:30" });
    expect(t.at(-1)).toMatchObject({ time: "06:50" });
    expect(morningTimeline("00:30", [{ offset_min: -60, label: "x" }])[0].time).toBe("23:30");
  });

  it("rappels : compte à rebours, glucides J−3, checklist la veille, débrief à J+2", () => {
    const races = [
      { id: "a", name: "Marathon", date: "2026-11-13", priority: "A" },
      { id: "b", name: "10 km", date: "2026-11-08", priority: "C", debrief: null },
      { id: "c", name: "Semi", date: "2026-11-01", priority: "B", debrief: { worked: "allure" } },
    ];
    expect(raceReminders(races, "2026-11-12", 80).map((r) => r.key)).toEqual(["cd:a", "carbs:a", "check:a", "debrief:b"]);
    expect(raceReminders(races, "2026-11-12", 80)[1].message).toMatch(/720 g/);
  });
});

describe("parcours en boucles", () => {
  it("répète une boucle jusqu'à la distance de la course", async () => {
    const loop = courseProfile(line(9, (d) => (d < 4500 ? d / 100 : 90 - (d - 4500) / 100)));
    const full = repeatProfile(loop, 21097);
    expect(full.distance_m).toBe(21097);
    expect(full.samples.at(-1)!.d).toBeLessThanOrEqual(21097);
    expect(full.samples.at(-1)!.d).toBeGreaterThan(20900);
    expect(full.gain_m).toBeGreaterThan(loop.gain_m * 2);
    expect(runSplits(full, 6300).splits).toHaveLength(22);
  });
});
