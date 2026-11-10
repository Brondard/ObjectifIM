import { NextResponse, type NextRequest } from "next/server";
import { accessToken, connectionFor, listActivities } from "@/lib/strava/api";
import { upsertActivity } from "@/lib/strava/ingest";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
const PER_PAGE = 100;

/**
 * Import de l'historique, une page de 100 activités par appel (l'écran enchaîne les pages).
 * Les flux ne sont pas téléchargés ici : ils le sont à la demande, pour ménager la limite de Strava.
 */
export async function POST(request: NextRequest) {
  const auth = await sessionUser();
  if ("error" in auth) return auth.error;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const admin = createAdminClient();
  const conn = await connectionFor(admin, { user: auth.userId });
  if (!conn) return NextResponse.json({ error: "Strava non connecté" }, { status: 400 });

  try {
    const activities = await listActivities(await accessToken(admin, conn), page, PER_PAGE);
    for (const a of activities) await upsertActivity(admin, auth.userId, a);
    const done = activities.length < PER_PAGE;
    if (done) await admin.rpc("strava_mark_import", { p_user: auth.userId });
    return NextResponse.json({ imported: activities.length, done });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
