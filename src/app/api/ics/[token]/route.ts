import { NextResponse, type NextRequest } from "next/server";
import { buildIcs } from "@/domain/calendar";
import { sessionsBetween, targetContext, targetText } from "@/lib/server/user-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, nowIso, today } from "@/lib/time";

/**
 * Flux d'abonnement ICS des séances prévues (60 jours en arrière, un an en avant).
 * Pas de session : le jeton secret de l'URL identifie l'utilisateur ; il se renouvelle dans les réglages.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{48}$/.test(token)) return new NextResponse("Introuvable", { status: 404 });
  const admin = createAdminClient();
  const { data: userId } = await admin.rpc("ics_user", { p_token: token });
  if (!userId) return new NextResponse("Introuvable", { status: 404 });

  const now = today();
  const [sessions, ctx] = await Promise.all([sessionsBetween(admin, userId, addDays(now, -60), addDays(now, 365)), targetContext(admin, userId)]);
  const body = buildIcs(sessions, targetText(ctx), nowIso(), request.nextUrl.origin);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="entrainement.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
