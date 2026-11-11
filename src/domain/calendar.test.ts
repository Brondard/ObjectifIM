import { describe, expect, it } from "vitest";
import { buildIcs, eveningMessages, icsEscape, icsFold, type CalendarSession } from "./calendar";

const s = (o: Partial<CalendarSession> = {}): CalendarSession => ({
  id: "abc", date: "2026-10-25", local_time: "08:00", discipline: "run", session_type: "long", status: "planned",
  title: "Sortie longue", priority: "key", target_duration_s: 6000, target_distance_m: 18000, instructions: "Z2, ravito à 45'",
  updated_at: "2026-10-20T10:00:00.000Z", ...o,
});

describe("flux ICS", () => {
  const ics = buildIcs([s(), s({ id: "d", local_time: null, discipline: "swim", session_type: "endurance", title: null, priority: "secondary", target_distance_m: 2500, status: "skipped_life" })],
    () => "FC Z2 · 116–136 bpm", "2026-11-11T08:00:00.000Z", "https://objectif-im.vercel.app");
  const lines = ics.split("\r\n");

  it("séance avec heure : instant UTC, changement d'heure compris", () => {
    // 25 octobre 2026, 08:00 à Paris = 07:00 UTC (passage à l'heure d'hiver la nuit même).
    expect(lines).toContain("DTSTART:20261025T070000Z");
    expect(lines).toContain("DTEND:20261025T084000Z");
    expect(lines).toContain("UID:abc@objectifim");
  });

  it("séance sans heure : journée entière ; manquée : annulée et signalée", () => {
    expect(lines).toContain("DTSTART;VALUE=DATE:20261025");
    expect(lines).toContain("DTEND;VALUE=DATE:20261026");
    expect(lines).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:[manquée] Endurance · Natation");
  });

  it("titre, cible et lien dans l'événement, texte échappé", () => {
    expect(ics).toContain("SUMMARY:★ Sortie longue · Course à pied · 100 min");
    expect(ics.replace(/\r\n /g, "")).toContain("DESCRIPTION:100 min · 18\\,0 km\\nFC Z2 · 116–136 bpm\\nZ2\\, ravito à 45'\\nhttps://objectif-im.vercel.app/seance/abc");
  });

  it("structure valide : CRLF, lignes de 75 octets au plus", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });

  it("échappement et pliage", () => {
    expect(icsEscape("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const folded = icsFold("X".repeat(80));
    expect(folded.split("\r\n ")).toHaveLength(2);
    expect(icsFold("é".repeat(40)).split("\r\n ").every((p) => new TextEncoder().encode(p).length <= 75)).toBe(true);
  });
});

describe("notifications du soir", () => {
  const prefs = { evening_preview: true, evening_unmarked: true };

  it("contenu précis de la séance de demain", () => {
    const [m] = eveningMessages([s()], [], () => "FC Z2 · 116–136 bpm", prefs);
    expect(m).toMatchObject({ title: "Demain : Sortie longue", url: "/seance/abc", tag: "evening-preview" });
    expect(m.body).toBe("08:00 Sortie longue · Course à pied · 100 min, 18,0 km · FC Z2 · 116–136 bpm · Z2, ravito à 45'");
  });

  it("relance factuelle si une séance du jour n'est pas renseignée", () => {
    const msgs = eveningMessages([], [s({ title: "Footing" }), s({ id: "x", status: "completed" })], () => null, prefs);
    expect(msgs).toEqual([{ title: "Séance du jour non renseignée", body: "Footing : faite, partielle ou manquée ?", url: "/", tag: "evening-unmarked" }]);
  });

  it("rien à dire : aucun message ; préférences respectées", () => {
    expect(eveningMessages([], [], () => null, prefs)).toEqual([]);
    expect(eveningMessages([s()], [s()], () => null, { evening_preview: false, evening_unmarked: false })).toEqual([]);
  });
});
