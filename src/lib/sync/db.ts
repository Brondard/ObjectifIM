import Dexie, { type Table } from "dexie";
import type { Tables } from "@/lib/supabase/database.types";
import type { OutboxEntry, PullTable } from "./core";

export type PlannedSession = Tables<"planned_sessions">;
export type CompletedSession = Tables<"completed_sessions">;
export type DailyLog = Tables<"daily_logs">;
export type PlanChange = Tables<"plan_changes">;
export type Season = Tables<"seasons">;
export type Phase = Tables<"phases">;
export type Race = Tables<"races">;
export type SessionTemplate = Tables<"session_templates">;

export type ConflictRecord = {
  key: string; // `${table}:${id}:${field}`
  table: string;
  id: string;
  field: string;
  server: unknown;
  client: unknown;
  at: number;
};

export type RejectionRecord = {
  mutation_id: string;
  table: string;
  id: string;
  fields: Record<string, unknown>;
  message: string;
  at: number;
};

/** Copie locale (IndexedDB) des données de l'utilisateur, une base par compte. */
export class LocalDb extends Dexie {
  planned_sessions!: Table<PlannedSession, string>;
  completed_sessions!: Table<CompletedSession, string>;
  daily_logs!: Table<DailyLog, string>;
  plan_changes!: Table<PlanChange, string>;
  seasons!: Table<Season, string>;
  phases!: Table<Phase, string>;
  races!: Table<Race, string>;
  session_templates!: Table<SessionTemplate, string>;
  outbox!: Table<OutboxEntry, number>;
  conflicts!: Table<ConflictRecord, string>;
  rejections!: Table<RejectionRecord, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(readonly userId: string) {
    super(`objectifim-${userId}`);
    this.version(1).stores({
      planned_sessions: "id, date",
      completed_sessions: "id, local_date, planned_session_id",
      daily_logs: "id, date",
      plan_changes: "id",
      seasons: "id",
      phases: "id, start_date",
      races: "id, date",
      session_templates: "id",
      outbox: "++seq, table, [table+id]",
      conflicts: "key",
      rejections: "mutation_id",
      meta: "key",
    });
  }

  rows(table: PullTable): Table<Record<string, unknown> & { id: string }, string> {
    return this.table(table);
  }
}
