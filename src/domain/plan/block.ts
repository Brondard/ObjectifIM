/**
 * Import de blocs d'entraînement par fichier : le format est un contrat (version, JSON Schema publié
 * dans schemas/, validation Zod à l'import). L'import est idempotent :
 *   - le fichier fait foi sur sa période ;
 *   - une séance dont la clé existe déjà est mise à jour (même identifiant : liens et historique gardés) ;
 *   - une séance prévue non réalisée de la période, absente du fichier, est supprimée, même si elle avait
 *     été ajoutée à la main ;
 *   - une séance réalisée, partielle, manquée ou rattachée à un réalisé n'est jamais touchée.
 */
import { z } from "zod";
import { isLocalDate } from "@/lib/time";
import { DISCIPLINES, PHASE_TYPES, PRIORITIES, SESSION_TYPES, keysOf } from "../labels";
import { Intensity, SessionStructure } from "../session-structure";

export const BLOCK_FORMAT_VERSION = "1";

const date = z.string().refine(isLocalDate, "date AAAA-MM-JJ attendue");
const time = z.string().regex(/^\d{2}:\d{2}$/, "heure HH:MM attendue");

export const BlockSession = z
  .object({
    key: z.string().min(1).max(120).optional(),
    date,
    local_time: time.optional(),
    discipline: z.enum(keysOf(DISCIPLINES)),
    session_type: z.enum(keysOf(SESSION_TYPES)),
    priority: z.enum(keysOf(PRIORITIES)).default("secondary"),
    title: z.string().max(120).optional(),
    duration_min: z.number().positive().max(24 * 60).optional(),
    distance_m: z.number().int().positive().optional(),
    target_intensity: Intensity.optional(),
    structure: SessionStructure.optional(),
    instructions: z.string().max(4000).optional(),
    indoor: z.boolean().optional(),
  })
  .refine((s) => s.duration_min != null || s.structure != null, { message: "durée (duration_min) ou structure attendue" });

export const PlanBlock = z
  .object({
    format_version: z.literal(BLOCK_FORMAT_VERSION),
    period: z.object({ start: date, end: date }),
    phase: z
      .object({
        type: z.enum(keysOf(PHASE_TYPES)),
        name: z.string().min(1).max(120),
        objectives: z.string().max(4000).optional(),
        targets: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    sessions: z.array(BlockSession),
  })
  .refine((b) => b.period.end >= b.period.start, { message: "period.end avant period.start" })
  .refine((b) => b.sessions.every((s) => s.date >= b.period.start && s.date <= b.period.end), {
    message: "une séance tombe hors de la période déclarée",
  });

export type BlockSession = z.infer<typeof BlockSession>;
export type PlanBlock = z.infer<typeof PlanBlock>;

export type ParseResult = { ok: true; block: PlanBlock } | { ok: false; errors: string[] };

function fromZod(r: ReturnType<typeof PlanBlock.safeParse>): ParseResult {
  if (r.success) return { ok: true, block: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "fichier"} : ${i.message}`) };
}

export function parseJsonBlock(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON illisible : ${e instanceof Error ? e.message : e}`] };
  }
  return fromZod(PlanBlock.safeParse(raw));
}

// ─── Formats sommaires ─────────────────────────────────────────────────────

const DISCIPLINE_ALIASES: Record<string, string> = {
  run: "run", cap: "run", course: "run", "course à pied": "run", swim: "swim", natation: "swim", nat: "swim",
  bike: "bike", velo: "bike", vélo: "bike", strength: "strength", muscu: "strength", musculation: "strength", other: "other", autre: "other",
};
const TYPE_ALIASES: Record<string, string> = Object.fromEntries([
  ...Object.keys(SESSION_TYPES).map((k) => [k, k]),
  ...Object.entries(SESSION_TYPES).map(([k, v]) => [v.toLowerCase(), k]),
  ["footing", "endurance"], ["sl", "long"], ["vma", "vo2"], ["seuil", "threshold"], ["recup", "recovery"], ["récup", "recovery"],
]);
const PRIORITY_ALIASES: Record<string, string> = { key: "key", clé: "key", cle: "key", secondary: "secondary", secondaire: "secondary", optional: "optional", optionnelle: "optional" };

function looseSession(cells: string[]): Record<string, unknown> {
  const [d, disc, type, dur, ...rest] = cells.map((c) => c.trim());
  const minutes = Number(/^(\d+(?:[.,]\d+)?)/.exec(dur ?? "")?.[1]?.replace(",", "."));
  const hm = /^(\d+)\s*h\s*(\d{0,2})/.exec(dur ?? "");
  const priority = rest.find((r) => PRIORITY_ALIASES[r.toLowerCase()]);
  const title = rest.find((r) => r && r !== priority && !/^\d{2}:\d{2}$/.test(r));
  const t = rest.find((r) => /^\d{2}:\d{2}$/.test(r));
  return {
    date: d,
    discipline: DISCIPLINE_ALIASES[(disc ?? "").toLowerCase()] ?? disc,
    session_type: TYPE_ALIASES[(type ?? "").toLowerCase()] ?? type,
    duration_min: hm ? Number(hm[1]) * 60 + Number(hm[2] || 0) : Number.isFinite(minutes) ? minutes : undefined,
    priority: priority ? PRIORITY_ALIASES[priority.toLowerCase()] : undefined,
    title: title || undefined,
    local_time: t,
  };
}

