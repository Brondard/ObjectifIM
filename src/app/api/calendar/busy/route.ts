import { NextResponse, type NextRequest } from "next/server";
import { isAllowedCalendarUrl, parseIcsEvents } from "@/domain/life/agenda";
import { sessionUser } from "@/lib/strava/route-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, isLocalDate, today } from "@/lib/time";

/**
 * Événements de l'agenda personnel sur une période (lecture seule). L'adresse secrète reste côté serveur ;
 * l'app ne reçoit que les créneaux occupés et leur titre.
 */
export async function GET(request: NextRequest) {
  const auth = await sessionUser();
  if ("error" in auth) return auth.error;
  const p = request.nextUrl.searchParams;
  const from = p.get("from") && isLocalDate(p.get("from")!) ? p.get("from")! : today();
  const to = p.get("to") && isLocalDate(p.get("to")!) ? p.get("to")! : addDays(today(), 14);
  const { data: url } = await createAdminClient().rpc("calendar_url", { p_user: auth.userId });
  if (!url) return NextResponse.json({ events: [], connected: false });
  // Le serveur ne va chercher que des agendas Google : l'adresse ne peut pas servir à viser autre chose.
  if (!isAllowedCalendarUrl(url)) return NextResponse.json({ error: "Seules les adresses iCal de Google Agenda sont acceptées" }, { status: 400 });
  try {
    const res = await fetch(url, { headers: { Accept: "text/calendar" }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `Agenda inaccessible (${res.status})` }, { status: 502 });
    return NextResponse.json({ events: parseIcsEvents(await res.text(), from, to), connected: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
