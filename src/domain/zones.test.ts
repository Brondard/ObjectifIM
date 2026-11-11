import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/time";
import { retestsDue } from "./retests";
import { parseIntensity as parse } from "./session-structure";
import { judgementBases, resolveTargets, type TargetContext } from "./targets";
import { PRESETS, computeZones, metricAt, zoneModelAt, type Metric, type ZoneModel } from "./zones";

const metrics: Metric[] = [
  { kind: "hr_max", value: 191, measured_on: "2026-03-01" },
  { kind: "hr_max", value: 194, measured_on: "2026-09-12" },
  { kind: "hr_rest", value: 48, measured_on: "2026-01-01" },
  { kind: "ftp", value: 240, measured_on: "2026-10-01" },
  { kind: "vma", value: 18, measured_on: "2026-06-01" },
  { kind: "css", value: 105, measured_on: "2026-06-01" },
];

const model = (o: Partial<ZoneModel>): ZoneModel => ({
  discipline: "run", basis: "hr", method: "pct_hrmax", bounds: PRESETS.pct_hrmax, valid_from: "2026-01-01", ...o,
});

describe("repères historisés", () => {
  it("prend la dernière mesure à la date, pas la plus récente", () => {
    expect(metricAt(metrics, "hr_max", "2026-08-01")?.value).toBe(191);
    expect(metricAt(metrics, "hr_max", "2026-09-12")?.value).toBe(194);
    expect(metricAt(metrics, "hr_max", "2026-01-01")).toBeNull();
  });

  it("ignore les mesures supprimées", () => {
    expect(metricAt([...metrics, { kind: "hr_max", value: 200, measured_on: "2026-10-01", deleted_at: "x" }], "hr_max", "2026-11-01")?.value).toBe(194);
  });

  it("choisit le modèle de zones en vigueur", () => {
    const models = [model({}), model({ method: "karvonen", valid_from: "2026-10-01" })];
    expect(zoneModelAt(models, "run", "hr", "2026-09-30")?.method).toBe("pct_hrmax");
    expect(zoneModelAt(models, "run", "hr", "2026-10-01")?.method).toBe("karvonen");
    expect(zoneModelAt(models, "bike", "hr", "2026-10-01")).toBeNull();
  });
});

describe("computeZones", () => {
  it("% FC max, comme Samsung", () => {
    const r = computeZones(model({}), metrics, "2026-11-10");
    expect(r.ok && r.zones[1]).toEqual({ zone: 2, min: 116, max: 136 });
    expect(r.ok && r.references).toEqual([{ kind: "hr_max", value: 194, measured_on: "2026-09-12" }]);
  });

  it("une séance passée garde les zones de l'époque", () => {
    const r = computeZones(model({}), metrics, "2026-08-01");
    expect(r.ok && r.zones[1]).toEqual({ zone: 2, min: 115, max: 134 });
  });

  it("Karvonen tient compte de la FC de repos", () => {
    const r = computeZones(model({ method: "karvonen", bounds: PRESETS.karvonen }), metrics, "2026-11-10");
    // 48 + 0.6 × 146 = 135.6 ; 48 + 0.7 × 146 = 150.2
    expect(r.ok && r.zones[1]).toEqual({ zone: 2, min: 136, max: 150 });
  });

  it("puissance en % de FTP, zone 7 ouverte", () => {
    const r = computeZones(model({ discipline: "bike", basis: "power", method: "pct_ftp", bounds: PRESETS.pct_ftp }), metrics, "2026-11-10");
    expect(r.ok && r.zones[1]).toEqual({ zone: 2, min: 134, max: 180 });
    expect(r.ok && r.zones[6]).toEqual({ zone: 7, min: 362, max: null });
  });

  it("allure en % de VMA : bornes inversées, la plus rapide en min", () => {
    const r = computeZones(model({ basis: "pace", method: "pct_vma", bounds: PRESETS.pct_vma }), metrics, "2026-11-10");
    // 70 % de 18 km/h = 12,6 km/h → 286 s/km ; 80 % = 14,4 km/h → 250 s/km
    expect(r.ok && r.zones[1]).toEqual({ zone: 2, min: 250, max: 286 });
  });

  it("allure natation en % de la CSS", () => {
    const r = computeZones(model({ discipline: "swim", basis: "swim_pace", method: "pct_css", bounds: PRESETS.pct_css }), metrics, "2026-11-10");
    expect(r.ok && r.zones[0]).toEqual({ zone: 1, min: 124, max: null });
  });

  it("signale les repères manquants", () => {
    expect(computeZones(model({ method: "pct_lthr", bounds: PRESETS.pct_lthr }), metrics, "2026-11-10")).toEqual({ ok: false, missing: ["lthr"] });
  });

  it("applique les bornes forcées à la main", () => {
    const overrides = [{ zone: 2, min: 130, max: 145 }];
    expect(computeZones(model({ overrides }), [], "2026-11-10")).toEqual({ ok: true, zones: overrides, references: [] });
  });
});

