/** Volumes d'une période : prévu contre réalisé, par discipline. Fonctions pures. */
import type { Discipline } from "./labels";

export type PlannedLike = {
  id: string;
  date: string;
  original_date?: string | null;
  discipline: string;
  session_type?: string;
  priority?: string;
  status: string;
  skip_note?: string | null;
  target_duration_s: number | null;
  target_distance_m: number | null;
  deleted_at: string | null;
};

export type CompletedLike = {
  id: string;
  local_date: string;
  discipline: string;
  planned_session_id: string | null;
  elapsed_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  source?: string;
  deleted_at: string | null;
};

export const DONE_STATUSES = ["completed", "partial"] as const;
export const SKIP_STATUSES = ["skipped_choice", "skipped_life", "skipped_injury"] as const;

export const isDone = (status: string) => (DONE_STATUSES as readonly string[]).includes(status);
export const isSkipped = (status: string) => (SKIP_STATUSES as readonly string[]).includes(status);
export const alive = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

export function completedDuration(c: CompletedLike): number {
  return c.moving_s ?? c.elapsed_s ?? 0;
}

export type Volume = {
  planned_s: number;
  done_s: number;
  planned_m: number;
  done_m: number;
  planned_count: number;
  done_count: number;
  skipped_count: number;
  /** Séances prévues encore ni faites ni manquées. */
  open_count: number;
};

const emptyVolume = (): Volume => ({
  planned_s: 0, done_s: 0, planned_m: 0, done_m: 0, planned_count: 0, done_count: 0, skipped_count: 0, open_count: 0,
});

/**
 * Le réalisé compte toutes les séances faites, prévues ou non (une sortie imprévue est du volume réel).
 * Le prévu compte toutes les séances prévues, y compris celles manquées.
 */
export function volumes(planned: PlannedLike[], completed: CompletedLike[]) {
  const byDiscipline: Partial<Record<Discipline, Volume>> = {};
  const total = emptyVolume();
  const bucket = (d: string) => (byDiscipline[d as Discipline] ??= emptyVolume());

  for (const p of alive(planned)) {
    for (const v of [bucket(p.discipline), total]) {
      v.planned_s += p.target_duration_s ?? 0;
      v.planned_m += p.target_distance_m ?? 0;
      v.planned_count += 1;
      if (isDone(p.status)) v.done_count += 1;
      else if (isSkipped(p.status)) v.skipped_count += 1;
      else v.open_count += 1;
    }
  }
  for (const c of alive(completed)) {
    for (const v of [bucket(c.discipline), total]) {
      v.done_s += completedDuration(c);
      v.done_m += c.distance_m ?? 0;
    }
  }
  return { byDiscipline, total };
}

/**
 * Séance « due » pour l'écart à date : jours passés, ou aujourd'hui si elle est déjà marquée.
 * Une séance du jour pas encore faite n'est pas un écart.
 */
export function dueBy(session: PlannedLike, asOf: string): boolean {
  return session.date < asOf || (session.date === asOf && session.status !== "planned");
}

/** Écart réalisé − prévu, en proportion du prévu (null si rien de prévu). */
export function deltaRatio(done: number, planned: number): number | null {
  return planned > 0 ? (done - planned) / planned : null;
}
