/**
 * Zones d'entraînement : calcul des bornes absolues à une date donnée, à partir des repères
 * physiologiques valides à cette date (une séance passée garde les zones de l'époque).
 *
 * Unités des bornes absolues : bpm (hr), W (power), s/km (pace), s/100 m (swim_pace).
 * Pour une allure, `min` est la borne la plus rapide (le plus petit nombre de secondes).
 */

export type Basis = "hr" | "pace" | "power" | "swim_pace";
export type Method = "pct_hrmax" | "karvonen" | "pct_lthr" | "pct_ftp" | "pct_vma" | "pct_threshold_pace" | "pct_css";
export type MetricKind = "hr_max" | "hr_rest" | "lthr" | "vma" | "ftp" | "css" | "threshold_pace" | "vo2max" | "weight";

/** Bornes relatives d'une zone, en fraction de la référence (null : zone ouverte). */
export type Bound = { zone: number; lo: number | null; hi: number | null };
export type ZoneRange = { zone: number; min: number | null; max: number | null };

export type ZoneModel = {
  discipline: string;
  basis: Basis;
  method: Method;
  bounds: Bound[];
  overrides?: ZoneRange[] | null;
  valid_from: string;
  deleted_at?: string | null;
};

export type Metric = { kind: string; value: number; measured_on: string; deleted_at?: string | null };
export type Reference = { kind: MetricKind; value: number; measured_on: string };

export const METHOD_BASIS: Record<Method, Basis> = {
  pct_hrmax: "hr",
  karvonen: "hr",
  pct_lthr: "hr",
  pct_ftp: "power",
  pct_vma: "pace",
  pct_threshold_pace: "pace",
  pct_css: "swim_pace",
};

export const METHOD_REFERENCES: Record<Method, MetricKind[]> = {
  pct_hrmax: ["hr_max"],
  karvonen: ["hr_max", "hr_rest"],
  pct_lthr: ["lthr"],
  pct_ftp: ["ftp"],
  pct_vma: ["vma"],
  pct_threshold_pace: ["threshold_pace"],
  pct_css: ["css"],
};

/** Préréglages de bornes, modifiables ensuite dans les réglages. */
export const PRESETS: Record<Method, Bound[]> = {
  // Identique à Samsung Health (pourcentage simple de la FC max).
  pct_hrmax: [
    { zone: 1, lo: 0.5, hi: 0.6 }, { zone: 2, lo: 0.6, hi: 0.7 }, { zone: 3, lo: 0.7, hi: 0.8 },
    { zone: 4, lo: 0.8, hi: 0.9 }, { zone: 5, lo: 0.9, hi: 1.0 },
  ],
  karvonen: [
    { zone: 1, lo: 0.5, hi: 0.6 }, { zone: 2, lo: 0.6, hi: 0.7 }, { zone: 3, lo: 0.7, hi: 0.8 },
    { zone: 4, lo: 0.8, hi: 0.9 }, { zone: 5, lo: 0.9, hi: 1.0 },
  ],
  // Friel, course à pied.
  pct_lthr: [
    { zone: 1, lo: null, hi: 0.85 }, { zone: 2, lo: 0.85, hi: 0.9 }, { zone: 3, lo: 0.9, hi: 0.95 },
    { zone: 4, lo: 0.95, hi: 1.0 }, { zone: 5, lo: 1.0, hi: 1.06 },
  ],
  // Coggan.
  pct_ftp: [
    { zone: 1, lo: null, hi: 0.55 }, { zone: 2, lo: 0.56, hi: 0.75 }, { zone: 3, lo: 0.76, hi: 0.9 },
    { zone: 4, lo: 0.91, hi: 1.05 }, { zone: 5, lo: 1.06, hi: 1.2 }, { zone: 6, lo: 1.21, hi: 1.5 },
    { zone: 7, lo: 1.51, hi: null },
  ],
  pct_vma: [
    { zone: 1, lo: 0.6, hi: 0.7 }, { zone: 2, lo: 0.7, hi: 0.8 }, { zone: 3, lo: 0.8, hi: 0.88 },
    { zone: 4, lo: 0.88, hi: 0.95 }, { zone: 5, lo: 0.95, hi: 1.05 },
  ],
  pct_threshold_pace: [
    { zone: 1, lo: null, hi: 0.78 }, { zone: 2, lo: 0.78, hi: 0.88 }, { zone: 3, lo: 0.88, hi: 0.95 },
    { zone: 4, lo: 0.95, hi: 1.02 }, { zone: 5, lo: 1.02, hi: null },
  ],
  pct_css: [
    { zone: 1, lo: null, hi: 0.85 }, { zone: 2, lo: 0.85, hi: 0.93 }, { zone: 3, lo: 0.93, hi: 1.0 },
    { zone: 4, lo: 1.0, hi: 1.05 }, { zone: 5, lo: 1.05, hi: null },
  ],
};

const alive = <T extends { deleted_at?: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

/** Dernière mesure d'un repère à la date donnée (incluse). */
export function metricAt(metrics: Metric[], kind: MetricKind, date: string): Reference | null {
  let best: Metric | null = null;
  for (const m of alive(metrics)) {
    if (m.kind !== kind || m.measured_on > date) continue;
    if (!best || m.measured_on > best.measured_on) best = m;
  }
  return best ? { kind, value: Number(best.value), measured_on: best.measured_on } : null;
}

/** Modèle de zones en vigueur à la date donnée pour une discipline et une grandeur. */
export function zoneModelAt(models: ZoneModel[], discipline: string, basis: Basis, date: string): ZoneModel | null {
  let best: ZoneModel | null = null;
  for (const m of alive(models)) {
    if (m.discipline !== discipline || m.basis !== basis || m.valid_from > date) continue;
    if (!best || m.valid_from > best.valid_from) best = m;
  }
  return best;
}

export type ComputedZones =
  | { ok: true; zones: ZoneRange[]; references: Reference[] }
  | { ok: false; missing: MetricKind[] };

/** Bornes absolues d'un modèle, avec les repères qui ont servi au calcul. */
export function computeZones(model: ZoneModel, metrics: Metric[], date: string): ComputedZones {
  if (model.overrides?.length) return { ok: true, zones: model.overrides, references: [] };

  const refs = METHOD_REFERENCES[model.method].map((k) => metricAt(metrics, k, date));
  const missing = METHOD_REFERENCES[model.method].filter((_, i) => !refs[i]);
  if (missing.length) return { ok: false, missing };
  const references = refs as Reference[];
  const [a, b] = references.map((r) => r.value);

  const scale = (pct: number | null): number | null => {
    if (pct === null) return null;
    switch (model.method) {
      case "karvonen":
        return Math.round(b + pct * (a - b)); // FC repos + % de la FC de réserve
      case "pct_hrmax":
      case "pct_lthr":
      case "pct_ftp":
        return Math.round(pct * a);
      case "pct_vma":
        return pct > 0 ? Math.round(3600 / (pct * a)) : null; // VMA en km/h → allure en s/km
      case "pct_threshold_pace":
      case "pct_css":
        return pct > 0 ? Math.round(a / pct) : null; // allure de référence / % de vitesse
    }
  };

  const isPace = model.basis === "pace" || model.basis === "swim_pace";
  const zones = model.bounds.map(({ zone, lo, hi }) =>
    // Une vitesse plus élevée donne une allure plus petite : les bornes s'inversent.
    isPace ? { zone, min: scale(hi), max: scale(lo) } : { zone, min: scale(lo), max: scale(hi) },
  );
  return { ok: true, zones, references };
}
