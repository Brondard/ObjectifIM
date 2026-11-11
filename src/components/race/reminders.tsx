"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { fuelPlan, raceReminders } from "@/domain/race/plan";
import { formatDuration } from "@/lib/format";
import type { PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useRaceList } from "@/lib/sync/race-queries";
import { today } from "@/lib/time";

/** Rappels autour des courses sur l'écran Aujourd'hui : compte à rebours, glucides, checklist, débrief. */
export function RaceReminders() {
  const { db } = useSync();
  const races = useRaceList();
  const weight = useLiveQuery(async () => {
    const w = (await db.metrics.where("kind").equals("weight").toArray()).filter((m) => !m.deleted_at).sort((a, b) => b.measured_on.localeCompare(a.measured_on))[0];
    return w ? Number(w.value) : null;
  }, [db]);
  if (!races || weight === undefined) return null;
  const list = raceReminders(races, today(), weight);
  if (!list.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {list.map((r) => (
        <li key={r.key}>
          <Link href={`/courses/${r.race_id}`} className="block rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
            {r.message}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Plan de ravitaillement d'une séance de plus de 90 min, d'après le premier protocole enregistré. */
export function SessionFuel({ session }: { session: PlannedSession }) {
  const { db } = useSync();
  const data = useLiveQuery(async () => {
    const [protocols, products] = await Promise.all([db.nutrition_protocols.toArray(), db.nutrition_products.toArray()]);
    return { protocol: protocols.find((p) => !p.deleted_at) ?? null, products: products.filter((p) => !p.deleted_at) };
  }, [db]);
  const duration = session.target_duration_s ?? 0;
  if (!data || duration < 90 * 60 || !["run", "bike"].includes(session.discipline)) return null;
  const protocol = data.protocol
    ? { carbs_per_h: Number(data.protocol.carbs_per_h), items: (data.protocol.items ?? []) as { product_id: string; every_min: number }[] }
    : { carbs_per_h: 60, items: [] };
  const plan = fuelPlan(duration, protocol, data.products.map((p) => ({ ...p, carbs_g: p.carbs_g == null ? null : Number(p.carbs_g) })));
  return (
    <section className="flex flex-col gap-1 text-sm">
      <h2 className="font-medium">Ravitaillement ({formatDuration(duration)})</h2>
      <p>
        {plan.total_g} g de glucides prévus pour {plan.target_g} g visés ({protocol.carbs_per_h} g/h
        {data.protocol ? `, protocole « ${data.protocol.name} »` : ", valeur par défaut"}) :{" "}
        {plan.events.map((e) => `${Math.round(e.t_s / 60)}′ ${e.product}`).join(" · ")}
      </p>
      {!data.protocol && <Link href="/nutrition" className="text-xs underline">Définir un protocole</Link>}
    </section>
  );
}
