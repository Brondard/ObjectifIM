/** Matériel : kilométrage cumulé, alertes d'usure et d'entretien. Fonctions pures. */

export type EquipmentLike = {
  id: string;
  kind: string;
  name: string;
  initial_km: number;
  alert_km: number | null;
  retired_on: string | null;
  strava_gear_id: string | null;
  deleted_at?: string | null;
};
export type UsageLike = { equipment_id: string | null; distance_m: number | null; deleted_at?: string | null };
export type MaintenanceLike = { equipment_id: string; component: string; done_on: string; at_km: number | null; interval_km: number | null; deleted_at?: string | null };

/** Kilométrage : départ saisi + somme des séances rattachées. */
export function equipmentKm(e: EquipmentLike, usage: UsageLike[]): number {
  const km = usage.filter((u) => !u.deleted_at && u.equipment_id === e.id).reduce((a, u) => a + (u.distance_m ?? 0) / 1000, 0);
  return Math.round((Number(e.initial_km) + km) * 10) / 10;
}

export type EquipmentAlert = { key: string; equipment_id: string; message: string };

/**
 * Chaussures au-delà du seuil (700 à 800 km), entretien dû : pour chaque composant, le dernier entretien
 * plus son intervalle comparé au kilométrage actuel.
 */
export function equipmentAlerts(items: EquipmentLike[], usage: UsageLike[], maintenance: MaintenanceLike[], shoesDefaultKm = 750): EquipmentAlert[] {
  const out: EquipmentAlert[] = [];
  for (const e of items.filter((x) => !x.deleted_at && !x.retired_on)) {
    const km = equipmentKm(e, usage);
    const limit = e.alert_km ?? (e.kind === "shoes" ? shoesDefaultKm : null);
    if (limit && km >= limit) out.push({ key: `wear:${e.id}`, equipment_id: e.id, message: `${e.name} : ${Math.round(km)} km, seuil de ${limit} km atteint.` });
    const byComponent = new Map<string, MaintenanceLike>();
    for (const m of maintenance.filter((x) => !x.deleted_at && x.equipment_id === e.id)) {
      const prev = byComponent.get(m.component);
      if (!prev || m.done_on > prev.done_on) byComponent.set(m.component, m);
    }
    for (const m of byComponent.values()) {
      if (m.interval_km && m.at_km != null && km >= Number(m.at_km) + Number(m.interval_km)) {
        out.push({ key: `maint:${e.id}:${m.component}`, equipment_id: e.id, message: `${e.name} : ${m.component} à revoir (${Math.round(km - Number(m.at_km))} km depuis le ${m.done_on}, intervalle ${m.interval_km} km).` });
      }
    }
  }
  return out;
}

/** Matériel correspondant à l'équipement Strava d'une activité. */
export function matchGear(items: EquipmentLike[], stravaGearId: string | null | undefined): string | null {
  if (!stravaGearId) return null;
  return items.find((e) => !e.deleted_at && e.strava_gear_id === stravaGearId)?.id ?? null;
}
