import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/strava/api";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isoFromEpochSeconds } from "@/lib/time";

/** Retour de Strava : vérifie le state, échange le code, enregistre les jetons côté serveur. */
export async function GET(request: NextRequest) {
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/reglages?strava=${status}`, request.url));
    res.cookies.delete({ name: "strava_state", path: "/api/strava" });
    return res;
  };
  const params = request.nextUrl.searchParams;
  const auth = await sessionUser();
  if ("error" in auth) return NextResponse.redirect(new URL("/login", request.url));
  if (params.get("error")) return back("refus");
  if (!params.get("state") || params.get("state") !== request.cookies.get("strava_state")?.value) return back("etat");

  const scopes = (params.get("scope") ?? "").split(",").filter(Boolean);
  if (!scopes.includes("activity:read_all")) return back("portee");

  try {
    const token = await exchangeCode(params.get("code") ?? "");
    if (!token.athlete) return back("erreur");
    const { error } = await createAdminClient().rpc("strava_save_connection", {
      p_user: auth.userId,
      p_athlete: token.athlete.id,
      p_access: token.access_token,
      p_refresh: token.refresh_token,
      p_expires: isoFromEpochSeconds(token.expires_at),
      p_scopes: scopes,
    });
    return back(error ? "erreur" : "ok");
  } catch {
    return back("erreur");
  }
}
