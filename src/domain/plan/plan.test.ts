import { describe, expect, it } from "vitest";
import { parseCsvBlock, parseJsonBlock, parseMarkdownBlock, planImport, sessionFields, type ExistingSession } from "./block";
import { applyPattern, backwardPhases, bulkTargets, planBulk, weeksUntil, type PatternItem } from "./build";
import { buildExport } from "./export";

const block = {
  format_version: "1",
  period: { start: "2026-11-16", end: "2026-11-22" },
  phase: { type: "base", name: "Base 2", objectives: "Volume aérobie" },
  sessions: [
    { key: "lun-nat", date: "2026-11-16", local_time: "07:30", discipline: "swim", session_type: "technique", duration_min: 45 },
    { date: "2026-11-18", discipline: "run", session_type: "threshold", priority: "key", title: "Club", duration_min: 60 },
    { date: "2026-11-21", discipline: "run", session_type: "long", priority: "key", duration_min: 100,
      target_intensity: { basis: "hr", zone: 2 } },
  ],
};

describe("format d'import", () => {
  it("valide un bloc JSON conforme au contrat", () => {
    const r = parseJsonBlock(JSON.stringify(block));
    expect(r.ok).toBe(true);
    expect(r.ok && r.block.sessions[0].priority).toBe("secondary");
  });

  it("dit précisément ce qui ne va pas", () => {
    const bad = { ...block, format_version: "2", sessions: [{ date: "2026-12-01", discipline: "ski", session_type: "endurance" }] };
    const r = parseJsonBlock(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toMatch(/format_version/);
    expect(!r.ok && r.errors.join(" ")).toMatch(/discipline/);
    expect(parseJsonBlock("{ pas du json").ok).toBe(false);
  });

  it("CSV et markdown sommaires, avec des alias français", () => {
    const csv = parseCsvBlock("date;discipline;type;durée;titre;priorité\n2026-11-16;natation;technique;45;Éducatifs\n2026-11-21;cap;sl;1h40;Sortie longue;clé");
    expect(csv.ok && csv.block.sessions.map((s) => [s.discipline, s.session_type, s.duration_min, s.priority])).toEqual([
      ["swim", "technique", 45, "secondary"], ["run", "long", 100, "key"],
    ]);
    expect(csv.ok && csv.block.period).toEqual({ start: "2026-11-16", end: "2026-11-21" });
    const md = parseMarkdownBlock("# Semaine\n- 2026-11-17 · vélo · endurance · 60 min · Home trainer · 18:30\n- 2026-11-18 | run | seuil | 50");
    expect(md.ok && md.block.sessions.map((s) => [s.discipline, s.session_type, s.local_time])).toEqual([["bike", "endurance", "18:30"], ["run", "threshold", undefined]]);
  });
});

describe("import idempotent", () => {
  const parsed = parseJsonBlock(JSON.stringify(block));
  const b = parsed.ok ? parsed.block : (null as never);
  let n = 0;
  const id = () => `new${++n}`;

  it("premier import : tout est créé, les séances à la main de la période sont remplacées", () => {
    const existing: ExistingSession[] = [
      { id: "m1", date: "2026-11-17", discipline: "run", status: "planned", import_key: null, title: "Footing ajouté" },
      { id: "m2", date: "2026-11-19", discipline: "swim", status: "completed", import_key: null, title: "Nage faite" },
      { id: "m3", date: "2026-11-25", discipline: "run", status: "planned", import_key: null, title: "Hors période" },
    ];
    const plan = planImport(b, existing, new Set(), id);
    expect(plan.creates).toHaveLength(3);
    expect(plan.deletes.map((d) => d.id)).toEqual(["m1"]);
    expect(plan.kept.map((d) => d.id)).toEqual(["m2"]);
  });

  it("réimport corrigé : mise à jour sans doublon, réalisé jamais touché", () => {
    const existing: ExistingSession[] = [
      { id: "a", date: "2026-11-16", discipline: "swim", status: "planned", import_key: "import:lun-nat", title: null },
      { id: "b", date: "2026-11-18", discipline: "run", status: "completed", import_key: "import:2026-11-18:run:1", title: "Club" },
      { id: "c", date: "2026-11-21", discipline: "run", status: "planned", import_key: "import:2026-11-21:run:1", title: null },
      { id: "d", date: "2026-11-20", discipline: "bike", status: "planned", import_key: "import:retiree", title: null },
    ];
    const plan = planImport(b, existing, new Set(["c"]), id);
    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((u) => u.id)).toEqual(["a"]);
    expect(plan.skipped.map((s) => s.key)).toEqual(["import:2026-11-18:run:1", "import:2026-11-21:run:1"]);
    expect(plan.deletes.map((d) => d.id)).toEqual(["d"]);
  });

  it("champs d'une séance importée", () => {
    expect(sessionFields(b.sessions[2], "k", "batch")).toMatchObject({
      target_duration_s: 6000, priority: "key", source: "import", import_key: "k", import_batch_id: "batch",
      target_intensity: { basis: "hr", zone: 2 }, status: "planned",
    });
  });
});

