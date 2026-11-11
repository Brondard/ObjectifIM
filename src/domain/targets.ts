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

/** Séance antérieure aux premiers repères : on prend les plus anciens, et leur date le montre. */
const EARLIEST = { earliest: true };

export type TargetRules = {
  /** Type de séance → numéro de zone (null : pas de cible par défaut). */
  defaultZoneByType: Record<string, number | null>;
  /** Type de séance (course à pied) → critère : hr, pace, pace_then_hr, both. */
  judgementByType: Record<string, string>;
  /** Paramètres du jugement sur les flux (règle intensity_judgement). */
  intensity?: { skipFirstS: number; alertPct: number };
  /**
   * Plafonds de FC absolus des séances faciles de course (règle easy_hr_ceilings) : ils remplacent la borne
   * de zone, trop basse quand les zones suivent la méthode de la montre.
   */
  easyCeilings?: EasyCeilings;
};

export type EasyCeilings = { byType: Record<string, number>; longEnd?: number | null; longEndFromPct?: number | null };

export type TargetContext = { models: ZoneModel[]; metrics: Metric[]; rules: TargetRules };

export type ResolvedTarget =
  | {
      status: "ok";
      basis: Basis;
      zone: number | null;
      min: number | null;
      max: number | null;
      source: "session" | "default" | "ceiling";
      method: Method | null;
      references: Reference[];
      /** Plafond relevé en fin de séance (sortie longue) et à partir de quel % du temps. */
      max_end?: number | null;
      end_from_pct?: number | null;
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
      // Choix de la grandeur selon ce qui existait à la date (pas de repli) : une FTP mesurée plus tard
      // ne fait pas juger à la puissance une sortie d'avant.
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
  const model = zoneModelAt(ctx.models, session.discipline, basis, session.date, EARLIEST);
  if (!model) return { status: "no_model", basis, zone, source };
  const computed = computeZones(model, ctx.metrics, session.date, EARLIEST);
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
  const ceiling = session.discipline === "run" ? easyCeiling(session.session_type, ctx.rules.easyCeilings) : null;
  if (ceiling) return [ceiling];
  const zone = ctx.rules.defaultZoneByType[session.session_type];
  if (zone == null) return [];
  return judgementBases(session, ctx).map((basis) => resolveZone(session, basis, zone, "default", ctx));
}

/** Plafond absolu d'une séance facile de course, s'il est défini pour son type. */
export function easyCeiling(sessionType: string, c: EasyCeilings | undefined): ResolvedTarget | null {
  const max = c?.byType[sessionType];
  if (!max) return null;
  const long = sessionType === "long" && c?.longEnd;
  return {
    status: "ok", basis: "hr", zone: null, min: null, max, source: "ceiling", method: null, references: [],
    ...(long ? { max_end: c!.longEnd, end_from_pct: c!.longEndFromPct ?? 67 } : {}),
  };
}

/** Paramètres de la règle easy_hr_ceilings → plafonds ; undefined si la règle est vide. */
export function ceilingsFrom(p: Record<string, unknown>): EasyCeilings | undefined {
  const byType = (p.by_type ?? {}) as Record<string, number>;
  if (!Object.keys(byType).length) return undefined;
  return { byType, longEnd: (p.long_end as number | undefined) ?? null, longEndFromPct: (p.long_end_from_pct as number | undefined) ?? null };
}
