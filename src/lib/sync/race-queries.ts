"use client";

import { useLiveQuery } from "dexie-react-hooks";
import type { CourseProfile } from "@/domain/race/gpx";
import type { Race } from "./db";
import { useSync } from "./provider";

export type LegCourse = CourseProfile & { gpx_path?: string | null; file_name?: string | null };
/** Profils de parcours d'une course, par portion (un triathlon a un parcours vélo et un parcours course). */
export type RaceCourses = Partial<Record<"run" | "bike" | "swim", LegCourse>>;

export const coursesOf = (r: Race | null | undefined): RaceCourses => (r?.course ?? {}) as RaceCourses;

export function useRaceList() {
  const { db } = useSync();
  return useLiveQuery(async () => (await db.races.toArray()).filter((r) => !r.deleted_at).sort((a, b) => a.date.localeCompare(b.date)), [db]);
}

/** Tout ce qu'il faut pour préparer une course et la courir, hors ligne compris. */
export function useRaceBundle(id: string) {
  const { db } = useSync();
  return useLiveQuery(async () => {
    const race = await db.races.get(id);
    if (!race || race.deleted_at) return null;
    const [plans, checklists, products, protocols, metrics] = await Promise.all([
      db.race_plans.where("race_id").equals(id).toArray(),
      db.checklists.toArray(),
      db.nutrition_products.toArray(),
      db.nutrition_protocols.toArray(),
      db.metrics.toArray(),
    ]);
    const own = checklists.find((c) => c.race_id === id && !c.deleted_at) ?? null;
    const items = own ? (await db.checklist_items.where("checklist_id").equals(own.id).toArray()).filter((i) => !i.deleted_at) : [];
    const latest = (kind: string) =>
      metrics.filter((m) => m.kind === kind && !m.deleted_at && m.measured_on <= race.date).sort((a, b) => b.measured_on.localeCompare(a.measured_on))[0]
      ?? metrics.filter((m) => m.kind === kind && !m.deleted_at).sort((a, b) => a.measured_on.localeCompare(b.measured_on))[0];
    return {
      race,
      plans: plans.filter((p) => !p.deleted_at),
      checklist: own,
      items: items.sort((a, b) => a.position - b.position),
      templates: checklists.filter((c) => c.is_template && !c.deleted_at),
      products: products.filter((p) => !p.deleted_at),
      protocols: protocols.filter((p) => !p.deleted_at),
      weight: latest("weight") ? Number(latest("weight")!.value) : null,
      lthr: latest("lthr") ? Number(latest("lthr")!.value) : null,
    };
  }, [db, id]);
}
