/**
 * Autour d'une course : plan de ravitaillement, charge glucidique, déroulé du matin, rappels.
 * Fonctions pures.
 */
import { diffDays, type LocalDate } from "@/lib/time";

export type Product = { id: string; name: string; carbs_g: number | null; caffeine_mg?: number | null; sodium_mg?: number | null };
export type ProtocolItem = { product_id: string; every_min: number; start_min?: number };
export type Protocol = { carbs_per_h: number; items: ProtocolItem[] };

export type FuelEvent = { t_s: number; product: string; carbs_g: number; at_m: number | null };

/**
 * Prises prévues sur une durée : chaque produit du protocole à sa cadence. Sans produit, une prise de
 * 25 g toutes les 20 min environ, calée sur l'objectif horaire.
 */
export function fuelPlan(
  duration_s: number,
  protocol: Protocol,
  products: Product[],
  distanceAt?: (t_s: number) => number | null,
): { events: FuelEvent[]; total_g: number; target_g: number } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const events: FuelEvent[] = [];
  const items = protocol.items.length
    ? protocol.items
    : [{ product_id: "", every_min: Math.max(10, Math.round((25 / Math.max(1, protocol.carbs_per_h)) * 60)), start_min: 20 }];
  for (const it of items) {
    const p = byId.get(it.product_id);
    const carbs = p?.carbs_g ?? 25;
    for (let t = (it.start_min ?? it.every_min) * 60; t < duration_s - 10 * 60; t += it.every_min * 60) {
      events.push({ t_s: t, product: p?.name ?? "Gel (25 g)", carbs_g: carbs, at_m: distanceAt ? distanceAt(t) : null });
    }
  }
  events.sort((a, b) => a.t_s - b.t_s || a.product.localeCompare(b.product));
  return {
    events,
    total_g: Math.round(events.reduce((a, e) => a + e.carbs_g, 0)),
    target_g: Math.round((protocol.carbs_per_h * duration_s) / 3600),
  };
}

/** Distance au temps t, par interpolation sur des passages cumulés. */
export function distanceAtTime(splits: { at_m: number; cumulative_s: number }[]) {
  return (t: number) => {
    let prev = { at_m: 0, cumulative_s: 0 };
    for (const s of splits) {
      if (t <= s.cumulative_s) return Math.round(prev.at_m + ((t - prev.cumulative_s) / (s.cumulative_s - prev.cumulative_s)) * (s.at_m - prev.at_m));
      prev = s;
    }
    return null;
  };
}

/** Charge glucidique des 3 jours avant la course (en g/jour), selon le poids. */
export function carbLoading(weight_kg: number, g_per_kg = 9) {
  return Math.round(weight_kg * g_per_kg);
}

export type TimelineItem = { offset_min: number; label: string };

/** Déroulé du matin : heures absolues depuis l'heure de départ (« HH:MM »), dans l'ordre. */
export function morningTimeline(start: string, items: TimelineItem[]) {
  const [h, m] = start.split(":").map(Number);
  const base = h * 60 + m;
  return [...items]
    .sort((a, b) => a.offset_min - b.offset_min)
    .map((it) => {
      const total = (((base + it.offset_min) % 1440) + 1440) % 1440;
      return { ...it, time: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}` };
    });
}

export const DEFAULT_TIMELINE: TimelineItem[] = [
  { offset_min: -210, label: "Réveil" },
  { offset_min: -180, label: "Petit-déjeuner" },
  { offset_min: -100, label: "Départ vers le site" },
  { offset_min: -75, label: "Parc à vélo : dépôt, gonflage, ravitaillement sur le vélo" },
  { offset_min: -45, label: "Combinaison, dernier passage aux toilettes" },
  { offset_min: -25, label: "Échauffement" },
  { offset_min: -10, label: "Sas de départ" },
];

export type RaceLike = { id: string; name: string; date: string; priority: string; result?: unknown; debrief?: unknown; deleted_at?: string | null };
export type Reminder = { key: string; race_id: string; message: string; kind: "countdown" | "carbs" | "checklist" | "debrief" };

/**
 * Rappels factuels autour des courses : compte à rebours (14 jours), charge glucidique de J−3 à J−1,
 * checklist la veille, débrief à partir de J+2 tant qu'il n'est pas rempli.
 */
export function raceReminders(races: RaceLike[], today: string, weight_kg: number | null): Reminder[] {
  const out: Reminder[] = [];
  for (const r of races.filter((x) => !x.deleted_at)) {
    const days = diffDays(r.date as LocalDate, today as LocalDate);
    if (days > 0 && days <= 14) out.push({ key: `cd:${r.id}`, race_id: r.id, kind: "countdown", message: `${r.name} dans ${days} jour${days > 1 ? "s" : ""}.` });
    if (days >= 1 && days <= 3 && (r.priority === "A" || r.priority === "B")) {
      out.push({
        key: `carbs:${r.id}`, race_id: r.id, kind: "carbs",
        message: weight_kg ? `Charge glucidique J−${days} : environ ${carbLoading(weight_kg)} g de glucides aujourd'hui (9 g/kg).` : `Charge glucidique J−${days} : 8 à 10 g de glucides par kg aujourd'hui.`,
      });
    }
    if (days === 1) out.push({ key: `check:${r.id}`, race_id: r.id, kind: "checklist", message: `Checklist de ${r.name} à préparer ce soir.` });
    const d = r.debrief as Record<string, unknown> | null | undefined;
    if (days <= -2 && days >= -30 && !(d && Object.values(d).some((v) => typeof v === "string" && v.trim()))) {
      out.push({ key: `debrief:${r.id}`, race_id: r.id, kind: "debrief", message: `Débrief de ${r.name} : ce qui a marché, ce qui a lâché, à corriger.` });
    }
  }
  return out;
}
