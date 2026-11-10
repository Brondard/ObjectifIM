/** Signaux de risque : enchaînements, gênes récurrentes. Fonctions pures. */
import { addDays, diffDays, formatLocalDate, type LocalDate } from "@/lib/time";

const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric", month: "short" });

const HARD_TYPES = new Set(["long", "tempo", "threshold", "vo2", "short_reps", "race_pace", "race"]);

export type DaySession = { date: string; session_type: string; priority: string; title: string | null; done: boolean };

export type Signal = { key: string; level: "warning" | "serious"; message: string };

const hard = (s: DaySession) => s.priority === "key" || HARD_TYPES.has(s.session_type);
const name = (s: DaySession) => s.title ?? s.session_type;

/**
 * Enchaînements à risque sur une fenêtre (réalisé récent + prévu à venir) :
 * deux jours durs de suite, musculation des jambes la veille d'une séance clé.
 */
export function chainSignals(sessions: DaySession[]): Signal[] {
  const out: Signal[] = [];
  const byDay = new Map<string, DaySession[]>();
  for (const s of sessions) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const days = [...byDay.keys()].sort();
  for (const d of days) {
    const next = addDays(d as LocalDate, 1);
    const a = byDay.get(d)!.filter(hard);
    const b = (byDay.get(next) ?? []).filter(hard);
    if (a.length && b.length) {
      out.push({ key: `hard:${d}`, level: "warning", message: `Deux jours durs de suite : « ${name(a[0])} » ${fr(d)}, puis « ${name(b[0])} » ${fr(next)}.` });
    }
    const legs = byDay.get(d)!.filter((s) => s.session_type === "strength_legs");
    const key = (byDay.get(next) ?? []).filter((s) => s.priority === "key");
    if (legs.length && key.length) {
      out.push({ key: `legs:${d}`, level: "serious", message: `Musculation des jambes ${fr(d)}, la veille de la séance clé « ${name(key[0])} ».` });
    }
  }
  return out;
}

export type NiggleLike = {
  id: string;
  body_zone: string;
  side: string;
  started_on: string;
  resolved_on: string | null;
  deleted_at?: string | null;
};
export type NiggleEntryLike = { niggle_id: string; date: string; intensity: number; deleted_at?: string | null };

/**
 * Gênes : récurrence au même endroit (même zone et même côté, plusieurs épisodes sur la fenêtre),
 * gêne active depuis longtemps, ou intensité qui monte sur les dernières notes.
 */
export function niggleSignals(niggles: NiggleLike[], entries: NiggleEntryLike[], today: string, windowDays = 120, longDays = 14): Signal[] {
  const live = niggles.filter((n) => !n.deleted_at);
  const out: Signal[] = [];
  const groups = new Map<string, NiggleLike[]>();
  for (const n of live) {
    if (diffDays(today as LocalDate, n.started_on as LocalDate) > windowDays) continue;
    const k = `${n.body_zone}|${n.side}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const [k, list] of groups) {
    if (list.length >= 2) {
      const [zone, side] = k.split("|");
      out.push({ key: `recur:${k}`, level: "serious", message: `Gêne récurrente : ${list.length} épisodes (${zone}, ${side}) en ${windowDays} jours.` });
    }
  }
  for (const n of live.filter((x) => !x.resolved_on)) {
    const age = diffDays(today as LocalDate, n.started_on as LocalDate);
    if (age >= longDays) out.push({ key: `long:${n.id}`, level: "warning", message: `Gêne active depuis ${age} jours (${n.body_zone}, ${n.side}).` });
    const notes = entries.filter((e) => e.niggle_id === n.id && !e.deleted_at).sort((a, b) => a.date.localeCompare(b.date));
    if (notes.length >= 2 && notes.at(-1)!.intensity > notes.at(-2)!.intensity) {
      out.push({ key: `rising:${n.id}`, level: "serious", message: `Gêne en hausse (${n.body_zone}, ${n.side}) : ${notes.at(-2)!.intensity} → ${notes.at(-1)!.intensity}/10.` });
    }
  }
  return out;
}
