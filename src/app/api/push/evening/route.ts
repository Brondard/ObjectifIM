import { NextResponse, type NextRequest } from "next/server";
import * as webpush from "web-push";
import { eveningMessages } from "@/domain/calendar";
import { sessionsBetween, targetContext, targetText } from "@/lib/server/user-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, nowIso, today } from "@/lib/time";

export const maxDuration = 60;

/**
 * Tâche planifiée du soir (Vercel Cron) : pour chaque appareil abonné, le contenu des séances de demain
 * et la relance des séances du jour non renseignées. Ton factuel, rien envoyé s'il n'y a rien à dire.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (!pub || !priv) return NextResponse.json({ error: "clés VAPID manquantes" }, { status: 500 });
  webpush.setVapidDetails(subject ?? request.nextUrl.origin, pub, priv);

  const admin = createAdminClient();
  const { data: subs, error } = await admin.from("push_subscriptions").select("id, user_id, endpoint, keys").is("deleted_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = today();
  const tomorrow = addDays(now, 1);
  let sent = 0;
  for (const userId of [...new Set((subs ?? []).map((s) => s.user_id))]) {
    const { data: rule } = await admin.from("engine_rules").select("params").eq("user_id", userId).eq("rule_key", "notifications").is("deleted_at", null).maybeSingle();
    const prefs = { evening_preview: true, evening_unmarked: true, ...((rule?.params ?? {}) as object) };
    const [sessions, ctx] = await Promise.all([sessionsBetween(admin, userId, now, tomorrow), targetContext(admin, userId)]);
    const messages = eveningMessages(sessions.filter((s) => s.date === tomorrow), sessions.filter((s) => s.date === now), targetText(ctx), prefs);
    for (const sub of (subs ?? []).filter((s) => s.user_id === userId)) {
      for (const m of messages) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } }, JSON.stringify(m), { TTL: 6 * 3600 });
          sent++;
        } catch (e) {
          // Appareil désinscrit ou navigateur réinitialisé : l'abonnement n'existe plus.
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await admin.from("push_subscriptions").update({ deleted_at: nowIso() }).eq("id", sub.id);
        }
      }
    }
  }
  return NextResponse.json({ sent });
}
