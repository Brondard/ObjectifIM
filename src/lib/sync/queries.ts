"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { compareLocalDates, type LocalDate } from "@/lib/time";
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
