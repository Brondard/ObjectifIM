/**
 * Logique pure de la synchronisation (sans Dexie ni réseau), testée dans core.test.ts.
 * Le serveur applique les patchs via la RPC apply_mutations (migration 20261110100000).
 */

/** Tables modifiables depuis le client (doit rester un sous-ensemble de la liste de la RPC). */
export const WRITABLE_TABLES = [
  "planned_sessions", "completed_sessions", "daily_logs", "plan_changes", "metrics", "zone_models",
] as const;
/** Tables lues et gardées en local pour fonctionner hors ligne. */
export const PULL_TABLES = [...WRITABLE_TABLES, "seasons", "phases", "races", "session_templates", "engine_rules"] as const;

export type WritableTable = (typeof WRITABLE_TABLES)[number];
export type PullTable = (typeof PULL_TABLES)[number];

/**
 * Les numéros de révision sont attribués à l'écriture, pas au commit : une transaction lente peut
 * rendre visible une révision inférieure au curseur après coup. On relit donc une fenêtre de
 * révisions déjà vues à chaque synchro (l'écriture locale est idempotente).
 */
export const PULL_OVERLAP = 200;
export const PULL_PAGE = 1000;

export type Fields = Record<string, unknown>;

export type OutboxEntry = {
  seq?: number;
  mutation_id: string;
  table: WritableTable;
  id: string;
  fields: Fields;
  /** Valeurs des champs telles que connues avant la modification ; vide pour une création. */
  base: Fields;
  ts: number;
};

export type Mutation = Omit<OutboxEntry, "seq">;
export type CompactedMutation = Mutation & { seqs: number[] };

/**
 * Fusionne les écritures en attente sur une même ligne en un seul patch :
 * valeur la plus récente par champ, base la plus ancienne (celle que connaissait le serveur).
 */
export function compactOutbox(entries: OutboxEntry[]): CompactedMutation[] {
  const byRow = new Map<string, CompactedMutation>();
  const sorted = [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const e of sorted) {
    const key = `${e.table}:${e.id}`;
    const acc = byRow.get(key);
    if (!acc) {
      byRow.set(key, { ...e, fields: { ...e.fields }, base: { ...e.base }, seqs: e.seq === undefined ? [] : [e.seq] });
      continue;
    }
    for (const [k, v] of Object.entries(e.base)) {
      if (!(k in acc.base) && !(k in acc.fields)) acc.base[k] = v;
    }
    Object.assign(acc.fields, e.fields);
    acc.ts = Math.max(acc.ts, e.ts);
    acc.mutation_id = e.mutation_id;
    if (e.seq !== undefined) acc.seqs.push(e.seq);
  }
  return [...byRow.values()];
}

/** Réapplique sur une ligne venue du serveur les écritures locales pas encore envoyées. */
export function overlayPending<T extends Fields>(row: T, pending: OutboxEntry[]): T {
  if (!pending.length) return row;
  const sorted = [...pending].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return sorted.reduce<T>((acc, e) => ({ ...acc, ...e.fields }), row);
}

export function maxRev(rows: { _rev: number }[], current: number): number {
  return rows.reduce((m, r) => Math.max(m, r._rev), current);
}

export function pullFrom(cursor: number): number {
  return Math.max(0, cursor - PULL_OVERLAP);
}

export type MutationResult = {
  mutation_id: string;
  table: WritableTable;
  id: string;
  status: "applied" | "conflict";
  conflicts: { field: string; server: unknown; client: unknown; base: unknown }[];
  row: Fields & { _rev: number };
};

/** Une erreur de base (code Postgres) rejette une écriture ; sans code, c'est le réseau. */
export function isRejection(error: { code?: string } | null): boolean {
  return !!error?.code && /^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith("08");
}
