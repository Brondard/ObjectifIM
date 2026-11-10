import { NextResponse, type NextRequest } from "next/server";
import { connectionFor } from "@/lib/strava/api";
import { storeStreams } from "@/lib/strava/ingest";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Flux d'une séance importée : téléchargés depuis Strava une seule fois, puis servis depuis Storage. */
export async function POST(request: NextRequest) {
  const auth = await sessionUser();
  if ("error" in auth) return auth.error;
  const { completed_id } = await request.json().catch(() => ({}));
  // Lecture avec la session : la RLS garantit que la séance appartient à l'utilisateur.
  const { data: c } = await auth.supabase
    .from("completed_sessions")
    .select("id, strava_activity_id, streams_path")
    .eq("id", completed_id)
    .maybeSingle();
  if (!c?.strava_activity_id) return NextResponse.json({ error: "séance sans activité Strava" }, { status: 404 });
  if (c.streams_path) return NextResponse.json({ path: c.streams_path });

  const admin = createAdminClient();
  const conn = await connectionFor(admin, { user: auth.userId });
  if (!conn) return NextResponse.json({ error: "Strava non connecté" }, { status: 400 });
  try {
    return NextResponse.json({ path: await storeStreams(admin, conn, c.id, c.strava_activity_id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
