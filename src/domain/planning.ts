/** Opérations sur le plan : déplacer une séance, dupliquer une semaine. Fonctions pures. */
import { addDays, type LocalDate } from "@/lib/time";
import { alive, type PlannedLike } from "./week";

/**
 * Déplacer une séance garde sa date d'origine (arbitrage 2 : pas de statut `moved`).
 * Revenir à la date d'origine efface la trace du déplacement.
 */
export function planMove(session: { date: string; original_date?: string | null }, to: LocalDate) {
  const origin = session.original_date ?? session.date;
  return { date: to, original_date: to === origin ? null : origin };
}

/** Journal du déplacement (plan_changes). */
export function moveChange(session: PlannedLike, to: LocalDate, reason: string | null = null) {
  return {
    trigger: "move",
    reason,
    input: { session_id: session.id, from: session.date, to },
    chosen_option: "manual",
    affected: [{ id: session.id, before: { date: session.date }, after: { date: to } }],
  };
}

type Duplicable = PlannedLike & Record<string, unknown>;

const COPIED_FIELDS = [
  "local_time", "discipline", "session_type", "priority", "title", "target_duration_s", "target_distance_m",
  "target_intensity", "structure", "instructions", "indoor", "template_id",
] as const;

/**
 * Copie les séances d'une semaine décalées de `offsetDays` jours. Les copies repartent à zéro :
 * statut prévu, aucune trace de déplacement, aucun lien d'import.
 */
export function planDuplicate(sessions: Duplicable[], offsetDays: number, newId: () => string) {
  return alive(sessions).map((s) => {
    const fields: Record<string, unknown> = {
      date: addDays(s.date as LocalDate, offsetDays),
      status: "planned",
      source: "manual",
    };
    for (const k of COPIED_FIELDS) if (s[k] !== undefined) fields[k] = s[k];
    return { id: newId(), fields };
  });
}
