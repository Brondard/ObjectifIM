/**
 * Rapprochement d'une activité importée avec une séance prévue.
 * Le serveur ne fait que proposer (match_status = suggested) ; le rattachement est toujours confirmé à la main.
 */
import { isSkipped, type CompletedLike, type PlannedLike } from "./week";

export type ActivityLike = { local_date: string; discipline: string; moving_s: number | null };

/**
 * Séance prévue la plus plausible : même jour, même discipline, pas déjà rattachée à une autre activité
 * importée. À égalité de jour et de discipline, la durée prévue la plus proche l'emporte.
 */
export function suggestMatch(activity: ActivityLike, planned: PlannedLike[], alreadyLinked: Set<string>): string | null {
  const candidates = planned.filter(
    (p) =>
      !p.deleted_at &&
      p.date === activity.local_date &&
      p.discipline === activity.discipline &&
      !alreadyLinked.has(p.id),
  );
  if (!candidates.length) return null;
  const gap = (p: PlannedLike) =>
    p.target_duration_s == null || activity.moving_s == null ? Number.MAX_SAFE_INTEGER : Math.abs(p.target_duration_s - activity.moving_s);
  return [...candidates].sort((a, b) => gap(a) - gap(b))[0].id;
}

export type Write = { table: "planned_sessions" | "completed_sessions"; id: string; fields: Record<string, unknown> };

type ImportedLike = CompletedLike & { rpe?: number | null; feeling?: string | null };

/**
 * Confirmer le rattachement : l'activité importée devient le réalisé de la séance. Une saisie manuelle
 * antérieure (« Fait » en un geste) est retirée pour ne pas compter deux fois le volume, mais son RPE et
 * son ressenti sont repris s'ils manquent.
 */
export function planConfirm(
  imported: ImportedLike,
  planned: PlannedLike,
  manual: ImportedLike | null,
  at: string,
): Write[] {
  const keepManual = manual && !manual.deleted_at && manual.id !== imported.id ? manual : null;
  const writes: Write[] = [
    {
      table: "completed_sessions",
      id: imported.id,
      fields: {
        planned_session_id: planned.id,
        match_status: "confirmed",
        rpe: imported.rpe ?? keepManual?.rpe ?? null,
        feeling: imported.feeling ?? keepManual?.feeling ?? null,
      },
    },
    {
      table: "planned_sessions",
      id: planned.id,
      fields: { status: planned.status === "partial" ? "partial" : "completed", skip_note: isSkipped(planned.status) ? null : (planned.skip_note ?? null) },
    },
  ];
  if (keepManual) writes.push({ table: "completed_sessions", id: keepManual.id, fields: { deleted_at: at } });
  return writes;
}

/** Refuser la proposition : l'activité reste une séance réalisée sans séance prévue. */
export function planReject(imported: CompletedLike): Write {
  return { table: "completed_sessions", id: imported.id, fields: { planned_session_id: null, match_status: "standalone" } };
}
