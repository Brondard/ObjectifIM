/**
 * Analyse complète d'une séance réalisée, à partir de ses flux. Le résultat est mis en cache dans
 * completed_sessions.analysis (versionné) pour que les vues d'ensemble n'aient pas à relire les flux.
 */
import { analyzeIntensity, EASY_TYPES } from "../intensity";
import { parseIntensity, SessionStructure } from "../session-structure";
import type { Streams } from "../strava";
import { easyCeiling, resolveTargets, type TargetContext } from "../targets";
import { computeZones, isApproximate, zoneModelAt, type Basis } from "../zones";
import { SESSION_ANALYSIS_VERSION, type SessionAnalysis } from "./rigor";
import { bestEfforts } from "../life/records";
import { blockPaces, cadenceDrop, cardiacDrift, timeInZones } from "./streams";

export type AnalysisCompletion = {
  local_date: string;
  discipline: string;
  moving_s: number | null;
  elapsed_s: number | null;
  hr_reliable: boolean | null;
};

export type AnalysisPlanned = {
  date: string;
  discipline: string;
  session_type: string;
  target_intensity: unknown;
  structure: unknown;
};

const EARLIEST = { earliest: true };

/**
 * Empreinte de tout ce qui change le résultat d'une analyse hors des flux : repères, modèles de zones,
 * règles de jugement. Une analyse dont l'empreinte diffère est périmée et se recalcule.
 */
export function contextKey(ctx: TargetContext): string {
  const metrics = ctx.metrics.filter((m) => !m.deleted_at).map((m) => [m.kind, Number(m.value), m.measured_on]).sort();
  const models = ctx.models
    .filter((m) => !m.deleted_at)
    .map((m) => [m.discipline, m.basis, m.method, m.valid_from, m.bounds, m.overrides ?? null])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const text = JSON.stringify([metrics, models, ctx.rules]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

const hasHr = (s: Streams, c: AnalysisCompletion) => c.hr_reliable !== false && Array.isArray(s.heartrate) && (s.heartrate as number[]).some((v) => v > 30);

const has = (s: Streams, k: keyof Streams) => Array.isArray(s[k]) && (s[k] as unknown[]).some((v) => typeof v === "number" && v > 0);

/** Cible absolue de jugement : arbitrage 7 ; si la FC est déclarée aberrante, l'allure prend le relais. */
export function judgedTarget(planned: AnalysisPlanned, completion: AnalysisCompletion, ctx: TargetContext) {
  const targets = resolveTargets(planned, ctx, parseIntensity).filter((t) => t.status === "ok");
  const usable = completion.hr_reliable === false ? targets.filter((t) => t.basis !== "hr") : targets;
  const t = usable[0];
  return t && t.status === "ok" ? { basis: t.basis, min: t.min, max: t.max, max_end: t.max_end ?? null, end_from_pct: t.end_from_pct ?? null } : null;
}

export function analyzeSession(c: AnalysisCompletion, planned: AnalysisPlanned | null, streams: Streams, ctx: TargetContext): SessionAnalysis {
  const params = ctx.rules.intensity ?? { skipFirstS: 180, alertPct: 15 };

  const target = planned ? judgedTarget(planned, c, ctx) : null;
  const intensity = planned && target ? analyzeIntensity(streams, target, EASY_TYPES.has(planned.session_type), params) : null;

  // Sortie de course non planifiée : temps au-dessus du plafond de footing, à titre d'information (pas de verdict).
  const footing = !planned && c.discipline === "run" && hasHr(streams, c) ? easyCeiling("endurance", ctx.rules.easyCeilings) : null;
  const unplanned_easy = footing && footing.status === "ok" ? analyzeIntensity(streams, { basis: "hr", min: null, max: footing.max }, true, params) : null;

  // Temps par zone : FC si fiable, sinon allure (course) ou puissance (vélo).
  const hrOk = c.hr_reliable !== false && has(streams, "heartrate");
  const basis: Basis | null =
    c.discipline === "run" ? (hrOk ? "hr" : has(streams, "velocity_smooth") ? "pace" : null)
    : c.discipline === "bike" ? (has(streams, "watts") && zoneModelAt(ctx.models, "bike", "power", c.local_date) ? "power" : hrOk ? "hr" : null)
    : null;
  let zones: SessionAnalysis["zones"] = null;
  if (basis) {
    const model = zoneModelAt(ctx.models, c.discipline, basis, c.local_date, EARLIEST);
    const computed = model ? computeZones(model, ctx.metrics, c.local_date, EARLIEST) : null;
    if (model && computed?.ok) {
      const t = timeInZones(streams, basis, computed.zones, basis === "hr" ? params.skipFirstS : 0);
      zones = {
        basis, method: model.method, seconds: t.seconds, outside: t.outside, bounds: computed.zones,
        approx: isApproximate(c.local_date, model, computed.references),
      };
    }
  }

  // Dérive et cadence : séances continues d'au moins une heure, à allure régulière.
  const steady = !planned || EASY_TYPES.has(planned.session_type);
  const long = (c.moving_s ?? c.elapsed_s ?? 0) >= 3600;
  const drift =
    steady && long && hrOk && (c.discipline === "run" || c.discipline === "bike")
      ? cardiacDrift(streams, c.discipline === "bike" && has(streams, "watts") ? "power" : "pace")
      : null;
  const cadence = steady && long && (c.discipline === "run" || c.discipline === "bike") ? cadenceDrop(streams, c.discipline) : null;

  const structure = planned?.structure ? SessionStructure.safeParse(planned.structure) : null;
  const blocks = structure?.success ? blockPaces(streams, structure.data) : null;

  return { version: SESSION_ANALYSIS_VERSION, ctx_key: contextKey(ctx), best: bestEfforts(streams, c.discipline), intensity, unplanned_easy, zones, drift: drift && c.discipline === "bike" && drift.mode === "pace" ? null : drift, cadence, blocks };
}
