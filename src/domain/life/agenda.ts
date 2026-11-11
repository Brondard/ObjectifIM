/**
 * Agenda personnel en lecture seule (adresse secrète iCal de Google Agenda) : événements, récurrences
 * simples, chevauchements avec les séances prévues. Fonctions pures.
 */
import { addDays, diffDays, isoFromMs, isoWeekday, localDateOf, localTimeOf, zonedInstant, type LocalDate } from "@/lib/time";

export type BusyEvent = { uid: string; summary: string; start: string; end: string; allDay: boolean; date: string | null };

/** Dépliage des lignes (RFC 5545) puis propriétés « NOM;PARAMS:VALEUR ». */
function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function prop(line: string) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const [name, ...params] = line.slice(0, i).split(";");
  return { name: name.toUpperCase(), params: Object.fromEntries(params.map((p) => p.split("=") as [string, string])), value: line.slice(i + 1) };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");

/** Instant d'une date-heure ICS : UTC (« Z »), heure locale (fuseau de l'événement traité comme Europe/Paris), ou date seule. */
function parseIcsDate(value: string, params: Record<string, string>): { iso: string; allDay: boolean; date: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || params.VALUE === "DATE") return { iso: zonedInstant(date as LocalDate, "00:00").toISOString(), allDay: true, date };
  if (m[7]) return { iso: `${date}T${m[4]}:${m[5]}:${m[6]}.000Z`, allDay: false, date };
  return { iso: zonedInstant(date as LocalDate, `${m[4]}:${m[5]}:${m[6]}`).toISOString(), allDay: false, date };
}

type Rule = { freq: "DAILY" | "WEEKLY"; interval: number; byday: number[]; until: string | null; count: number | null };
const DAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 } as Record<string, number>;

function parseRule(v: string): Rule | null {
  const p = Object.fromEntries(v.split(";").map((kv) => kv.split("=") as [string, string]));
  if (p.FREQ !== "DAILY" && p.FREQ !== "WEEKLY") return null;
  return {
    freq: p.FREQ, interval: Number(p.INTERVAL ?? 1),
    byday: (p.BYDAY ?? "").split(",").filter(Boolean).map((d) => DAY[d.slice(-2)]).filter(Boolean),
    until: p.UNTIL ? `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}` : null,
    count: p.COUNT ? Number(p.COUNT) : null,
  };
}

/**
 * Événements entre deux dates (incluses). Récurrences quotidiennes et hebdomadaires dépliées
 * (INTERVAL, BYDAY, UNTIL, COUNT, EXDATE) ; les autres récurrences ne gardent que leur première occurrence.
 */
export function parseIcsEvents(text: string, from: string, to: string): BusyEvent[] {
  const out: BusyEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }[]> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT" && cur) {
      const get = (k: string) => cur![k]?.[0];
      const s = get("DTSTART");
      const start = s ? parseIcsDate(s.value, s.params) : null;
      const status = get("STATUS")?.value;
      if (start && status !== "CANCELLED" && get("TRANSP")?.value !== "TRANSPARENT") {
        const e = get("DTEND");
        const end = e ? parseIcsDate(e.value, e.params) : null;
        const duration = end ? Date.parse(end.iso) - Date.parse(start.iso) : start.allDay ? 86_400_000 : 3_600_000;
        const exdates = new Set((cur["EXDATE"] ?? []).flatMap((x) => x.value.split(",").map((v) => parseIcsDate(v, x.params)?.date)));
        const rule = get("RRULE") ? parseRule(get("RRULE")!.value) : null;
        const summary = unescapeText(get("SUMMARY")?.value ?? "Occupé");
        const uid = get("UID")?.value ?? `${start.iso}-${summary}`;
        // Chaque occurrence garde son heure locale (une réunion de 9 h reste à 9 h après le changement d'heure).
        const localStart = start.allDay ? "00:00" : localTimeOf(start.iso);
        const firstDate = start.allDay ? start.date : localDateOf(start.iso);
        const push = (date: string) => {
          if (date < from || date > to || exdates.has(date)) return;
          const st = zonedInstant(date as LocalDate, localStart).getTime();
          out.push({ uid: `${uid}:${date}`, summary, start: isoFromMs(st), end: isoFromMs(st + duration), allDay: start.allDay, date: start.allDay ? date : null });
        };
        if (!rule) push(firstDate);
        else {
          let n = 0;
          const days = rule.freq === "WEEKLY" && rule.byday.length ? rule.byday : [isoWeekday(firstDate as LocalDate)];
          for (let d = firstDate; d <= to && (!rule.until || d <= rule.until); d = addDays(d as LocalDate, 1)) {
            const elapsed = diffDays(d as LocalDate, firstDate as LocalDate);
            const weeks = Math.floor(elapsed / 7);
            const hit = rule.freq === "DAILY"
              ? elapsed % rule.interval === 0
              : days.includes(isoWeekday(d as LocalDate)) && weeks % rule.interval === 0;
            if (!hit) continue;
            n++;
            if (rule.count && n > rule.count) break;
            push(d);
          }
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const p = prop(line);
      if (p) (cur[p.name] ??= []).push({ value: p.value, params: p.params });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export type TimedSession = { id: string; date: string; local_time: string | null; target_duration_s: number | null; title: string | null; session_type: string; status: string };
export type Conflict = { session: TimedSession; event: BusyEvent; kind: "overlap" | "busy_day" };

/** Séances prévues qui chevauchent un événement (ou tombent un jour entièrement occupé). */
export function agendaConflicts(sessions: TimedSession[], events: BusyEvent[]): Conflict[] {
  const out: Conflict[] = [];
  for (const s of sessions.filter((x) => x.status === "planned")) {
    for (const e of events) {
      if (e.allDay) {
        if (e.date === s.date) out.push({ session: s, event: e, kind: "busy_day" });
        continue;
      }
      if (!s.local_time) continue;
      const start = zonedInstant(s.date as LocalDate, s.local_time).getTime();
      const end = start + (s.target_duration_s ?? 3600) * 1000;
      if (Date.parse(e.start) < end && Date.parse(e.end) > start) out.push({ session: s, event: e, kind: "overlap" });
    }
  }
  return out;
}

/** Adresses acceptées : iCal secrète de Google Agenda, en HTTPS. */
export function isAllowedCalendarUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "calendar.google.com" && u.pathname.startsWith("/calendar/ical/") && u.pathname.endsWith(".ics");
  } catch {
    return false;
  }
}
