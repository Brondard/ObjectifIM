/**
 * Structure détaillée d'une séance (colonne JSONB `structure`).
 * Source unique : le JSON Schema de `schemas/` est généré depuis ce fichier (npm run gen:schemas).
 *
 * Unités : secondes, mètres ; allure en s/km, allure natation en s/100 m, puissance en W, FC en bpm.
 * Pour une plage d'allure, `min` est la borne la plus rapide (le plus petit nombre de secondes).
 */
import { z } from "zod";

export const STRUCTURE_VERSION = 1;

const zoneBasis = z.enum(["hr", "pace", "power", "swim_pace"]);

export const IntensityZone = z.object({
  basis: zoneBasis,
  zone: z.number().int().min(1).max(7),
});

export const IntensityRange = z
  .object({
    basis: z.enum(["hr", "pace", "power", "swim_pace", "rpe"]),
    min: z.number().positive(),
    max: z.number().positive(),
  })
  .refine((r) => r.min <= r.max, { message: "min doit être ≤ max" });

export const Intensity = z.union([IntensityZone, IntensityRange]);

export const Step = z
  .object({
    kind: z.enum(["warmup", "work", "recovery", "cooldown", "rest"]),
    duration_s: z.number().int().positive().optional(),
    distance_m: z.number().int().positive().optional(),
    intensity: Intensity.optional(),
    note: z.string().max(500).optional(),
  })
  .refine((s) => s.duration_s === undefined || s.distance_m === undefined, {
    message: "Une étape porte une durée ou une distance, pas les deux",
  });

export const Repeat = z.object({
  kind: z.literal("repeat"),
  times: z.number().int().min(1).max(100),
  get steps() {
    return z.array(z.union([Step, Repeat])).min(1);
  },
});

export const SessionStructure = z.object({
  version: z.literal(STRUCTURE_VERSION),
  steps: z.array(z.union([Step, Repeat])),
});

export type Intensity = z.infer<typeof Intensity>;
export type Step = z.infer<typeof Step>;
export type Repeat = z.infer<typeof Repeat>;
export type SessionStructure = z.infer<typeof SessionStructure>;

/** Lit une cible d'intensité stockée en JSONB ; null si absente ou invalide. */
export function parseIntensity(value: unknown): Intensity | null {
  const r = Intensity.safeParse(value);
  return r.success ? r.data : null;
}

/** Déplie les répétitions en une liste linéaire d'étapes, dans l'ordre d'exécution. */
export function flattenSteps(nodes: (Step | Repeat)[]): Step[] {
  return nodes.flatMap((node) =>
    node.kind === "repeat"
      ? Array.from({ length: node.times }, () => flattenSteps(node.steps)).flat()
      : [node],
  );
}

/** Totaux explicites de la structure (les étapes sans durée ni distance ne comptent pas). */
export function structureTotals(structure: SessionStructure) {
  const steps = flattenSteps(structure.steps);
  const sum = (pick: (s: Step) => number | undefined, filter: (s: Step) => boolean = () => true) =>
    steps.filter(filter).reduce((acc, s) => acc + (pick(s) ?? 0), 0);
  return {
    duration_s: sum((s) => s.duration_s),
    distance_m: sum((s) => s.distance_m),
    work_duration_s: sum((s) => s.duration_s, (s) => s.kind === "work"),
    work_distance_m: sum((s) => s.distance_m, (s) => s.kind === "work"),
  };
}
