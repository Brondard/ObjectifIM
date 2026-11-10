"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { catchupsIn } from "@/domain/engine/apply";
import type { EngineContext } from "@/domain/engine/types";
import { addDays, compareLocalDates, today, weekStart, type LocalDate } from "@/lib/time";
import type { TargetContext } from "@/domain/targets";
import type { ZoneModel } from "@/domain/zones";
import type { CompletedSession, PlannedSession } from "./db";
import { useSync } from "./provider";

const byTime = (a: PlannedSession, b: PlannedSession) =>
  (a.local_time ?? "99").localeCompare(b.local_time ?? "99") || a.created_at?.localeCompare(b.created_at ?? "") || 0;

/** Séances prévues (non supprimées) entre deux dates incluses. */
export function usePlannedBetween(from: LocalDate, to: LocalDate) {
  const { db } = useSync();
  return useLiveQuery(
    async () =>
      (await db.planned_sessions.where("date").between(from, to, true, true).toArray())
        .filter((s) => !s.deleted_at)
        .sort((a, b) => compareLocalDates(a.date as LocalDate, b.date as LocalDate) || byTime(a, b)),
    [db, from, to],
  );
}

/** Séances réalisées (non supprimées) entre deux dates incluses. */
export function useCompletedBetween(from: LocalDate, to: LocalDate) {
  const { db } = useSync();
  return useLiveQuery(
    async () =>
      (await db.completed_sessions.where("local_date").between(from, to, true, true).toArray()).filter(
        (c) => !c.deleted_at,
      ),
    [db, from, to],
  );
}

export function usePlanned(id: string) {
  const { db } = useSync();
  return useLiveQuery(() => db.planned_sessions.get(id), [db, id]);
}

/** Réalisés rattachés à une séance prévue, y compris supprimés (pour réutiliser une saisie manuelle). */
export function useCompletionsOf(plannedId: string) {
  const { db } = useSync();
  return useLiveQuery(() => db.completed_sessions.where("planned_session_id").equals(plannedId).toArray(), [db, plannedId]);
}

export function useDailyLog(date: LocalDate) {
  const { db } = useSync();
  return useLiveQuery(async () => (await db.daily_logs.where("date").equals(date).toArray()).find((d) => !d.deleted_at) ?? null, [db, date]);
}

export function usePendingCount() {
  const { db } = useSync();
  return useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
}

export function useConflicts() {
  const { db } = useSync();
  return useLiveQuery(() => db.conflicts.toArray(), [db]) ?? [];
}

export function useRejections() {
  const { db } = useSync();
  return useLiveQuery(() => db.rejections.toArray(), [db]) ?? [];
}

/** Réalisé saisi à la main pour une séance prévue, s'il existe (le plus récent). */
export function manualCompletionOf(completions: CompletedSession[] | undefined) {
  return (
    completions
      ?.filter((c) => c.source === "manual")
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null
  );
}

/** Repères, modèles de zones et règles de cible : tout ce qu'il faut pour résoudre une cible hors ligne. */
export function useTargetContext(): TargetContext | undefined {
  const { db } = useSync();
  return useLiveQuery(async () => {
    const [metrics, models, rules] = await Promise.all([
      db.metrics.toArray(),
      db.zone_models.toArray(),
      db.engine_rules.where("rule_key").anyOf("default_intensity_by_type", "intensity_judgement").toArray(),
    ]);
    const params = (key: string) =>
      (rules.find((r) => r.rule_key === key && !r.deleted_at)?.params ?? {}) as Record<string, unknown>;
    return {
      metrics: metrics.map((m) => ({ ...m, value: Number(m.value) })),
      models: models as unknown as ZoneModel[],
      rules: {
        defaultZoneByType: params("default_intensity_by_type") as Record<string, number | null>,
        judgementByType: (params("intensity_judgement").by_session_type ?? {}) as Record<string, string>,
        intensity: {
          skipFirstS: Number(params("intensity_judgement").hr_skip_first_s ?? 180),
          alertPct: Number(params("intensity_judgement").hr_above_ceiling_alert_pct ?? 15),
        },
      },
    };
  }, [db]);
}

export function useMetrics() {
  const { db } = useSync();
  return useLiveQuery(async () => (await db.metrics.toArray()).filter((m) => !m.deleted_at), [db]);
}

export function useZoneModels() {
  const { db } = useSync();
  return useLiveQuery(async () => (await db.zone_models.toArray()).filter((m) => !m.deleted_at), [db]);
}

export function useRaces() {
  const { db } = useSync();
  return useLiveQuery(async () => (await db.races.toArray()).filter((r) => !r.deleted_at), [db]);
}

/**
 * Tout ce que le moteur de replanification lit, pour la semaine qui contient `anchor`.
 * Lu dans la copie locale : le moteur tourne hors ligne.
 */
export function useEngineContext(anchor: LocalDate): EngineContext | undefined {
  const { db } = useSync();
  return useLiveQuery(async () => {
    const start = weekStart(anchor);
    const [sessions, done, phases, races, rules, substitutions, changes] = await Promise.all([
      db.planned_sessions.where("date").between(addDays(start, -7), addDays(start, 13), true, true).toArray(),
      db.completed_sessions.where("local_date").between(addDays(start, -35), addDays(start, 6), true, true).toArray(),
      db.phases.toArray(),
      db.races.toArray(),
      db.engine_rules.toArray(),
      db.substitutions.toArray(),
      db.plan_changes.toArray(),
    ]);
    const phase = phases.find((p) => !p.deleted_at && p.start_date <= anchor && p.end_date >= anchor) ?? null;
    return {
      today: today(),
      sessions: sessions.filter((s) => !s.deleted_at) as EngineContext["sessions"],
      done: done.filter((d) => !d.deleted_at) as EngineContext["done"],
      rules: rules.filter((r) => !r.deleted_at).map((r) => ({ ...r, weight: Number(r.weight), params: (r.params ?? {}) as Record<string, unknown> })),
      phaseType: phase?.type ?? null,
      phaseParams: (phase?.engine_params ?? {}) as Record<string, unknown>,
      aRaceDates: races.filter((r) => !r.deleted_at && r.priority === "A").map((r) => r.date),
      substitutions: substitutions.filter((x) => !x.deleted_at).map((x) => ({ ...x, duration_ratio: Number(x.duration_ratio) })),
      catchupsThisWeek: catchupsIn(changes, start, addDays(start, 6)),
    };
  }, [db, anchor]);
}
