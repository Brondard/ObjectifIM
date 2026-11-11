"use client";

import { v7 as uuidv7 } from "uuid";
import { planImport, sessionFields, type ExistingSession, type ImportPlan, type PlanBlock } from "@/domain/plan/block";
import { nowIso } from "@/lib/time";
import type { SyncEngine } from "./engine";

/** Séances existantes de la période et séances rattachées à un réalisé, lues dans la copie locale. */
export async function importContext(engine: SyncEngine, block: PlanBlock) {
  const [existing, completed] = await Promise.all([
    engine.db.planned_sessions.toArray(),
    engine.db.completed_sessions.where("local_date").between(block.period.start, block.period.end, true, true).toArray(),
  ]);
  const keys = new Set(block.sessions.map((s) => s.key).filter(Boolean));
  return {
    // Période du bloc, plus les séances portant une clé du fichier ailleurs (bloc dont les dates ont glissé).
    existing: existing.filter((e) => !e.deleted_at && ((e.date >= block.period.start && e.date <= block.period.end) || (e.import_key && keys.size))) as ExistingSession[],
    linked: new Set(completed.filter((c) => !c.deleted_at && c.planned_session_id).map((c) => c.planned_session_id!)),
  };
}

export async function previewImport(engine: SyncEngine, block: PlanBlock, prefix: string): Promise<ImportPlan> {
  const { existing, linked } = await importContext(engine, block);
  return planImport(block, existing, linked, uuidv7, prefix);
}

/**
 * Applique un aperçu validé : lot d'import, créations, mises à jour, suppressions logiques, phase
 * éventuelle, entrée de journal. Tout passe par la file de synchronisation (hors ligne compris).
 */
export async function applyImport(
  engine: SyncEngine,
  block: PlanBlock,
  plan: ImportPlan,
  opts: { kind: "json" | "csv" | "md"; source: "import" | "pattern"; fileName: string | null; payload: unknown },
) {
  const batchId = uuidv7();
  const writes: { table: "import_batches" | "planned_sessions" | "phases" | "plan_changes"; id: string; fields: Record<string, unknown> }[] = [];

  // Phase déclarée par le fichier : créée dans la saison qui couvre la période, si aucune phase ne s'y trouve déjà.
  let phaseId: string | null = null;
  if (block.phase) {
    const [seasons, phases] = await Promise.all([engine.db.seasons.toArray(), engine.db.phases.toArray()]);
    const season = seasons.find((s) => !s.deleted_at && s.start_date <= block.period.start && s.end_date >= block.period.end);
    const overlap = phases.find((p) => !p.deleted_at && p.start_date <= block.period.end && p.end_date >= block.period.start);
    if (overlap) phaseId = overlap.id;
    else if (season) {
      phaseId = uuidv7();
      writes.push({
        table: "phases", id: phaseId,
        fields: { season_id: season.id, type: block.phase.type, name: block.phase.name, start_date: block.period.start, end_date: block.period.end, targets: block.phase.targets ?? {} },
      });
    }
  }

  writes.push({
    table: "import_batches", id: batchId,
    fields: {
      format_version: block.format_version, kind: opts.kind, period_start: block.period.start, period_end: block.period.end, phase_id: phaseId,
      summary: { created: plan.creates.length, updated: plan.updates.length, deleted: plan.deletes.length, kept: plan.kept.length, skipped: plan.skipped.length, file: opts.fileName, source: opts.source, objectives: block.phase?.objectives ?? null },
      payload: opts.payload,
    },
  });
  for (const c of plan.creates) writes.push({ table: "planned_sessions", id: c.id, fields: sessionFields(c.session, c.key, batchId, opts.source) });
  for (const u of plan.updates) writes.push({ table: "planned_sessions", id: u.id, fields: sessionFields(u.session, u.key, batchId, opts.source) });
  for (const d of plan.deletes) writes.push({ table: "planned_sessions", id: d.id, fields: { deleted_at: nowIso() } });
  writes.push({
    table: "plan_changes", id: uuidv7(),
    fields: {
      trigger: opts.source === "pattern" ? "pattern_apply" : "import",
      reason: opts.fileName,
      input: { period: block.period, phase: block.phase ?? null, batch_id: batchId },
      chosen_option: "apply",
      affected: [
        ...plan.creates.map((c) => ({ id: c.id, after: { date: c.session.date } })),
        ...plan.updates.map((u) => ({ id: u.id, after: { date: u.session.date } })),
        ...plan.deletes.map((d) => ({ id: d.id, before: { date: d.date }, after: { deleted: true } })),
      ],
    },
  });
  await engine.mutateMany(writes);
  return batchId;
}
