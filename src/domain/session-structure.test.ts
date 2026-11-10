import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStructure, flattenSteps, structureTotals } from "./session-structure";
import { buildJsonSchemas } from "./json-schemas";

describe("SessionStructure", () => {
  it("représente « 45 min en Z2 »", () => {
    const s = SessionStructure.parse({
      version: 1,
      steps: [{ kind: "work", duration_s: 2700, intensity: { basis: "hr", zone: 2 } }],
    });
    expect(structureTotals(s).duration_s).toBe(2700);
  });

  it("représente « échauffement + 2 × (200/600/200) récup 36\"/1'/35\" + 400 »", () => {
    const s = SessionStructure.parse({
      version: 1,
      steps: [
        { kind: "warmup", note: "échauffement libre" },
        {
          kind: "repeat",
          times: 2,
          steps: [
            { kind: "work", distance_m: 200, intensity: { basis: "pace", min: 200, max: 205 } },
            { kind: "recovery", duration_s: 36 },
            { kind: "work", distance_m: 600, intensity: { basis: "pace", min: 220, max: 225 } },
            { kind: "recovery", duration_s: 60 },
            { kind: "work", distance_m: 200, intensity: { basis: "pace", min: 200, max: 205 } },
            { kind: "recovery", duration_s: 35 },
          ],
        },
        { kind: "work", distance_m: 400 },
      ],
    });
    expect(flattenSteps(s.steps)).toHaveLength(1 + 2 * 6 + 1);
    expect(structureTotals(s)).toMatchObject({ work_distance_m: 2400, duration_s: 262 });
  });

  it("accepte les répétitions imbriquées", () => {
    const s = SessionStructure.parse({
      version: 1,
      steps: [
        {
          kind: "repeat",
          times: 3,
          steps: [{ kind: "repeat", times: 4, steps: [{ kind: "work", distance_m: 100 }] }],
        },
      ],
    });
    expect(structureTotals(s).distance_m).toBe(1200);
  });

  it("refuse une étape avec durée et distance, une plage inversée, une répétition vide", () => {
    const bad = [
      { kind: "work", duration_s: 60, distance_m: 200 },
      { kind: "work", intensity: { basis: "pace", min: 300, max: 290 } },
      { kind: "repeat", times: 2, steps: [] },
    ];
    for (const step of bad) {
      expect(SessionStructure.safeParse({ version: 1, steps: [step] }).success).toBe(false);
    }
  });
});

describe("JSON Schema publié", () => {
  it("est à jour avec Zod (sinon : npm run gen:schemas)", () => {
    for (const [file, schema] of Object.entries(buildJsonSchemas())) {
      const committed = JSON.parse(readFileSync(join(process.cwd(), "schemas", file), "utf8"));
      expect(committed).toEqual(schema);
    }
  });
});
