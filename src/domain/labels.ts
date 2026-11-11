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

/** Types proposés par discipline à la saisie (la base accepte toute combinaison). */
export const TYPES_BY_DISCIPLINE: Record<keyof typeof DISCIPLINES, (keyof typeof SESSION_TYPES)[]> = {
  run: ["endurance", "long", "recovery", "tempo", "threshold", "vo2", "short_reps", "race_pace", "race"],
  bike: ["endurance", "long", "recovery", "tempo", "threshold", "vo2", "race_pace", "race"],
  swim: ["endurance", "technique", "threshold", "vo2", "short_reps", "recovery", "race"],
  strength: ["strength_push", "strength_pull", "strength_legs", "strength_core"],
  other: ["other", "endurance", "recovery"],
};

export const SKIP_REASONS = {
  choice: "Choix",
  life: "Vie",
  injury: "Blessure",
} as const;

/** Repères physiologiques : libellé et unité de saisie. */
export const METRICS = {
  hr_max: { label: "FC max", unit: "bpm" },
  hr_rest: { label: "FC de repos", unit: "bpm" },
  lthr: { label: "FC au seuil", unit: "bpm" },
  vma: { label: "VMA", unit: "km/h" },
  threshold_pace: { label: "Allure seuil", unit: "min/km" },
  ftp: { label: "FTP", unit: "W" },
  css: { label: "Allure seuil natation (CSS)", unit: "min/100 m" },
  vo2max: { label: "VO2max", unit: "ml/kg/min" },
  weight: { label: "Poids", unit: "kg" },
} as const;

export const METHODS = {
  pct_hrmax: "% FC max (comme Samsung)",
  karvonen: "Karvonen (% FC de réserve)",
  pct_lthr: "% FC au seuil",
  pct_ftp: "% FTP",
  pct_vma: "% VMA",
  pct_threshold_pace: "% allure seuil",
  pct_css: "% CSS",
} as const;

export const BASES = {
  hr: "FC",
  pace: "Allure",
  power: "Puissance",
  swim_pace: "Allure natation",
} as const;

/** Grandeurs de zones possibles par discipline, et méthodes possibles par grandeur. */
export const ZONE_SETUPS: { discipline: "run" | "bike" | "swim"; basis: keyof typeof BASES; methods: (keyof typeof METHODS)[] }[] = [
  { discipline: "run", basis: "hr", methods: ["pct_hrmax", "karvonen", "pct_lthr"] },
  { discipline: "run", basis: "pace", methods: ["pct_vma", "pct_threshold_pace"] },
  { discipline: "bike", basis: "power", methods: ["pct_ftp"] },
  { discipline: "bike", basis: "hr", methods: ["pct_hrmax", "karvonen", "pct_lthr"] },
  { discipline: "swim", basis: "swim_pace", methods: ["pct_css"] },
];

export const SPORTS = { run: "Course à pied", tri: "Triathlon", bike: "Vélo", swim: "Natation", other: "Autre" } as const;
export const FORMATS = {
  "5k": "5 km", "10k": "10 km", half: "Semi-marathon", marathon: "Marathon", trail: "Trail",
  sprint: "Triathlon S", olympic: "Triathlon M (olympique)", l: "Triathlon L", "70.3": "70.3", "140.6": "Ironman (140.6)", other: "Autre",
} as const;
/** Distance par défaut d'un format (course à pied ou total triathlon), en mètres. */
export const FORMAT_DISTANCE: Partial<Record<keyof typeof FORMATS, number>> = {
  "5k": 5000, "10k": 10000, half: 21097, marathon: 42195,
};

/** Distances par portion d'un triathlon (m), modifiables dans le plan : le format L varie selon les courses. */
export const TRI_LEGS: Partial<Record<keyof typeof FORMATS, { swim: number; bike: number; run: number }>> = {
  sprint: { swim: 750, bike: 20000, run: 5000 },
  olympic: { swim: 1500, bike: 40000, run: 10000 },
  l: { swim: 3000, bike: 80000, run: 30000 },
  "70.3": { swim: 1900, bike: 90000, run: 21097 },
  "140.6": { swim: 3800, bike: 180000, run: 42195 },
};

/** Part indicative de chaque portion dans le temps total d'un triathlon long (transitions comprises). */
export const TRI_TIME_SHARE = { swim: 0.12, bike: 0.52, run: 0.34, transitions: 0.02 };

export type Discipline = keyof typeof DISCIPLINES;
export type SessionType = keyof typeof SESSION_TYPES;
export type Priority = keyof typeof PRIORITIES;
export type PhaseType = keyof typeof PHASE_TYPES;

export const keysOf = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
