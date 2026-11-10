import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/time";
import { planMark } from "./marking";
import { moveChange, planDuplicate, planMove } from "./planning";
import { deltaRatio, dueBy, volumes, type CompletedLike, type PlannedLike } from "./week";

const planned = (o: Partial<PlannedLike> = {}): PlannedLike => ({
  id: "p1", date: "2026-11-10", discipline: "run", status: "planned",
  target_duration_s: 3600, target_distance_m: 10000, deleted_at: null, ...o,
});
const completed = (o: Partial<CompletedLike> = {}): CompletedLike => ({
  id: "c1", local_date: "2026-11-10", discipline: "run", planned_session_id: "p1",
  elapsed_s: 3700, moving_s: 3500, distance_m: 9800, source: "manual", deleted_at: null, ...o,
});

describe("volumes", () => {
  it("compare prévu et réalisé par discipline, réalisé imprévu compris", () => {
    const { byDiscipline, total } = volumes(
      [
        planned({ status: "completed" }),
        planned({ id: "p2", status: "skipped_life" }),
        planned({ id: "p3", discipline: "swim", target_duration_s: 2700, target_distance_m: 2500 }),
        planned({ id: "p4", deleted_at: "2026-11-09T10:00:00Z" }),
      ],
      [completed(), completed({ id: "c2", planned_session_id: null, discipline: "bike", moving_s: 5400, distance_m: 40000 })],
    );
    expect(byDiscipline.run).toMatchObject({
      planned_s: 7200, done_s: 3500, planned_count: 2, done_count: 1, skipped_count: 1, open_count: 0,
    });
    expect(byDiscipline.swim).toMatchObject({ planned_s: 2700, done_s: 0, open_count: 1 });
    expect(byDiscipline.bike).toMatchObject({ planned_s: 0, done_s: 5400, planned_count: 0 });
    expect(total).toMatchObject({ planned_s: 9900, done_s: 8900, planned_count: 3 });
  });

  it("calcule l'écart signé", () => {
    expect(deltaRatio(3000, 3600)).toBeCloseTo(-1 / 6);
    expect(deltaRatio(100, 0)).toBeNull();
  });
});

const ctx = { manualCompletion: null, newId: "new", at: "2026-11-10T19:00:00.000Z" };

describe("planMark", () => {
  it("« fait » en un geste : statut + réalisé à la durée prévue", () => {
    const [p, c] = planMark(planned(), { kind: "done" }, ctx);
    expect(p.fields).toEqual({ status: "completed", skip_note: null });
    expect(c).toMatchObject({
      table: "completed_sessions", id: "new",
      fields: { planned_session_id: "p1", moving_s: 3600, local_date: "2026-11-10", discipline: "run",
                match_status: "confirmed", source: "manual", distance_m: 10000 },
    });
  });

  it("« partiel » garde la durée réelle", () => {
    const [p, c] = planMark(planned(), { kind: "partial", duration_s: 1800, rpe: 7 }, ctx);
    expect(p.fields.status).toBe("partial");
    expect(c.fields).toMatchObject({ moving_s: 1800, rpe: 7, distance_m: null });
  });

  it("« manqué » enregistre la raison et retire le réalisé saisi à la main", () => {
    const writes = planMark(planned({ status: "completed" }), { kind: "skipped", reason: "injury", note: " genou " }, {
      ...ctx, manualCompletion: completed(),
    });
    expect(writes).toEqual([
      { table: "planned_sessions", id: "p1", fields: { status: "skipped_injury", skip_note: "genou" } },
      { table: "completed_sessions", id: "c1", fields: { deleted_at: ctx.at } },
    ]);
  });

  it("refaire « fait » réutilise le réalisé existant au lieu d'en créer un second", () => {
    const writes = planMark(planned(), { kind: "done" }, {
      ...ctx, manualCompletion: completed({ deleted_at: "2026-11-10T18:00:00Z" }),
    });
    expect(writes[1]).toMatchObject({ id: "c1", fields: { deleted_at: null } });
  });

  it("« annuler » revient à prévu", () => {
    const writes = planMark(planned({ status: "skipped_choice" }), { kind: "reset" }, ctx);
    expect(writes).toEqual([{ table: "planned_sessions", id: "p1", fields: { status: "planned", skip_note: null } }]);
  });
});

describe("planification", () => {
  it("déplacer garde la date d'origine, revenir l'efface", () => {
    const moved = planMove(planned(), localDate("2026-11-12"));
    expect(moved).toEqual({ date: "2026-11-12", original_date: "2026-11-10" });
    expect(planMove(planned({ date: "2026-11-12", original_date: "2026-11-10" }), localDate("2026-11-13")))
      .toEqual({ date: "2026-11-13", original_date: "2026-11-10" });
    expect(planMove(planned({ date: "2026-11-12", original_date: "2026-11-10" }), localDate("2026-11-10")))
      .toEqual({ date: "2026-11-10", original_date: null });
    expect(moveChange(planned(), localDate("2026-11-12")).affected[0].after.date).toBe("2026-11-12");
  });

  it("duplique une semaine sur la suivante en repartant à zéro", () => {
    let n = 0;
    const copies = planDuplicate(
      [
        { ...planned({ status: "completed", original_date: "2026-11-09" }), session_type: "long", import_key: "k1" },
        planned({ id: "p2", deleted_at: "2026-11-09T00:00:00Z" }),
      ],
      7,
      () => `id${++n}`,
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toEqual({
      id: "id1",
      fields: { date: "2026-11-17", status: "planned", source: "manual", discipline: "run", session_type: "long",
                target_duration_s: 3600, target_distance_m: 10000 },
    });
  });
});

describe("dueBy", () => {
  it("ne compte pas comme écart une séance du jour pas encore faite", () => {
    expect(dueBy(planned({ date: "2026-11-09" }), "2026-11-10")).toBe(true);
    expect(dueBy(planned({ date: "2026-11-10" }), "2026-11-10")).toBe(false);
    expect(dueBy(planned({ date: "2026-11-10", status: "completed" }), "2026-11-10")).toBe(true);
    expect(dueBy(planned({ date: "2026-11-11", status: "completed" }), "2026-11-10")).toBe(false);
  });
});