describe("motifs de semaine", () => {
  const items: PatternItem[] = [
    { id: "sl", weekday: 6, local_time: "09:00", discipline: "run", session_type: "long", priority: "key", duration_s: 5400, distance_m: null, target_intensity: null, structure: null, instructions: null, progression: { step_min: 10, every_weeks: 1, max_min: 120 } },
    { id: "nat", weekday: 1, local_time: "07:30", discipline: "swim", session_type: "technique", priority: "secondary", duration_s: 2700, distance_m: null, target_intensity: null, structure: null, instructions: null },
  ];

  it("progression de la sortie longue, semaine allégée à 60 % toutes les 4 semaines", () => {
    const { block: b, weeks } = applyPattern(items, { from: "2026-11-16", to: "2026-12-20", deloadEvery: 4, deloadRatio: 0.6 });
    const long = b.sessions.filter((s) => s.session_type === "long").map((s) => s.duration_min);
    expect(long).toEqual([90, 100, 110, 70, 120]);
    expect(weeks.map((w) => w.deload)).toEqual([false, false, false, true, false]);
    expect(b.sessions.find((s) => s.date === "2026-12-12")?.priority).toBe("secondary");
    expect(b.sessions.every((s) => s.key)).toBe(true);
  });

  it("réappliquer le même motif produit les mêmes clés : remplacement, pas de doublon", () => {
    const a = applyPattern(items, { from: "2026-11-16", to: "2026-11-29", deloadEvery: 0, deloadRatio: 1 }).block;
    const existing = a.sessions.map((s, i) => ({ id: `e${i}`, date: s.date, discipline: s.discipline, status: "planned", import_key: `motif:${s.key}`, title: null }));
    const plan = planImport(a, existing, new Set(), () => "x", "motif");
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(a.sessions.length);
  });
});

describe("modification en masse", () => {
  const sessions = [
    { id: "1", date: "2026-11-22", discipline: "bike", session_type: "endurance", status: "planned", target_duration_s: 7200, target_distance_m: 60000 },
    { id: "2", date: "2026-11-29", discipline: "bike", session_type: "endurance", status: "completed", target_duration_s: 7200 },
    { id: "3", date: "2026-11-25", discipline: "bike", session_type: "endurance", status: "planned", target_duration_s: 3600 },
    { id: "4", date: "2026-12-06", discipline: "bike", session_type: "long", status: "planned", target_duration_s: 10800 },
  ];

  it("filtre : vélo du dimanche, non réalisé", () => {
    expect(bulkTargets(sessions, { from: "2026-11-16", to: "2026-12-31", disciplines: ["bike"], weekdays: [7] }).map((s) => s.id)).toEqual(["1", "4"]);
  });

  it("home trainer, facteur de volume, décalage de 7 jours avec date d'origine", () => {
    const t = bulkTargets(sessions, { from: "2026-11-16", to: "2026-12-31", weekdays: [7] });
    expect(planBulk(t, { kind: "set", fields: { indoor: true } })[0].fields).toEqual({ indoor: true });
    expect(planBulk(t, { kind: "scale", factor: 0.8 })[0].fields).toEqual({ target_duration_s: 5700, target_distance_m: 48000 });
    expect(planBulk(t, { kind: "shift", days: 7 })[0].fields).toEqual({ date: "2026-11-29", original_date: "2026-11-22" });
  });
});

describe("planification à rebours", () => {
  it("Ironman de Nice : 39 semaines, phases contiguës, affûtage la semaine de course", () => {
    const phases = backwardPhases("2027-09-12", 39);
    expect(phases.map((p) => [p.type, p.weeks])).toEqual([["base", 14], ["build", 12], ["specific", 10], ["taper", 3]]);
    expect(phases[0].start_date).toBe("2026-12-14");
    expect(phases.at(-1)!.end_date).toBe("2027-09-12");
    for (let i = 1; i < phases.length; i++) expect(phases[i].start_date > phases[i - 1].end_date).toBe(true);
    expect(weeksUntil("2026-12-14", "2027-09-12")).toBe(39);
  });
});

describe("export d'une période", () => {
  it("assiduité, volume, ressentis et notes, pour construire le bloc suivant", () => {
    const planned = [
      { id: "p1", date: "2026-11-16", discipline: "run", session_type: "endurance", priority: "secondary", title: "Footing", skip_note: null, status: "completed", target_duration_s: 2700, target_distance_m: null, deleted_at: null },
      { id: "p2", date: "2026-11-18", discipline: "run", session_type: "threshold", priority: "key", title: "Club", skip_note: "réunion", status: "skipped_life", target_duration_s: 3600, target_distance_m: null, deleted_at: null },
    ];
    const completed = [{ id: "c1", local_date: "2026-11-16", discipline: "run", planned_session_id: "p1", elapsed_s: 2800, moving_s: 2700, distance_m: 8000, rpe: 3, feeling: "facile", analysis: null, name: "Footing", deleted_at: null }];
    const out = buildExport({
      from: "2026-11-16", to: "2026-11-22", generatedAt: "2026-11-23T08:00:00Z", planned, completed, completedForLoad: completed,
      niggles: [], niggleEntries: [], notes: [{ date: "2026-11-18", note: "Grosse semaine au travail" }], loadParams: { defaultRpe: 4, rpeByType: {} },
    });
    expect(out.adherence.skip_reasons).toEqual({ choice: 0, life: 1, injury: 0 });
    expect(out.volume).toMatchObject({ planned_min: 105, done_min: 45 });
    expect(out.sessions[0]).toMatchObject({ rpe: 3, feeling: "facile", done_min: 45 });
    expect(out.sessions[1]).toMatchObject({ status: "skipped_life", skip_note: "réunion" });
    expect(out.day_notes).toEqual([{ date: "2026-11-18", note: "Grosse semaine au travail" }]);
  });
});
