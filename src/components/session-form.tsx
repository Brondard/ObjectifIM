"use client";

import { useState, type ReactNode } from "react";
import {
  DISCIPLINES,
  PLANNED_STATUSES,
  PRIORITIES,
  SESSION_TYPES,
  TYPES_BY_DISCIPLINE,
  type Discipline,
} from "@/domain/labels";
import type { PlannedSession } from "@/lib/sync/db";

export type SessionFormValues = {
  date: string;
  local_time: string | null;
  discipline: Discipline;
  session_type: string;
  priority: string;
  status: string;
  title: string | null;
  target_duration_s: number | null;
  target_distance_m: number | null;
  instructions: string | null;
  indoor: boolean;
};

export const inputClass =
  "h-11 w-full rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700";

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      {label}
      {children}
    </label>
  );
}

/** Choix de discipline en gros boutons : un tap, utilisable d'une main. */
export function DisciplinePicker({ value, onChange }: { value: Discipline; onChange: (d: Discipline) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Discipline">
      {(Object.keys(DISCIPLINES) as Discipline[]).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          onClick={() => onChange(d)}
          className={`h-12 rounded-md text-xs ${value === d ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          {DISCIPLINES[d]}
        </button>
      ))}
    </div>
  );
}

const toMinutes = (s: number | null) => (s == null ? "" : String(Math.round(s / 60)));
const toDistanceInput = (m: number | null, d: string) => (m == null ? "" : d === "swim" ? String(m) : String(m / 1000));

/**
 * Formulaire d'une séance prévue. En création, seuls date, discipline, type et durée sont visibles ;
 * le reste est replié (saisie unitaire rapide).
 */
export function SessionForm({
  initial,
  submitLabel,
  showStatus = false,
  collapsed = false,
  onSubmit,
}: {
  initial: SessionFormValues;
  submitLabel: string;
  showStatus?: boolean;
  collapsed?: boolean;
  onSubmit: (values: SessionFormValues) => void | Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [minutes, setMinutes] = useState(toMinutes(initial.target_duration_s));
  const [distance, setDistance] = useState(toDistanceInput(initial.target_distance_m, initial.discipline));
  const [more, setMore] = useState(!collapsed);
  const set = <K extends keyof SessionFormValues>(k: K, value: SessionFormValues[K]) => setV((p) => ({ ...p, [k]: value }));

  const types = TYPES_BY_DISCIPLINE[v.discipline];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const dist = distance === "" ? null : Number(distance.replace(",", "."));
        void onSubmit({
          ...v,
          title: v.title?.trim() || null,
          instructions: v.instructions?.trim() || null,
          local_time: v.local_time || null,
          target_duration_s: minutes === "" ? null : Math.round(Number(minutes) * 60),
          target_distance_m: dist == null || !Number.isFinite(dist) ? null : Math.round(v.discipline === "swim" ? dist : dist * 1000),
        });
      }}
    >
      <Field label="Date">
        <input type="date" required value={v.date} onChange={(e) => set("date", e.target.value)} className={inputClass} />
      </Field>

      <DisciplinePicker
        value={v.discipline}
        onChange={(d) => setV((p) => ({ ...p, discipline: d, session_type: TYPES_BY_DISCIPLINE[d].includes(p.session_type as never) ? p.session_type : TYPES_BY_DISCIPLINE[d][0] }))}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select value={v.session_type} onChange={(e) => set("session_type", e.target.value)} className={inputClass}>
            {[...new Set([...types, v.session_type])].map((t) => (
              <option key={t} value={t}>{SESSION_TYPES[t as keyof typeof SESSION_TYPES] ?? t}</option>
            ))}
          </select>
        </Field>
        <Field label="Durée (min)">
          <input type="number" inputMode="numeric" min={1} required value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {showStatus && (
        <Field label="Statut">
          <select value={v.status} onChange={(e) => set("status", e.target.value)} className={inputClass}>
            {Object.entries(PLANNED_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      )}

      {!more ? (
        <button type="button" onClick={() => setMore(true)} className="self-start text-sm text-neutral-500 underline">
          Plus de détails (priorité, distance, heure, consignes)
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priorité">
              <select value={v.priority} onChange={(e) => set("priority", e.target.value)} className={inputClass}>
                {Object.entries(PRIORITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label={v.discipline === "swim" ? "Distance (m)" : "Distance (km)"}>
              <input type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Heure">
              <input type="time" value={v.local_time?.slice(0, 5) ?? ""} onChange={(e) => set("local_time", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Titre">
              <input value={v.title ?? ""} onChange={(e) => set("title", e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="Consignes">
            <textarea rows={4} value={v.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} className="rounded-md border border-neutral-300 bg-transparent p-3 dark:border-neutral-700" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.indoor} onChange={(e) => set("indoor", e.target.checked)} className="h-5 w-5" />
            En intérieur (home trainer, tapis, piscine couverte)
          </label>
        </>
      )}

      <button className="h-12 rounded-md bg-foreground font-medium text-background">{submitLabel}</button>
    </form>
  );
}

export function valuesOf(s: PlannedSession): SessionFormValues {
  return {
    date: s.date,
    local_time: s.local_time,
    discipline: s.discipline as Discipline,
    session_type: s.session_type,
    priority: s.priority,
    status: s.status,
    title: s.title,
    target_duration_s: s.target_duration_s,
    target_distance_m: s.target_distance_m,
    instructions: s.instructions,
    indoor: s.indoor,
  };
}
