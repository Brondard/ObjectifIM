/**
 * Cible d'intensité d'une séance, résolue en valeurs absolues à la date de la séance.
 *
 * Ordre de priorité :
 *   1. la cible saisie sur la séance (zone ou plage absolue) ;
 *   2. sinon la cible par défaut du type de séance (règle `default_intensity_by_type`),
 *      sur la grandeur qui sert à juger ce type (règle `intensity_judgement`, arbitrage 7).
 */
import type { Intensity } from "./session-structure";
import { computeZones, metricAt, zoneModelAt, type Basis, type Method, type Metric, type MetricKind, type Reference, type ZoneModel } from "./zones";

export type TargetRules = {
  /** Type de séance → numéro de zone (null : pas de cible par défaut). */
  defaultZoneByType: Record<string, number | null>;
  /** Type de séance (course à pied) → critère : hr, pace, pace_then_hr, both. */
  judgementByType: Record<string, string>;
};

export type TargetContext = { models: ZoneModel[]; metrics: Metric[]; rules: TargetRules };

export type ResolvedTarget =
  | {
      status: "ok";
      basis: Basis;
      zone: number | null;
      min: number | null;
      max: number | null;
      source: "session" | "default";
      method: Method | null;
      references: Reference[];
    }
  | { status: "no_model"; basis: Basis; zone: number; source: "session" | "default" }
  | { status: "missing_metrics"; basis: Basis; zone: number; method: Method; missing: MetricKind[]; source: "session" | "default" };

export type SessionLike = {
  date: string;
  discipline: string;
  session_type: string;
  target_intensity?: unknown;
};

/** Grandeurs de jugement d'une séance, principale d'abord (arbitrage 7). */
export function judgementBases(session: SessionLike, ctx: TargetContext): Basis[] {
  switch (session.discipline) {
    case "swim":
      return ["swim_pace"];
    case "bike": {
      // Puissance si une FTP et un modèle de puissance existent à la date, sinon FC.
      const power = metricAt(ctx.metrics, "ftp", session.date) && zoneModelAt(ctx.models, "bike", "power", session.date);
      return power ? ["power"] : ["hr"];
    }
    case "run":
      switch (ctx.rules.judgementByType[session.session_type] ?? "hr") {
        case "pace":
          return ["pace"];
        case "pace_then_hr":
        case "both":
          return ["pace", "hr"];
        default:
          return ["hr"];
      }
    default:
      return [];
  }
}

function resolveZone(
  session: SessionLike,
  basis: Basis,
  zone: number,
  source: "session" | "default",
  ctx: TargetContext,
): ResolvedTarget {
  const model = zoneModelAt(ctx.models, session.discipline, basis, session.date);
  if (!model) return { status: "no_model", basis, zone, source };
  const computed = computeZones(model, ctx.metrics, session.date);
  if (!computed.ok) return { status: "missing_metrics", basis, zone, method: model.method, missing: computed.missing, source };
  const range = computed.zones.find((z) => z.zone === zone);
  if (!range) return { status: "no_model", basis, zone, source };
  return { status: "ok", basis, zone, min: range.min, max: range.max, source, method: model.method, references: computed.references };
}

/** Résout une cible explicite (zone ou plage), par exemple celle d'une étape de structure. */
export function resolveIntensity(session: SessionLike, intensity: Intensity, ctx: TargetContext): ResolvedTarget | null {
  if (intensity.basis === "rpe") return null;
  if ("zone" in intensity) return resolveZone(session, intensity.basis, intensity.zone, "session", ctx);
  return {
    status: "ok", basis: intensity.basis, zone: null, min: intensity.min, max: intensity.max,
    source: "session", method: null, references: [],
  };
}

/** Toutes les cibles à afficher pour une séance : principale, puis secondaire éventuelle. */
export function resolveTargets(session: SessionLike, ctx: TargetContext, parse: (v: unknown) => Intensity | null): ResolvedTarget[] {
  const explicit = parse(session.target_intensity);
  if (explicit) {
    const r = resolveIntensity(session, explicit, ctx);
    return r ? [r] : [];
  }
  const zone = ctx.rules.defaultZoneByType[session.session_type];
  if (zone == null) return [];
  return judgementBases(session, ctx).map((basis) => resolveZone(session, basis, zone, "default", ctx));
}
