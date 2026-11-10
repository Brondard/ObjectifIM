import { NextResponse, type NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { authorizeUrl } from "@/lib/strava/api";
import { sessionUser } from "@/lib/strava/route-auth";

/** Démarre l'autorisation Strava. Le `state` protège le retour contre une requête forgée. */
export async function GET(request: NextRequest) {
  const auth = await sessionUser();
  if ("error" in auth) return NextResponse.redirect(new URL("/login", request.url));
  const state = uuidv4();
  const res = NextResponse.redirect(authorizeUrl(new URL("/api/strava/callback", request.url).toString(), state));
  res.cookies.set("strava_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/strava" });
  return res;
}
