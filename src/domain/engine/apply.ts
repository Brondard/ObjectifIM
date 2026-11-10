/**
 * Traduction de l'option choisie en écritures, plus l'entrée du journal plan_changes.
 * Appelé uniquement après un choix explicite de l'utilisateur.
 */
import { localDateOf, type LocalDate } from "@/lib/time";
import { planMove } from "../planning";
import { ENGINE_VERSION, type EngineSession, type Option, type Proposal } from "./types";

export type Write = { table: "planned_sessions" | "plan_changes"; id: string; fields: Record<string, unknown> };

const TRIGGER_LOG: Record<string, string> = {
  unavailable: "unavailable", sick: "sick", move: "move", short_time: "short_time", travel: "travel", missed: "missed_key",
};

export function planApply(proposal: Proposal, chosen: Option, sessions: EngineSession[], changeId: string, reason: string | null): Write[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const writes: Write[] = [];
  const affected: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];

  for (const c of chosen.changes) {
    const s = byId.get(c.id);
    if (!s) continue;
    let fields: Record<string, unknown>;
    switch (c.kind) {
      case "move":
        fields = { ...planMove(s, c.to as LocalDate), ...(c.reopen ? { status: "planned", skip_note: null } : {}) };
        break;
      case "drop":
        fields = { status: c.status, skip_note: c.note };
        break;
      case "shorten":
        fields = { target_duration_s: c.to_s };
        break;
      case "substitute":
        fields = {
          discipline: c.to_discipline,
          session_type: c.to_session_type,
          target_duration_s: c.duration_s,
          title: c.label,
          target_intensity: null,
          structure: null,
        };
        break;
    }
    writes.push({ table: "planned_sessions", id: s.id, fields });
    affected.push({
      id: s.id,
      before: Object.fromEntries(Object.keys(fields).map((k) => [k, (s as Record<string, unknown>)[k] ?? null])),
      after: fields,
    });
  }

  writes.push({
    table: "plan_changes",
    id: changeId,
    fields: {
      trigger: TRIGGER_LOG[proposal.trigger.kind],
      reason,
      input: proposal.trigger,
      // Instantané complet : on peut relire plus tard ce qui a été proposé et pourquoi.
      options: { options: proposal.options, eliminated: proposal.eliminated, notes: proposal.notes },
      chosen_option: chosen.key,
      affected,
      engine_version: ENGINE_VERSION,
    },
  });
  return writes;
}

/** Nombre de rattrapages déjà faits dans une semaine, d'après le journal. */
export function catchupsIn(changes: { trigger: string; chosen_option: string | null; occurred_at: string; deleted_at?: string | null }[], weekStart: string, weekEnd: string) {
  return changes.filter(
    (c) => !c.deleted_at && c.trigger === "missed_key" && (c.chosen_option === "catch_up" || c.chosen_option === "swap") &&
      localDateOf(c.occurred_at) >= weekStart && localDateOf(c.occurred_at) <= weekEnd,
  ).length;
}
