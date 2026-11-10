/**
 * Marquage d'une séance prévue : fait / partiel / manqué / annuler.
 * Produit la liste d'écritures à appliquer ; ne touche à rien lui-même.
 */
import type { CompletedLike, PlannedLike } from "./week";

export type SkipReason = "choice" | "life" | "injury";

export type Mark =
  | { kind: "done"; duration_s?: number | null; rpe?: number | null; feeling?: string | null }
  | { kind: "partial"; duration_s: number; rpe?: number | null; feeling?: string | null }
  | { kind: "skipped"; reason: SkipReason; note?: string | null }
  | { kind: "reset" };

export type Write = {
  table: "planned_sessions" | "completed_sessions";
  id: string;
  fields: Record<string, unknown>;
};

export type MarkContext = {
  /** Réalisé saisi à la main déjà rattaché à cette séance, s'il existe. */
  manualCompletion: CompletedLike | null;
  /** Identifiant à utiliser si un réalisé doit être créé. */
  newId: string;
  /** Instant ISO de l'opération (suppression logique). */
  at: string;
};

export function planMark(session: PlannedLike, mark: Mark, ctx: MarkContext): Write[] {
  const plannedWrite = (fields: Record<string, unknown>): Write => ({
    table: "planned_sessions", id: session.id, fields,
  });
  const dropCompletion = (): Write[] =>
    ctx.manualCompletion && !ctx.manualCompletion.deleted_at
      ? [{ table: "completed_sessions", id: ctx.manualCompletion.id, fields: { deleted_at: ctx.at } }]
      : [];

  switch (mark.kind) {
    case "done":
    case "partial": {
      const duration =
        mark.kind === "partial" ? mark.duration_s : (mark.duration_s ?? session.target_duration_s ?? null);
      const fields: Record<string, unknown> = {
        moving_s: duration,
        elapsed_s: duration,
        deleted_at: null,
      };
      if (mark.rpe !== undefined) fields.rpe = mark.rpe;
      if (mark.feeling !== undefined) fields.feeling = mark.feeling?.trim() || null;
      const completion: Write = ctx.manualCompletion
        ? { table: "completed_sessions", id: ctx.manualCompletion.id, fields }
        : {
            table: "completed_sessions",
            id: ctx.newId,
            fields: {
              ...fields,
              planned_session_id: session.id,
              match_status: "confirmed",
              local_date: session.date,
              discipline: session.discipline,
              distance_m: mark.kind === "done" ? session.target_distance_m : null,
              source: "manual",
            },
          };
      return [plannedWrite({ status: mark.kind === "done" ? "completed" : "partial", skip_note: null }), completion];
    }
    case "skipped":
      return [
        plannedWrite({ status: `skipped_${mark.reason}`, skip_note: mark.note?.trim() || null }),
        ...dropCompletion(),
      ];
    case "reset":
      return [plannedWrite({ status: "planned", skip_note: null }), ...dropCompletion()];
  }
}

/** Retour du marquage : met à jour RPE et ressenti du réalisé, sans changer le statut. */
export function planFeedback(completionId: string, rpe: number | null, feeling: string | null): Write {
  return { table: "completed_sessions", id: completionId, fields: { rpe, feeling: feeling?.trim() || null } };
}
