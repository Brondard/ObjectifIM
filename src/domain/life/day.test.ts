import { describe, expect, it } from "vitest";
import { localTimeOf } from "@/lib/time";
import { agendaConflicts, isAllowedCalendarUrl, parseIcsEvents } from "./agenda";
import { daylightNote, simulateGap, sunTimes, wakeTime, yearAgo } from "./day";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "UID:a", "DTSTART;TZID=Europe/Paris:20261118T183000", "DTEND;TZID=Europe/Paris:20261118T200000", "SUMMARY:Réunion\\, budget", "END:VEVENT",
  "BEGIN:VEVENT", "UID:b", "DTSTART:20261119T070000Z", "DTEND:20261119T080000Z", "SUMMARY:Dentiste", "END:VEVENT",
  "BEGIN:VEVENT", "UID:c", "DTSTART;VALUE=DATE:20261121", "DTEND;VALUE=DATE:20261122", "SUMMARY:Mariage", "END:VEVENT",
  // Tous les lundis à 9 h, sauf le 23 novembre, jusqu'au 7 décembre.
  "BEGIN:VEVENT", "UID:d", "DTSTART;TZID=Europe/Paris:20261019T090000", "DTEND;TZID=Europe/Paris:20261019T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T235959Z", "EXDATE;TZID=Europe/Paris:20261123T090000", "SUMMARY:Point d'équipe", "END:VEVENT",
  "BEGIN:VEVENT", "UID:e", "DTSTART:20261120T120000Z", "DTEND:20261120T130000Z", "SUMMARY:Annulé", "STATUS:CANCELLED", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("agenda iCal", () => {
  const events = parseIcsEvents(ICS, "2026-10-19", "2026-12-31");

  it("lit événements datés, en UTC, sur la journée ; ignore les annulés", () => {
    expect(events.find((e) => e.summary === "Réunion, budget")).toMatchObject({ start: "2026-11-18T17:30:00.000Z", end: "2026-11-18T19:00:00.000Z", allDay: false });
    expect(events.find((e) => e.summary === "Mariage")).toMatchObject({ allDay: true, date: "2026-11-21" });
    expect(events.some((e) => e.summary === "Annulé")).toBe(false);
  });

  it("déplie les récurrences hebdomadaires, garde l'heure locale au changement d'heure, respecte EXDATE", () => {
    const team = events.filter((e) => e.summary === "Point d'équipe");
    expect(team.map((e) => e.uid.slice(-10))).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-30", "2026-12-07"]);
    // 9 h à Paris : 07:00 UTC avant le 25 octobre, 08:00 UTC après.
    expect(team[0].start).toBe("2026-10-19T07:00:00.000Z");
    expect(team[1].start).toBe("2026-10-26T08:00:00.000Z");
    expect(localTimeOf(team[1].start)).toBe("09:00:00");
  });

  it("n'accepte que les adresses iCal de Google Agenda", () => {
    expect(isAllowedCalendarUrl("https://calendar.google.com/calendar/ical/moi%40gmail.com/private-abc/basic.ics")).toBe(true);
    expect(isAllowedCalendarUrl("http://calendar.google.com/calendar/ical/x/basic.ics")).toBe(false);
    expect(isAllowedCalendarUrl("https://169.254.169.254/calendar/ical/x.ics")).toBe(false);
    expect(isAllowedCalendarUrl("pas une url")).toBe(false);
  });

  it("repère les séances qui chevauchent un événement ou tombent un jour pris", () => {
    const s = (o: object) => ({ id: "x", date: "2026-11-18", local_time: "19:00", target_duration_s: 3600, title: "Club", session_type: "threshold", status: "planned", ...o });
    const c = agendaConflicts([s({}), s({ id: "y", date: "2026-11-21", local_time: null }), s({ id: "z", date: "2026-11-19", local_time: "09:30" })], events);
    expect(c.map((x) => [x.session.id, x.kind, x.event.summary])).toEqual([["x", "overlap", "Réunion, budget"], ["y", "busy_day", "Mariage"]]);
  });
});

describe("autour de la journée", () => {
  it("heure de lever pour une séance matinale", () => {
    expect(wakeTime("07:30", 30, 25)).toBe("06:35");
    expect(wakeTime("00:20", 30, 0)).toBe("23:50");
  });

  it("lever et coucher du soleil (Paris, solstice d'été, à 3 minutes près)", () => {
    const sun = sunTimes("2026-06-21", 48.8566, 2.3522)!;
    const min = (iso: string) => Number(localTimeOf(iso).slice(0, 2)) * 60 + Number(localTimeOf(iso).slice(3, 5));
    expect(Math.abs(min(sun.sunrise) - (5 * 60 + 47))).toBeLessThanOrEqual(3);
    expect(Math.abs(min(sun.sunset) - (21 * 60 + 58))).toBeLessThanOrEqual(3);
  });

  it("une sortie du soir en novembre finit de nuit", () => {
    const n = daylightNote("2026-11-18", "17:00", 5400, 43.6416, 7.0089)!;
    expect(n.darkAtEnd).toBe(true);
    expect(n.end).toBe("18:30");
    expect(n.sunset < "17:30").toBe(true);
  });

  it("il y a un an : même semaine, 52 semaines plus tôt", () => {
    const c = (d: string, min: number) => ({ id: d, local_date: d, discipline: "run", planned_session_id: null, elapsed_s: min * 60, moving_s: min * 60, distance_m: null, deleted_at: null });
    const r = yearAgo("2026-11-11", [c("2025-11-12", 45), c("2025-11-15", 90), c("2026-11-10", 60)]);
    expect(r).toMatchObject({ weekStart: "2025-11-10", sameDay: "2025-11-12", thenSeconds: 8100, nowSeconds: 3600, thenSessions: 2, hasHistory: true });
    expect(r.onThatDay).toHaveLength(1);
  });

  it("simulateur : ce qui est perdu et ce que la règle des +10 % autorise à la reprise", () => {
    const p = (date: string, min: number, priority = "secondary") => ({ id: date + min, date, discipline: "run", status: "planned", target_duration_s: min * 60, target_distance_m: null, deleted_at: null, priority, session_type: "endurance" });
    const done = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"].map((d) => ({ id: d, local_date: d, discipline: "run", planned_session_id: null, elapsed_s: 8 * 3600, moving_s: 8 * 3600, distance_m: null, deleted_at: null }));
    const r = simulateGap({
      from: "2026-11-16", weeks: 2, increasePct: 10, raceDate: "2027-09-12", done,
      planned: [p("2026-11-17", 60), p("2026-11-21", 100, "key"), p("2026-11-25", 45), p("2026-12-01", 600)],
    });
    expect(r).toMatchObject({ lostSessions: 3, lostSeconds: 205 * 60, returnWeek: "2026-11-30", returnPlannedSeconds: 36000, returnAllowedSeconds: 15840, weeksToRaceAfter: 40 });
    expect(r.lostKey).toEqual([{ date: "2026-11-21", type: "endurance" }]);
  });
});