const ctx: TargetContext = {
  models: [
    model({}),
    model({ basis: "pace", method: "pct_vma", bounds: PRESETS.pct_vma }),
    model({ discipline: "bike", basis: "power", method: "pct_ftp", bounds: PRESETS.pct_ftp }),
    model({ discipline: "bike", basis: "hr" }),
  ],
  metrics,
  rules: {
    defaultZoneByType: { endurance: 2, recovery: 1, short_reps: 5, threshold: 4, technique: null },
    judgementByType: { endurance: "hr", recovery: "hr", short_reps: "pace", threshold: "pace_then_hr" },
  },
};

describe("cibles d'une séance", () => {
  const session = { date: "2026-11-10", discipline: "run", session_type: "endurance" };

  it("footing : plafond en bpm absolus par type de séance quand la règle existe", () => {
    const withCeilings: TargetContext = { ...ctx, rules: { ...ctx.rules, easyCeilings: { byType: { endurance: 150, recovery: 150, long: 150 }, longEnd: 155, longEndFromPct: 67 } } };
    expect(resolveTargets(session, withCeilings, parse)).toEqual([
      expect.objectContaining({ status: "ok", basis: "hr", zone: null, min: null, max: 150, source: "ceiling" }),
    ]);
    expect(resolveTargets({ ...session, session_type: "long" }, withCeilings, parse)).toEqual([
      expect.objectContaining({ max: 150, max_end: 155, end_from_pct: 67, source: "ceiling" }),
    ]);
    // Une séance qualitative garde ses zones.
    expect(resolveTargets({ ...session, session_type: "threshold" }, withCeilings, parse)[0].source).toBe("default");
  });

  it("footing : FC zone 2 par défaut, en bpm", () => {
    expect(resolveTargets(session, ctx, parse)).toEqual([
      expect.objectContaining({ status: "ok", basis: "hr", zone: 2, min: 116, max: 136, source: "default", method: "pct_hrmax" }),
    ]);
  });

  it("répétitions courtes : allure uniquement ; seuil : allure puis FC", () => {
    expect(judgementBases({ ...session, session_type: "short_reps" }, ctx)).toEqual(["pace"]);
    expect(resolveTargets({ ...session, session_type: "threshold" }, ctx, parse).map((t) => t.basis)).toEqual(["pace", "hr"]);
  });

  it("vélo : puissance si FTP connue, sinon FC", () => {
    expect(judgementBases({ ...session, discipline: "bike" }, ctx)).toEqual(["power"]);
    expect(judgementBases({ ...session, discipline: "bike", date: "2026-09-01" }, ctx)).toEqual(["hr"]);
  });

  it("une cible saisie l'emporte sur le défaut", () => {
    const t = resolveTargets({ ...session, target_intensity: { basis: "pace", min: 330, max: 340 } }, ctx, parse);
    expect(t).toEqual([expect.objectContaining({ basis: "pace", min: 330, max: 340, source: "session" })]);
  });

  it("dit ce qui manque plutôt que d'inventer", () => {
    expect(resolveTargets({ ...session, discipline: "swim" }, ctx, parse)).toEqual([
      { status: "no_model", basis: "swim_pace", zone: 2, source: "default" },
    ]);
    expect(resolveTargets({ ...session, session_type: "technique" }, ctx, parse)).toEqual([]);
  });
});

describe("rappels de retest", () => {
  it("FTP au-delà de deux mois, allures après une course", () => {
    const races = [{ id: "r1", name: "Marathon", date: "2026-11-01", sport: "run" }];
    expect(retestsDue(metrics, races, localDate("2026-11-10")).map((r) => r.key)).toEqual(["race:r1"]);
    expect(retestsDue(metrics, [], localDate("2026-12-01")).map((r) => r.key)).toEqual(["ftp:2026-10-01"]);
    expect(retestsDue([], [], localDate("2026-12-01")).map((r) => r.key)).toEqual(["ftp:none"]);
  });
});

describe("repli sur le premier repère connu", () => {
  it("n'utilise une valeur postérieure que sur demande", () => {
    const later = [{ kind: "hr_max", value: 194, measured_on: "2026-11-10" }];
    expect(metricAt(later, "hr_max", "2026-10-01")).toBeNull();
    expect(metricAt(later, "hr_max", "2026-10-01", { earliest: true })?.value).toBe(194);
    const models = [model({ valid_from: "2026-11-10" }), model({ valid_from: "2026-12-01", method: "karvonen" })];
    expect(zoneModelAt(models, "run", "hr", "2026-10-01")).toBeNull();
    expect(zoneModelAt(models, "run", "hr", "2026-10-01", { earliest: true })?.method).toBe("pct_hrmax");
  });
});
