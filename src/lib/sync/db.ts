import Dexie, { type Table } from "dexie";
import type { Tables } from "@/lib/supabase/database.types";
import type { Streams } from "@/domain/strava";
import type { OutboxEntry, PullTable } from "./core";

export type PlannedSession = Tables<"planned_sessions">;
export type CompletedSession = Tables<"completed_sessions">;
export type DailyLog = Tables<"daily_logs">;
export type PlanChange = Tables<"plan_changes">;
export type Season = Tables<"seasons">;
export type Phase = Tables<"phases">;
export type Race = Tables<"races">;
export type SessionTemplate = Tables<"session_templates">;
export type MetricRow = Tables<"metrics">;
export type ZoneModelRow = Tables<"zone_models">;
export type EngineRule = Tables<"engine_rules">;
export type SubstitutionRow = Tables<"substitutions">;
export type Niggle = Tables<"niggles">;
export type NiggleEntry = Tables<"niggle_entries">;
export type RacePlan = Tables<"race_plans">;
export type Checklist = Tables<"checklists">;
export type ChecklistItem = Tables<"checklist_items">;
export type NutritionProduct = Tables<"nutrition_products">;
export type NutritionProtocol = Tables<"nutrition_protocols">;
export type ToleranceLog = Tables<"tolerance_logs">;
export type PushSubscriptionRow = Tables<"push_subscriptions">;
export type WeekTemplate = Tables<"week_templates">;
export type WeekTemplateItem = Tables<"week_template_items">;
export type ImportBatch = Tables<"import_batches">;

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
  metrics!: Table<MetricRow, string>;
  zone_models!: Table<ZoneModelRow, string>;
  engine_rules!: Table<EngineRule, string>;
  substitutions!: Table<SubstitutionRow, string>;
  niggles!: Table<Niggle, string>;
  niggle_entries!: Table<NiggleEntry, string>;
  race_plans!: Table<RacePlan, string>;
  checklists!: Table<Checklist, string>;
  checklist_items!: Table<ChecklistItem, string>;
  nutrition_products!: Table<NutritionProduct, string>;
  nutrition_protocols!: Table<NutritionProtocol, string>;
  tolerance_logs!: Table<ToleranceLog, string>;
  push_subscriptions!: Table<PushSubscriptionRow, string>;
  week_templates!: Table<WeekTemplate, string>;
  week_template_items!: Table<WeekTemplateItem, string>;
  import_batches!: Table<ImportBatch, string>;
  outbox!: Table<OutboxEntry, number>;
  conflicts!: Table<ConflictRecord, string>;
  rejections!: Table<RejectionRecord, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  /** Cache local des flux (gros volumes, jamais retéléchargés). Clé : id de la séance réalisée. */
  streams!: Table<{ id: string; data: Streams }, string>;

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
    // Jalon 3 : repères, zones et règles (lecture des cibles par défaut).
    this.version(2).stores({
      metrics: "id, kind",
      zone_models: "id",
      engine_rules: "id, rule_key",
    });
    // Jalon 4 : flux Strava en cache.
    this.version(3).stores({ streams: "id" });
    // Jalon 5 : table de substitutions du mode déplacement.
    this.version(4).stores({ substitutions: "id" });
    // Jalon 6 : gênes.
    this.version(5).stores({ niggles: "id, body_zone", niggle_entries: "id, niggle_id" });
    // Jalon 7 : courses et nutrition (lisibles hors ligne : mode course au bord de la ligne de départ).
    this.version(6).stores({
      race_plans: "id, race_id",
      checklists: "id, race_id",
      checklist_items: "id, checklist_id",
      nutrition_products: "id",
      nutrition_protocols: "id",
      tolerance_logs: "id, product_id",
    });
    // Jalon 8 : abonnements push de chaque appareil.
    this.version(7).stores({ push_subscriptions: "id, endpoint" });
    // Jalon 9a : construction du plan (motifs de semaine, lots d'import).
    this.version(8).stores({ week_templates: "id", week_template_items: "id, week_template_id", import_batches: "id" });
  }

  rows(table: PullTable): Table<Record<string, unknown> & { id: string }, string> {
    return this.table(table);
  }
}
