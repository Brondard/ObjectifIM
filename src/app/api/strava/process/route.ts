import { NextResponse, type NextRequest } from "next/server";
import { processPending } from "@/lib/strava/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Tâche planifiée Vercel : retente les événements du webhook restés en échec. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json({ processed: await processPending(createAdminClient(), 50) });
}
