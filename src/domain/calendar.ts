/**
 * Flux d'agenda (ICS, RFC 5545) des séances prévues, et messages des notifications du soir.
 * Fonctions pures : l'heure courante et les cibles sont passées en paramètres.
 */
import { addDays, addSeconds, zonedInstant, type LocalDate } from "@/lib/time";
import { DISCIPLINES, SESSION_TYPES } from "./labels";

export type CalendarSession = {
  id: string;
  date: string;
  local_time: string | null;
  discipline: string;
  session_type: string;
  status: string;
  title: string | null;
  priority: string;
  target_duration_s: number | null;
  target_distance_m: number | null;
  instructions: string | null;
  updated_at: string;
  deleted_at?: string | null;
};

const label = (s: CalendarSession) => s.title ?? SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES] ?? s.session_type;
const discipline = (s: CalendarSession) => DISCIPLINES[s.discipline as keyof typeof DISCIPLINES] ?? s.discipline;
const minutes = (s: number | null) => (s ? `${Math.round(s / 60)} min` : "");
const distance = (m: number | null, d: string) => (!m ? "" : d === "swim" ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

/** Échappement des valeurs texte ICS : antislash, virgule, point-virgule, retour à la ligne. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliage des lignes à 75 octets (UTF-8), continuation préfixée d'un espace. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    const limit = out.length ? 74 : 75;
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/\+00:?00$/, "Z");
const compactDate = (d: string) => d.replace(/-/g, "");

const STATUS_PREFIX: Record<string, string> = {
  completed: "[fait] ", partial: "[partiel] ", skipped_choice: "[manquée] ", skipped_life: "[manquée] ", skipped_injury: "[manquée] ",
};

/**
 * Agenda d'abonnement : une séance avec heure devient un événement daté (en UTC), sans heure un
 * événement sur la journée. Le statut est rappelé dans le titre ; la cible est dans la description.
 */
export function buildIcs(sessions: CalendarSession[], targetText: (s: CalendarSession) => string | null, now: string, appUrl: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ObjectifIM//Entrainement//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Entraînement",
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const s of sessions) {
    if (s.deleted_at) continue;
    const summary = `${STATUS_PREFIX[s.status] ?? ""}${s.priority === "key" ? "★ " : ""}${label(s)} · ${discipline(s)}${s.target_duration_s ? ` · ${minutes(s.target_duration_s)}` : ""}`;
    const description = [
      [minutes(s.target_duration_s), distance(s.target_distance_m, s.discipline)].filter(Boolean).join(" · "),
      targetText(s),
      s.instructions,
      `${appUrl}/seance/${s.id}`,
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:${s.id}@objectifim`, `DTSTAMP:${utc(now)}`, `LAST-MODIFIED:${utc(s.updated_at)}`);
    if (s.local_time) {
      const start = zonedInstant(s.date as LocalDate, s.local_time);
      const end = addSeconds(start, s.target_duration_s ?? 3600);
      lines.push(`DTSTART:${utc(start.toISOString())}`, `DTEND:${utc(end.toISOString())}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(s.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(s.date as LocalDate, 1))}`, "TRANSP:TRANSPARENT");
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(description)}`, `URL:${appUrl}/seance/${s.id}`);
    if (s.status.startsWith("skipped")) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

export type PushMessage = { title: string; body: string; url: string; tag: string };

/**
 * Messages du soir, au ton factuel : le contenu précis des séances de demain, et les séances du jour
 * ni validées ni marquées manquées. Rien à dire : aucun message.
 */
export function eveningMessages(
  tomorrow: CalendarSession[],
  todayOpen: CalendarSession[],
  targetText: (s: CalendarSession) => string | null,
  prefs: { evening_preview: boolean; evening_unmarked: boolean },
): PushMessage[] {
  const out: PushMessage[] = [];
  const planned = tomorrow.filter((s) => !s.deleted_at && s.status === "planned");
  if (prefs.evening_preview && planned.length) {
    out.push({
      title: planned.length === 1 ? `Demain : ${label(planned[0])}` : `Demain : ${planned.length} séances`,
      body: planned
        .map((s) => [
          `${s.local_time ? `${s.local_time.slice(0, 5)} ` : ""}${label(s)} · ${discipline(s)}`,
          [minutes(s.target_duration_s), distance(s.target_distance_m, s.discipline)].filter(Boolean).join(", "),
          targetText(s),
          s.instructions?.split("\n")[0],
        ].filter(Boolean).join(" · "))
        .join("\n"),
      url: planned.length === 1 ? `/seance/${planned[0].id}` : "/semaine",
      tag: "evening-preview",
    });
  }
  const open = todayOpen.filter((s) => !s.deleted_at && s.status === "planned");
  if (prefs.evening_unmarked && open.length) {
    out.push({
      title: open.length === 1 ? "Séance du jour non renseignée" : `${open.length} séances du jour non renseignées`,
      body: `${open.map(label).join(", ")} : faite, partielle ou manquée ?`,
      url: "/",
      tag: "evening-unmarked",
    });
  }
  return out;
}
