import { NextResponse } from "next/server";
import { accessToken, connectionFor, deauthorize } from "@/lib/strava/api";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Révoque l'accès chez Strava et efface les jetons. Les séances déjà importées restent. */
export async function POST() {
  const auth = await sessionUser();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const conn = await connectionFor(admin, { user: auth.userId });
  if (conn) {
    await deauthorize(await accessToken(admin, conn)).catch(() => {});
    await admin.rpc("strava_delete_connection", { p_user: auth.userId });
  }
  return NextResponse.json({ ok: true });
}
