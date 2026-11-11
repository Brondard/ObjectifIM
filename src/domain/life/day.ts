/**
 * Autour d'une journée : heure de lever pour une séance matinale, lever et coucher du soleil (calcul
 * astronomique, sans réseau), « il y a un an », simulateur de scénario. Fonctions pures.
 */
import { addDays, diffDays, isoFromMs, localTimeOf, weekStart, type LocalDate } from "@/lib/time";
import { completedDuration, type CompletedLike, type PlannedLike } from "../week";

// ─── Lever ────────────────────────────────────────────────────────────────

/** Heure de lever : départ de la séance moins la préparation et le trajet. */
export function wakeTime(localTime: string, prepMin: number, travelMin: number): string {
  const [h, m] = localTime.split(":").map(Number);
  const t = (((h * 60 + m - prepMin - travelMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// ─── Soleil (algorithme de la NOAA, précision de l'ordre de la minute) ────

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Lever et coucher du soleil (instants UTC) pour une date et un lieu ; null au-delà des cercles polaires. */
export function sunTimes(date: string, lat: number, lng: number): { sunrise: string; sunset: string } | null {
  const dayOfYear = diffDays(date as LocalDate, `${date.slice(0, 4)}-01-01` as LocalDate) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = deg(Math.acos(cosH));
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const minutes = (sign: 1 | -1) => 720 - 4 * (lng + sign * ha) - eqTime;
  return { sunrise: isoFromMs(midnight + minutes(1) * 60_000), sunset: isoFromMs(midnight + minutes(-1) * 60_000) };
}

/** Une séance finit-elle de nuit ou commence-t-elle avant le jour ? Heures locales pour l'affichage. */
export function daylightNote(date: string, localTime: string, durationS: number, lat: number, lng: number) {
  const sun = sunTimes(date, lat, lng);
  if (!sun) return null;
  const rise = localTimeOf(sun.sunrise).slice(0, 5);
  const set = localTimeOf(sun.sunset).slice(0, 5);
  const [h, m] = localTime.split(":").map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + Math.round(durationS / 60);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  return {
    sunrise: rise,
    sunset: set,
    end,
    darkAtStart: startMin < toMin(rise),
    darkAtEnd: endMin > toMin(set),
  };
}

// ─── Il y a un an ─────────────────────────────────────────────────────────

/**
 * La même semaine l'an dernier (52 semaines plus tôt, même jour de la semaine) : volume et séances,
 * comparés à la semaine en cours.
 */
export function yearAgo<T extends CompletedLike>(today: string, completed: T[]) {
  const thisMonday = weekStart(today as LocalDate);
  const thenMonday = addDays(thisMonday, -364);
  const sameDay = addDays(today as LocalDate, -364);
  const inWeek = (m: string): T[] => completed.filter((c) => !c.deleted_at && c.local_date >= m && c.local_date <= addDays(m as LocalDate, 6));
  const total = (l: CompletedLike[]) => l.reduce((a, c) => a + completedDuration(c), 0);
  const then = inWeek(thenMonday);
  return {
    weekStart: thenMonday,
    sameDay,
    thenSeconds: total(then),
    nowSeconds: total(inWeek(thisMonday)),
    thenSessions: then.length,
    onThatDay: completed.filter((c) => !c.deleted_at && c.local_date === sameDay),
    hasHistory: completed.some((c) => !c.deleted_at && c.local_date <= sameDay),
  };
}

// ─── Simulateur de scénario ───────────────────────────────────────────────

export type ScenarioInput = {
  from: string;
  weeks: number;
  planned: (PlannedLike & { priority: string; session_type: string })[];
  done: CompletedLike[];
  raceDate: string | null;
  increasePct: number;
};

/**
 * « Si je manque les N prochaines semaines » : ce qui est perdu, et ce que la règle des +10 % autoriserait
 * à la reprise (référence : moyenne des 4 dernières semaines réalisées, qui inclut alors la coupure).
 */
export function simulateGap(i: ScenarioInput) {
  const start = weekStart(i.from as LocalDate);
  const end = addDays(start, 7 * i.weeks - 1);
  const lost = i.planned.filter((p) => !p.deleted_at && p.status === "planned" && p.date >= i.from && p.date <= end);
  const byDiscipline: Record<string, number> = {};
  for (const p of lost) byDiscipline[p.discipline] = (byDiscipline[p.discipline] ?? 0) + (p.target_duration_s ?? 0);
  const weekDone = (m: string) => i.done.filter((c) => !c.deleted_at && c.local_date >= m && c.local_date <= addDays(m as LocalDate, 6)).reduce((a, c) => a + completedDuration(c), 0);
  const back = addDays(end, 1);
  // Les 4 semaines avant la reprise : coupure (0) et réalisé avant elle.
  const reference = [1, 2, 3, 4].map((k) => {
    const m = addDays(back, -7 * k);
    return m >= start ? 0 : weekDone(m);
  });
  const refAvg = reference.reduce((a, b) => a + b, 0) / 4;
  const returnPlanned = i.planned.filter((p) => !p.deleted_at && p.date >= back && p.date <= addDays(back, 6)).reduce((a, p) => a + (p.target_duration_s ?? 0), 0);
  const allowed = refAvg * (1 + i.increasePct / 100);
  return {
    from: start,
    to: end,
    lostSessions: lost.length,
    lostKey: lost.filter((p) => p.priority === "key").map((p) => ({ date: p.date, type: p.session_type })),
    lostSeconds: lost.reduce((a, p) => a + (p.target_duration_s ?? 0), 0),
    byDiscipline,
    returnWeek: back,
    returnPlannedSeconds: returnPlanned,
    returnAllowedSeconds: Math.round(allowed),
    weeksToRaceAfter: i.raceDate ? Math.floor(diffDays(i.raceDate as LocalDate, back) / 7) : null,
  };
}
