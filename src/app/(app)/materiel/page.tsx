"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { equipmentAlerts, equipmentKm } from "@/domain/life/equipment";
import type { Equipment } from "@/lib/sync/db";
import { useSync, useSyncStatus } from "@/lib/sync/provider";
import { nowIso, today } from "@/lib/time";

const KINDS = { shoes: "Chaussures", bike: "Vélo", wetsuit: "Combinaison", other: "Autre" } as const;

/** Matériel : kilométrage, alertes d'usure, entretien, import depuis Strava. */
export default function EquipmentPage() {
  const engine = useSync();
  const { db } = engine;
  const { online } = useSyncStatus();
  const [message, setMessage] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const [items, maintenance, usage, rules] = await Promise.all([
      db.equipment.toArray(), db.equipment_maintenance.toArray(), db.completed_sessions.toArray(),
      db.engine_rules.where("rule_key").equals("equipment").toArray(),
    ]);
    const live = <T extends { deleted_at: string | null }>(r: T[]) => r.filter((x) => !x.deleted_at);
    return {
      items: live(items).map((e) => ({ ...e, initial_km: Number(e.initial_km), alert_km: e.alert_km == null ? null : Number(e.alert_km) })),
      maintenance: live(maintenance).map((m) => ({ ...m, at_km: m.at_km == null ? null : Number(m.at_km), interval_km: m.interval_km == null ? null : Number(m.interval_km) })),
      usage: live(usage).map((u) => ({ equipment_id: u.equipment_id, distance_m: u.distance_m == null ? null : Number(u.distance_m) })),
      shoesKm: Number((rules.find((r) => !r.deleted_at)?.params as { shoes_alert_km?: number } | undefined)?.shoes_alert_km ?? 750),
    };
  }, [db]);
  if (!data) return null;
  const alerts = equipmentAlerts(data.items, data.usage, data.maintenance, data.shoesKm);

  async function importStrava() {
    setMessage("Import…");
    const res = await fetch("/api/strava/gear", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? `${json.imported} équipement(s) importé(s) depuis Strava. Les prochaines activités s'y rattacheront seules.` : `Échec : ${json.error ?? res.status}`);
    await engine.sync();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Matériel</h1>
        <button onClick={() => void importStrava()} disabled={!online} className="text-sm underline disabled:opacity-50">Importer depuis Strava</button>
      </header>
      {message && <p className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{message}</p>}
      {alerts.map((a) => <p key={a.key} className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{a.message}</p>)}
      {data.items.filter((e) => !e.retired_on).map((e) => (
        <EquipmentCard key={e.id} item={e} km={equipmentKm(e, data.usage)} maintenance={data.maintenance.filter((m) => m.equipment_id === e.id)} shoesKm={data.shoesKm} />
      ))}
      {data.items.some((e) => e.retired_on) && (
        <details className="text-sm"><summary className="cursor-pointer">Retiré</summary>
          <ul>{data.items.filter((e) => e.retired_on).map((e) => <li key={e.id}>{e.name} · {Math.round(equipmentKm(e, data.usage))} km · retiré le {e.retired_on}</li>)}</ul>
        </details>
      )}
      <NewEquipment />
    </div>
  );
}

function EquipmentCard({ item, km, maintenance, shoesKm }: {
  item: Equipment & { initial_km: number; alert_km: number | null }; km: number;
  maintenance: { id: string; component: string; done_on: string; at_km: number | null; interval_km: number | null; note: string | null }[];
  shoesKm: number;
}) {
  const engine = useSync();
  const [m, setM] = useState({ component: "", interval: "" });
  const limit = item.alert_km ?? (item.kind === "shoes" ? shoesKm : null);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{item.name} <span className="text-xs text-neutral-500">{KINDS[item.kind as keyof typeof KINDS]}{item.strava_gear_id ? " · Strava" : ""}</span></h2>
        <span className="tabular-nums">{Math.round(km)} km{limit ? ` / ${limit}` : ""}</span>
      </div>
      {limit && (
        <div className="h-2 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="img" aria-label={`${Math.round((km / limit) * 100)} % du seuil`}>
          <div className={`h-full ${km >= limit ? "bg-red-500" : "bg-[var(--viz-done)]"}`} style={{ width: `${Math.min(100, (km / limit) * 100)}%` }} />
        </div>
      )}
      {maintenance.length > 0 && (
        <ul className="text-neutral-600 dark:text-neutral-400">
          {[...maintenance].sort((a, b) => b.done_on.localeCompare(a.done_on)).map((x) => (
            <li key={x.id}>{x.component} : le {x.done_on}{x.at_km != null ? ` à ${Math.round(x.at_km)} km` : ""}{x.interval_km ? `, tous les ${x.interval_km} km` : ""}</li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!m.component.trim()) return;
        void engine.mutate("equipment_maintenance", uuidv7(), { equipment_id: item.id, component: m.component.trim(), done_on: today(), at_km: Math.round(km), interval_km: Number(m.interval) || null });
        setM({ component: "", interval: "" });
      }}>
        <input placeholder={item.kind === "bike" ? "Entretien (chaîne, pneus, plaquettes, bike fitting…)" : "Entretien"} value={m.component} onChange={(e) => setM({ ...m, component: e.target.value })} className={`${inputClass} flex-1`} />
        <input placeholder="tous les … km" inputMode="numeric" value={m.interval} onChange={(e) => setM({ ...m, interval: e.target.value })} className={`${inputClass} w-32`} />
        <button className="rounded-md border border-neutral-300 px-3 dark:border-neutral-700">Noter aujourd&apos;hui</button>
      </form>
      <div className="flex gap-3 text-xs">
        <label className="flex items-center gap-1">Seuil d&apos;alerte
          <input inputMode="numeric" defaultValue={item.alert_km ?? ""} onBlur={(e) => void engine.mutate("equipment", item.id, { alert_km: Number(e.target.value) || null })} className="h-8 w-20 rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-700" /> km
        </label>
        <button onClick={() => window.confirm(`Retirer « ${item.name} » ?`) && void engine.mutate("equipment", item.id, { retired_on: today() })} className="text-neutral-500 underline">Retirer</button>
        <button onClick={() => window.confirm("Supprimer définitivement de la liste ?") && void engine.mutate("equipment", item.id, { deleted_at: nowIso() })} className="text-neutral-500 underline">Supprimer</button>
      </div>
    </section>
  );
}

function NewEquipment() {
  const engine = useSync();
  const [f, setF] = useState({ kind: "shoes", name: "", initial: "0" });
  return (
    <form className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 p-3 text-sm sm:grid-cols-4 dark:border-neutral-800" onSubmit={(e) => {
      e.preventDefault();
      if (!f.name.trim()) return;
      void engine.mutate("equipment", uuidv7(), {
        kind: f.kind, name: f.name.trim(), initial_km: Number(f.initial) || 0, purchased_on: today(),
        default_for_discipline: f.kind === "shoes" ? "run" : f.kind === "bike" ? "bike" : null,
      });
      setF({ ...f, name: "", initial: "0" });
    }}>
      <Field label="Type">
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={inputClass}>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputClass} required /></Field>
      <Field label="Km de départ"><input inputMode="numeric" value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value })} className={inputClass} /></Field>
      <button className="h-11 self-end rounded-md bg-foreground font-medium text-background">Ajouter</button>
    </form>
  );
}
