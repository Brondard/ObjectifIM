import "server-only";
import type { StravaActivity } from "@/domain/strava";
import { STREAM_KEYS } from "@/domain/strava";
import type { AdminClient } from "@/lib/supabase/admin";
import { isoFromEpochSeconds, now } from "@/lib/time";

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";

/** Lecture de toutes les activités, y compris privées, et du profil (équipement). */
export const STRAVA_SCOPES = "read,activity:read_all,profile:read_all";

export function stravaEnv() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET manquants");
  return { clientId, clientSecret, verifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "" };
}

export function authorizeUrl(redirectUri: string, state: string) {
  const { clientId } = stravaEnv();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES,
    state,
  });
  return `${OAUTH}/authorize?${q}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // secondes epoch
  athlete?: { id: number };
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = stravaEnv();
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`Strava OAuth ${res.status} : ${await res.text()}`);
  return res.json();
}

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: "authorization_code" });

export type Connection = { user_id: string; athlete_id: number; access_token: string; refresh_token: string; expires_at: string };

export async function connectionFor(admin: AdminClient, by: { user?: string; athlete?: number }): Promise<Connection | null> {
  const { data, error } = await admin.rpc("strava_connection", { p_user: by.user, p_athlete: by.athlete });
  if (error) throw new Error(error.message);
  return (data?.[0] as Connection | undefined) ?? null;
}

/** Jeton d'accès valide, rafraîchi s'il expire dans moins de 5 minutes. */
export async function accessToken(admin: AdminClient, conn: Connection): Promise<string> {
  if (Date.parse(conn.expires_at) - now().getTime() > 5 * 60_000) return conn.access_token;
  const t = await tokenRequest({ refresh_token: conn.refresh_token, grant_type: "refresh_token" });
  const { error } = await admin.rpc("strava_update_tokens", {
    p_user: conn.user_id, p_access: t.access_token, p_refresh: t.refresh_token, p_expires: isoFromEpochSeconds(t.expires_at),
  });
  if (error) throw new Error(error.message);
  return t.access_token;
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new Error("Strava : limite de requêtes atteinte, réessayer dans 15 minutes");
  if (!res.ok) throw new Error(`Strava ${path} : ${res.status}`);
  return res.json();
}

export const fetchActivity = (token: string, id: number) => get<StravaActivity>(token, `/activities/${id}`);

export const listActivities = (token: string, page: number, perPage = 100) =>
  get<StravaActivity[]>(token, `/athlete/activities?page=${page}&per_page=${perPage}`);

export const fetchStreams = (token: string, id: number) =>
  get<Record<string, { data: unknown[] }>>(token, `/activities/${id}/streams?keys=${STREAM_KEYS.join(",")}&key_by_type=true`);

export async function deauthorize(token: string) {
  await fetch(`${OAUTH}/deauthorize`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
