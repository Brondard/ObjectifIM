import { NextResponse, type NextRequest } from "next/server";
import * as webpush from "web-push";
import { eveningMessages, type PushMessage } from "@/domain/calendar";
import { weekReview } from "@/domain/life/review";
import { completedBetween, sessionsBetween, targetContext, targetText } from "@/lib/server/user-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, isoWeekday, nowIso, today, weekStart } from "@/lib/time";

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
    const prefs = { evening_preview: true, evening_unmarked: true, weekly_review: true, ...((rule?.params ?? {}) as object) } as {
      evening_preview: boolean; evening_unmarked: boolean; weekly_review: boolean;
    };
    const [sessions, ctx] = await Promise.all([sessionsBetween(admin, userId, now, tomorrow), targetContext(admin, userId)]);
    const messages: PushMessage[] = eveningMessages(sessions.filter((s) => s.date === tomorrow), sessions.filter((s) => s.date === now), targetText(ctx), prefs);
    // Le dimanche soir : revue de la semaine, en une notification qui ouvre la page complète.
    if (prefs.weekly_review && isoWeekday(now) === 7) {
      const monday = weekStart(now);
      const [week, next, done] = await Promise.all([
        sessionsBetween(admin, userId, monday, now),
        sessionsBetween(admin, userId, addDays(monday, 7), addDays(monday, 13)),
        completedBetween(admin, userId, monday, now),
      ]);
      const off = done
        .map((c) => (c.analysis as { version?: number; intensity?: { verdict: string; above_pct: number } } | null))
        .filter((a) => a?.version === 3 && a.intensity && a.intensity.verdict !== "ok")
        .map((a) => ({ title: "", verdict: a!.intensity!.verdict, pct: a!.intensity!.above_pct }));
      const live = <T extends { deleted_at?: string | null }>(l: T[]) => l.map((s) => ({ ...s, deleted_at: s.deleted_at ?? null }));
      const r = weekReview({ weekStart: monday, planned: live(week), completed: done, nextWeek: live(next), intensityOff: off, signals: [] });
      messages.push({ title: "Revue de la semaine", body: r.lines.join("\n"), url: `/revue?w=${monday}`, tag: "weekly-review" });
    }
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
