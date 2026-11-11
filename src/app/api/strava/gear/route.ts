import { NextResponse } from "next/server";
import { accessToken, connectionFor, fetchAthlete } from "@/lib/strava/api";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Importe chaussures et vélos déclarés sur Strava. Le kilométrage Strava du jour devient le kilométrage
 * de départ ; seules les activités suivantes s'y ajoutent (pas de double compte avec l'historique).
 */
export async function POST() {
  const auth = await sessionUser();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const conn = await connectionFor(admin, { user: auth.userId });
  if (!conn) return NextResponse.json({ error: "Strava non connecté" }, { status: 400 });
  try {
    const athlete = await fetchAthlete(await accessToken(admin, conn));
    const { data: existing } = await admin.from("equipment").select("strava_gear_id").eq("user_id", auth.userId).is("deleted_at", null);
    const known = new Set((existing ?? []).map((e) => e.strava_gear_id));
    const rows = [
      ...(athlete.shoes ?? []).map((g) => ({ ...g, kind: "shoes" })),
      ...(athlete.bikes ?? []).map((g) => ({ ...g, kind: "bike" })),
    ]
      .filter((g) => !known.has(g.id))
      .map((g) => ({
        user_id: auth.userId, kind: g.kind, name: g.name, strava_gear_id: g.id,
        initial_km: Math.round(g.distance / 100) / 10,
        default_for_discipline: g.kind === "shoes" ? "run" : "bike",
      }));
    if (rows.length) {
      const { error } = await admin.from("equipment").insert(rows);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ imported: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
