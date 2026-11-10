import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  isLocalDate,
  isoWeekday,
  localDate,
  localDateOf,
  weekDays,
  weekStart,
  zonedInstant,
} from ".";

describe("changements d'heure Europe/Paris", () => {
  it("convertit une heure locale en UTC de part et d'autre du passage à l'heure d'hiver", () => {
    expect(zonedInstant(localDate("2026-10-24"), "08:00").toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(zonedInstant(localDate("2026-10-25"), "08:00").toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });

  it("convertit une heure locale en UTC au passage à l'heure d'été", () => {
    expect(zonedInstant(localDate("2027-03-27"), "07:30").toISOString()).toBe("2027-03-27T06:30:00.000Z");
    expect(zonedInstant(localDate("2027-03-28"), "07:30").toISOString()).toBe("2027-03-28T05:30:00.000Z");
  });

  it("rattache une activité au bon jour local, même tard le soir en UTC", () => {
    expect(localDateOf("2026-10-24T22:30:00Z")).toBe("2026-10-25");
    expect(localDateOf("2026-10-25T22:30:00Z")).toBe("2026-10-25");
    expect(localDateOf("2026-10-25T23:30:00Z")).toBe("2026-10-26");
  });

  it("garde des jours calendaires pleins à travers le changement d'heure", () => {
    expect(addDays(localDate("2026-10-24"), 1)).toBe("2026-10-25");
    expect(addDays(localDate("2026-10-25"), 1)).toBe("2026-10-26");
    expect(diffDays(localDate("2026-10-26"), localDate("2026-10-24"))).toBe(2);
    expect(diffDays(localDate("2027-03-29"), localDate("2027-03-27"))).toBe(2);
  });
});

describe("semaines", () => {
  it("commence la semaine le lundi", () => {
    expect(isoWeekday(localDate("2026-10-25"))).toBe(7);
    expect(weekStart(localDate("2026-10-25"))).toBe("2026-10-19");
    expect(weekStart(localDate("2026-10-19"))).toBe("2026-10-19");
    expect(weekDays(localDate("2026-12-31"))).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });
});

describe("validation", () => {
  it("refuse les dates impossibles", () => {
    expect(isLocalDate("2027-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(() => localDate("12/09/2027")).toThrow();
  });
});
