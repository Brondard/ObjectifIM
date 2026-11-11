import "server-only";
import { parseIntensity } from "@/domain/session-structure";
import { resolveTargets, type TargetContext } from "@/domain/targets";
import { BASES } from "@/domain/labels";
import type { ZoneModel } from "@/domain/zones";
import type { CalendarSession } from "@/domain/calendar";
import { formatRange } from "@/lib/format";
import type { AdminClient } from "@/lib/supabase/admin";

const SESSION_COLUMNS =
  "id, date, local_time, discipline, session_type, status, title, priority, target_duration_s, target_distance_m, target_intensity, instructions, updated_at, deleted_at";

export type ServerSession = CalendarSession & { target_intensity: unknown };

/** Séances prévues d'un utilisateur entre deux dates (rôle de service : user_id toujours filtré). */
export async function sessionsBetween(admin: AdminClient, userId: string, from: string, to: string): Promise<ServerSession[]> {
  const { data, error } = await admin
    .from("planned_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .is("deleted_at", null)
    .order("date")
    .order("local_time", { nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ServerSession[];
}

/** Repères, zones et règles de cible d'un utilisateur : de quoi écrire « FC Z2 · 116–136 bpm ». */
export async function targetContext(admin: AdminClient, userId: string): Promise<TargetContext> {
  const [metrics, models, rules] = await Promise.all([
    admin.from("metrics").select("kind, value, measured_on, deleted_at").eq("user_id", userId).is("deleted_at", null),
    admin.from("zone_models").select("discipline, basis, method, bounds, overrides, valid_from, deleted_at").eq("user_id", userId).is("deleted_at", null),
    admin.from("engine_rules").select("rule_key, params").eq("user_id", userId).is("deleted_at", null).in("rule_key", ["default_intensity_by_type", "intensity_judgement"]),
  ]);
  const params = (key: string) => (rules.data?.find((r) => r.rule_key === key)?.params ?? {}) as Record<string, unknown>;
  return {
    metrics: (metrics.data ?? []).map((m) => ({ ...m, value: Number(m.value) })),
    models: (models.data ?? []) as unknown as ZoneModel[],
    rules: {
      defaultZoneByType: params("default_intensity_by_type") as Record<string, number | null>,
      judgementByType: (params("intensity_judgement").by_session_type ?? {}) as Record<string, string>,
    },
  };
}

/** Texte court de la cible principale d'une séance, ou null si rien n'est calculable. */
export function targetText(ctx: TargetContext) {
  return (s: CalendarSession) => {
    const t = resolveTargets(s as ServerSession, ctx, parseIntensity).find((x) => x.status === "ok");
    if (!t || t.status !== "ok") return null;
    return `${BASES[t.basis]} ${t.zone != null ? `Z${t.zone} · ` : ""}${formatRange(t.basis, t.min, t.max)}`;
  };
}
