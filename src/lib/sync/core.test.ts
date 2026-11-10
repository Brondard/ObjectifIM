import { describe, expect, it } from "vitest";
import { compactOutbox, isRejection, overlayPending, pullFrom, type OutboxEntry } from "./core";

const entry = (seq: number, id: string, fields: Record<string, unknown>, base: Record<string, unknown>, ts = seq): OutboxEntry => ({
  seq, mutation_id: `m${seq}`, table: "planned_sessions", id, fields, base, ts,
});

describe("compactOutbox", () => {
  it("fusionne les écritures d'une même ligne en gardant la base connue du serveur", () => {
    const [m] = compactOutbox([
      entry(1, "a", { status: "completed" }, { status: "planned" }),
      entry(2, "a", { status: "partial", target_duration_s: 1800 }, { status: "completed", target_duration_s: 3600 }),
    ]);
    expect(m.fields).toEqual({ status: "partial", target_duration_s: 1800 });
    expect(m.base).toEqual({ status: "planned", target_duration_s: 3600 });
    expect(m.ts).toBe(2);
    expect(m.seqs).toEqual([1, 2]);
  });

  it("ne prend pas pour base une valeur créée localement", () => {
    const [m] = compactOutbox([
      entry(1, "a", { date: "2026-11-10", discipline: "run" }, {}),
      entry(2, "a", { date: "2026-11-12" }, { date: "2026-11-10" }),
    ]);
    expect(m.base).toEqual({});
    expect(m.fields.date).toBe("2026-11-12");
  });

  it("garde les lignes distinctes séparées, dans l'ordre", () => {
    const out = compactOutbox([entry(3, "b", { x: 1 }, {}), entry(1, "a", { x: 1 }, {}), entry(2, "b", { y: 2 }, {})]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[1].fields).toEqual({ y: 2, x: 1 });
  });
});

describe("overlayPending", () => {
  it("réapplique les écritures locales sur la ligne serveur", () => {
    const row = { id: "a", status: "planned", date: "2026-11-10" };
    expect(overlayPending(row, [entry(1, "a", { status: "completed" }, {})])).toEqual({ ...row, status: "completed" });
    expect(overlayPending(row, [])).toBe(row);
  });
});

describe("curseur", () => {
  it("relit une fenêtre de révisions déjà vues", () => {
    expect(pullFrom(0)).toBe(0);
    expect(pullFrom(1000)).toBe(800);
  });
});

describe("isRejection", () => {
  it("distingue un rejet de la base d'une coupure réseau", () => {
    expect(isRejection({ code: "23514" })).toBe(true);
    expect(isRejection({ code: "42703" })).toBe(true);
    expect(isRejection({ code: "08006" })).toBe(false);
    expect(isRejection({ code: "" })).toBe(false);
    expect(isRejection(null)).toBe(false);
  });
});
