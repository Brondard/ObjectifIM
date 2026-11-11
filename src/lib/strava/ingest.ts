import "server-only";
import { gzipSync } from "node:zlib";
import { v7 as uuidv7 } from "uuid";
import { suggestMatch } from "@/domain/matching";
import { completedFieldsFrom, streamsFrom, type StravaActivity } from "@/domain/strava";
import type { PlannedLike } from "@/domain/week";
import type { AdminClient } from "@/lib/supabase/admin";
import { nowIso } from "@/lib/time";
import { accessToken, connectionFor, fetchActivity, fetchStreams, type Connection } from "./api";

/**
 * Enregistre une activité Strava comme séance réalisée (création ou mise à jour).
 * À la création, propose un rattachement (match_status = suggested), jamais confirmé ici.
 * Une mise à jour ne touche qu'aux données Strava : ni RPE, ni ressenti, ni rattachement, ni suppression.
 */
export async function upsertActivity(admin: AdminClient, userId: string, a: StravaActivity): Promise<string> {
  // Matériel : chaussures ou vélo associés via l'équipement Strava de l'activité.
  const gear = a.gear_id
    ? (await admin.from("equipment").select("id").eq("user_id", userId).eq("strava_gear_id", a.gear_id).is("deleted_at", null).maybeSingle()).data
    : null;
  const fields = { ...completedFieldsFrom(a), ...(gear ? { equipment_id: gear.id } : {}) };
  const { data: existing, error } = await admin
    .from("completed_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("strava_activity_id", a.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (existing) {
    const { error: e } = await admin.from("completed_sessions").update(fields).eq("id", existing.id);
    if (e) throw new Error(e.message);
    return existing.id;
  }

  const [planned, linked] = await Promise.all([
    admin
      .from("planned_sessions")
      .select("id, date, discipline, status, target_duration_s, target_distance_m, deleted_at")
      .eq("user_id", userId)
      .eq("date", fields.local_date)
      .is("deleted_at", null),
    admin
      .from("completed_sessions")
      .select("planned_session_id")
      .eq("user_id", userId)
      .eq("local_date", fields.local_date)
      .eq("source", "strava")
      .is("deleted_at", null)
      .not("planned_session_id", "is", null),
  ]);
  if (planned.error) throw new Error(planned.error.message);
  if (linked.error) throw new Error(linked.error.message);

  const match = suggestMatch(
    fields,
    (planned.data ?? []) as PlannedLike[],
    new Set((linked.data ?? []).map((l) => l.planned_session_id!)),
  );
  const id = uuidv7();
  const { error: e } = await admin.from("completed_sessions").insert({
    id,
    user_id: userId,
    ...fields,
    planned_session_id: match,
    match_status: match ? "suggested" : "standalone",
  });
  if (e) throw new Error(e.message);
  return id;
}

/** Télécharge les flux d'une activité, les compresse et les range dans Storage (une seule fois). */
export async function storeStreams(admin: AdminClient, conn: Connection, completedId: string, activityId: number) {
  const token = await accessToken(admin, conn);
  const streams = streamsFrom(await fetchStreams(token, activityId));
  if (!streams) return null;
  const path = `${conn.user_id}/${activityId}.json.gz`;
  const { error } = await admin.storage
    .from("streams")
    .upload(path, gzipSync(JSON.stringify(streams)), { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);
  const { error: e } = await admin.from("completed_sessions").update({ streams_path: path }).eq("id", completedId);
  if (e) throw new Error(e.message);
  return path;
}

type StravaEvent = {
  id: number;
  object_type: string;
  object_id: number;
  aspect_type: string;
  athlete_id: number;
  payload: { updates?: Record<string, string> };
};

/** Traite un événement du webhook. Une erreur est consignée et l'événement retenté plus tard. */
export async function processEvent(admin: AdminClient, event: StravaEvent) {
  try {
    const conn = await connectionFor(admin, { athlete: event.athlete_id });
    if (!conn) {
      await admin.rpc("strava_finish_event", { p_id: event.id });
      return;
    }

    if (event.object_type === "athlete") {
      // L'athlète a révoqué l'accès depuis Strava.
      if (event.payload.updates?.authorized === "false") await admin.rpc("strava_delete_connection", { p_user: conn.user_id });
    } else if (event.aspect_type === "delete") {
      await admin
        .from("completed_sessions")
        .update({ deleted_at: nowIso() })
        .eq("user_id", conn.user_id)
        .eq("strava_activity_id", event.object_id)
        .is("deleted_at", null);
    } else {
      const token = await accessToken(admin, conn);
      const activity = await fetchActivity(token, event.object_id);
      const id = await upsertActivity(admin, conn.user_id, activity);
      if (event.aspect_type === "create") await storeStreams(admin, conn, id, activity.id);
    }
    await admin.rpc("strava_finish_event", { p_id: event.id });
  } catch (e) {
    await admin.rpc("strava_finish_event", { p_id: event.id, p_error: e instanceof Error ? e.message : String(e) });
  }
}

/** Retente les événements en attente (tâche planifiée, ou après chaque nouvel événement). */
export async function processPending(admin: AdminClient, limit = 20) {
  const { data, error } = await admin.rpc("strava_pending_events", { p_limit: limit });
  if (error) throw new Error(error.message);
  for (const event of data ?? []) await processEvent(admin, event as unknown as StravaEvent);
  return data?.length ?? 0;
}