function wrap(sessions: Record<string, unknown>[]): ParseResult {
  const dates = sessions.map((s) => String(s.date)).filter(isLocalDate).sort();
  if (!dates.length) return { ok: false, errors: ["aucune séance lisible"] };
  return fromZod(PlanBlock.safeParse({ format_version: BLOCK_FORMAT_VERSION, period: { start: dates[0], end: dates.at(-1) }, sessions }));
}

/** CSV : date;discipline;type;durée;titre;priorité;heure (séparateur ; ou ,), ligne d'en-tête facultative. */
export function parseCsvBlock(text: string): ParseResult {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = rows[0]?.includes(";") ? ";" : ",";
  const data = rows.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r));
  return wrap(data.map((r) => looseSession(r.split(sep))));
}

/** Markdown : une séance par ligne de liste, champs séparés par « · » ou « | ». */
export function parseMarkdownBlock(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l));
  return wrap(lines.map((l) => looseSession(l.split(/\s*[·|]\s*/))));
}

export function parseAnyBlock(fileName: string, text: string): ParseResult {
  const t = text.trimStart();
  if (fileName.endsWith(".json") || t.startsWith("{")) return parseJsonBlock(text);
  if (fileName.endsWith(".csv")) return parseCsvBlock(text);
  return parseMarkdownBlock(text);
}

// ─── Plan d'import ─────────────────────────────────────────────────────────

export type ExistingSession = {
  id: string;
  date: string;
  discipline: string;
  status: string;
  import_key: string | null;
  title: string | null;
  deleted_at?: string | null;
};

/** Clé stable d'une séance : celle du fichier, sinon date + discipline + rang dans la journée. */
export function sessionKeys(sessions: BlockSession[], prefix: string): string[] {
  const seen = new Map<string, number>();
  return sessions.map((s) => {
    if (s.key) return `${prefix}:${s.key}`;
    const base = `${s.date}:${s.discipline}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${prefix}:${base}:${n}`;
  });
}

export type ImportPlan = {
  creates: { id: string; key: string; session: BlockSession }[];
  updates: { id: string; key: string; session: BlockSession }[];
  deletes: ExistingSession[];
  /** Séances réalisées (ou en cours) : jamais touchées. */
  kept: ExistingSession[];
  /** Séances du fichier dont la clé désigne une séance déjà réalisée : ignorées. */
  skipped: { key: string; session: BlockSession; reason: string }[];
};

export const isRealized = (s: ExistingSession, linked: Set<string>) => s.status !== "planned" || linked.has(s.id);

/**
 * Ce que l'import changerait, avant toute écriture (aperçu). `existing` : séances non supprimées de la
 * période ; `linked` : séances prévues rattachées à un réalisé ; `prefix` : espace des clés (« import »,
 * ou le motif de semaine appliqué).
 */
export function planImport(block: PlanBlock, existing: ExistingSession[], linked: Set<string>, newId: () => string, prefix = "import"): ImportPlan {
  const inPeriod = existing.filter((e) => !e.deleted_at && e.date >= block.period.start && e.date <= block.period.end);
  const keys = sessionKeys(block.sessions, prefix);
  const byKey = new Map(existing.filter((e) => !e.deleted_at && e.import_key).map((e) => [e.import_key!, e]));
  const plan: ImportPlan = { creates: [], updates: [], deletes: [], kept: [], skipped: [] };
  const matched = new Set<string>();

  block.sessions.forEach((session, i) => {
    const key = keys[i];
    const hit = byKey.get(key);
    if (!hit) return plan.creates.push({ id: newId(), key, session });
    matched.add(hit.id);
    if (isRealized(hit, linked)) plan.skipped.push({ key, session, reason: "séance déjà réalisée ou marquée : non modifiée" });
    else plan.updates.push({ id: hit.id, key, session });
  });
  for (const e of inPeriod) {
    if (matched.has(e.id)) continue;
    if (isRealized(e, linked)) plan.kept.push(e);
    else plan.deletes.push(e);
  }
  return plan;
}

/** Champs d'une séance prévue issus d'une ligne du fichier. */
export function sessionFields(s: BlockSession, key: string, batchId: string, source: "import" | "pattern" = "import") {
  return {
    date: s.date,
    local_time: s.local_time ?? null,
    discipline: s.discipline,
    session_type: s.session_type,
    priority: s.priority,
    title: s.title ?? null,
    target_duration_s: s.duration_min != null ? Math.round(s.duration_min * 60) : null,
    target_distance_m: s.distance_m ?? null,
    target_intensity: s.target_intensity ?? null,
    structure: s.structure ?? null,
    instructions: s.instructions ?? null,
    indoor: s.indoor ?? false,
    status: "planned",
    original_date: null,
    source,
    import_key: key,
    import_batch_id: batchId,
  };
}

/** Durée totale (min) d'une période, pour l'aperçu. */
export const blockMinutes = (b: PlanBlock) => Math.round(b.sessions.reduce((a, s) => a + (s.duration_min ?? 0), 0));

