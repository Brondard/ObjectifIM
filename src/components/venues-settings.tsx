"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { inputClass } from "@/components/session-form";
import { useSync } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";

const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const KINDS = { pool: "Piscine", club: "Club", track: "Piste", gym: "Salle", other: "Autre" } as const;

/** Piscine, club : leurs créneaux, pour que la replanification ne propose jamais un horaire impossible. */
export function VenuesSettings() {
  const engine = useSync();
  const data = useLiveQuery(async () => {
    const [venues, slots] = await Promise.all([engine.db.venues.toArray(), engine.db.venue_slots.toArray()]);
    return { venues: venues.filter((v) => !v.deleted_at), slots: slots.filter((s) => !s.deleted_at) };
  }, [engine.db]);
  const [name, setName] = useState("");
  if (!data) return null;
  return (
    <section className="flex flex-col gap-3 text-sm">
      <h2 className="text-lg font-medium">Lieux et créneaux</h2>
      <p className="text-neutral-500">Une séance rattachée à un lieu (champ « Lieu » de la séance) n&apos;est déplacée que sur un de ses créneaux ouverts.</p>
      {data.venues.map((v) => {
        const slots = data.slots.filter((s) => s.venue_id === v.id).sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
        return (
          <div key={v.id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <input defaultValue={v.name} onBlur={(e) => e.target.value !== v.name && void engine.mutate("venues", v.id, { name: e.target.value })} className={`${inputClass} h-9`} aria-label="Nom du lieu" />
              <select value={v.kind} onChange={(e) => void engine.mutate("venues", v.id, { kind: e.target.value })} className={`${inputClass} h-9 w-32`} aria-label="Type de lieu">
                {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label className="flex shrink-0 items-center gap-1 text-xs">trajet
                <input inputMode="numeric" defaultValue={v.travel_min ?? ""} onBlur={(e) => void engine.mutate("venues", v.id, { travel_min: Number(e.target.value) || null })} className="h-9 w-14 rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-700" aria-label="Trajet en minutes" /> min
              </label>
              <button onClick={() => window.confirm("Supprimer ce lieu ?") && void engine.mutate("venues", v.id, { deleted_at: nowIso() })} className="text-xs text-neutral-500 underline">Supprimer</button>
            </div>
            <ul className="tabular-nums">
              {slots.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{DAYS[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{s.label ? ` · ${s.label}` : ""}</span>
                  <button onClick={() => void engine.mutate("venue_slots", s.id, { deleted_at: nowIso() })} className="text-neutral-500" aria-label="Retirer le créneau">×</button>
                </li>
              ))}
            </ul>
            <SlotForm venueId={v.id} />
          </div>
        );
      })}
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void engine.mutate("venues", uuidv7(), { name: name.trim(), kind: "pool" });
        setName("");
      }}>
        <input placeholder="Nouveau lieu (ex. piscine de Valbonne)" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <button className="rounded-md border border-neutral-300 px-3 dark:border-neutral-700">+</button>
      </form>
    </section>
  );
}

function SlotForm({ venueId }: { venueId: string }) {
  const engine = useSync();
  const [f, setF] = useState({ weekday: 1, start: "07:00", end: "09:00" });
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
      e.preventDefault();
      if (f.end <= f.start) return;
      void engine.mutate("venue_slots", uuidv7(), { venue_id: venueId, weekday: f.weekday, start_time: f.start, end_time: f.end });
    }}>
      <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })} className={`${inputClass} h-9 w-20`} aria-label="Jour">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
      </select>
      <input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={`${inputClass} h-9 w-28`} aria-label="Ouverture" />
      <input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={`${inputClass} h-9 w-28`} aria-label="Fermeture" />
      <button className="rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700">+ Créneau</button>
    </form>
  );
}
