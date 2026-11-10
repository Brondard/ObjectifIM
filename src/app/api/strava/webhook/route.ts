import { after, NextResponse, type NextRequest } from "next/server";
import { processPending } from "@/lib/strava/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Validation de l'abonnement : Strava renvoie le jeton de vérification choisi à la création. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (p.get("hub.mode") !== "subscribe" || !verifyToken || p.get("hub.verify_token") !== verifyToken) {
    return NextResponse.json({ error: "verification" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": p.get("hub.challenge") });
}

/**
 * Événement Strava : à acquitter en moins de 2 s. On l'inscrit dans la file puis on le traite
 * après la réponse ; un échec reste en file et sera retenté.
 */
export async function POST(request: NextRequest) {
  const event = await request.json().catch(() => null);
  const expected = process.env.STRAVA_SUBSCRIPTION_ID;
  if (!event?.object_id || !event?.owner_id || (expected && String(event.subscription_id) !== expected)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("strava_enqueue_event", { p: event });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  after(() => processPending(admin));
  return NextResponse.json({ ok: true });
}
