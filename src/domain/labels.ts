/** Libellés français des valeurs énumérées en base (domaines Postgres). */

export const DISCIPLINES = {
  swim: "Natation",
  bike: "Vélo",
  run: "Course à pied",
  strength: "Musculation",
  other: "Autre",
} as const;

export const SESSION_TYPES = {
  endurance: "Endurance",
  long: "Sortie longue",
  recovery: "Récupération",
  tempo: "Tempo",
  threshold: "Seuil",
  vo2: "VO2max",
  short_reps: "Répétitions courtes",
  race_pace: "Allure spécifique",
  technique: "Technique",
  strength_push: "Muscu Push",
  strength_pull: "Muscu Pull",
  strength_legs: "Muscu Jambes",
  strength_core: "Gainage",
  race: "Course",
  other: "Autre",
} as const;

export const PRIORITIES = {
  key: "Clé",
  secondary: "Secondaire",
  optional: "Optionnelle",
} as const;

export const PHASE_TYPES = {
  base: "Base",
  build: "Construction",
  specific: "Spécifique",
  taper: "Affûtage",
  recovery: "Récupération",
  return: "Reprise",
} as const;

export const PLANNED_STATUSES = {
  planned: "Prévue",
  completed: "Faite",
  partial: "Partielle",
  skipped_choice: "Manquée (choix)",
  skipped_life: "Manquée (vie)",
  skipped_injury: "Manquée (blessure)",
} as const;

export type Discipline = keyof typeof DISCIPLINES;
export type SessionType = keyof typeof SESSION_TYPES;
export type Priority = keyof typeof PRIORITIES;
export type PhaseType = keyof typeof PHASE_TYPES;

export const keysOf = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
