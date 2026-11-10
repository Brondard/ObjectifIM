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
import { parseIntensity, type Intensity } from "@/domain/session-structure";
import { formatClock, parseClock } from "@/lib/format";
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
  target_intensity: Intensity | null;
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
        if (v.target_intensity && !parseIntensity(v.target_intensity)) {
          window.alert("Cible incomplète : renseigne les deux bornes, la plus basse en premier.");
          return;
        }
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
          <IntensityEditor
            discipline={v.discipline}
            value={v.target_intensity}
            onChange={(t) => set("target_intensity", t)}
          />
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
    target_intensity: parseIntensity(s.target_intensity),
  };
}

const BASES_BY_DISCIPLINE: Record<string, { value: "hr" | "pace" | "power" | "swim_pace" | "rpe"; label: string }[]> = {
  run: [{ value: "hr", label: "FC" }, { value: "pace", label: "Allure" }],
  bike: [{ value: "power", label: "Puissance" }, { value: "hr", label: "FC" }],
  swim: [{ value: "swim_pace", label: "Allure /100 m" }],
  strength: [],
  other: [{ value: "hr", label: "FC" }],
};
const RANGE_UNIT: Record<string, string> = { hr: "bpm", pace: "min/km", power: "W", swim_pace: "min/100 m", rpe: "/10" };
const isPace = (b: string) => b === "pace" || b === "swim_pace";

/**
 * Cible d’intensité : par défaut (selon le type, résolue avec les zones), une zone, ou une plage absolue.
 * Les allures se saisissent en min:s.
 */
function IntensityEditor({
  discipline,
  value,
  onChange,
}: {
  discipline: string;
  value: Intensity | null;
  onChange: (t: Intensity | null) => void;
}) {
  const bases = [...(BASES_BY_DISCIPLINE[discipline] ?? []), { value: "rpe" as const, label: "RPE" }];
  const mode = !value ? "default" : "zone" in value ? "zone" : "range";
  const basis = value?.basis ?? bases[0].value;
  const fmt = (n: number | undefined) => (n == null ? "" : isPace(basis) ? formatClock(n) : String(n));
  const read = (t: string) => (isPace(basis) ? parseClock(t) : t === "" ? null : Number(t.replace(",", ".")));

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <legend className="px-1 text-sm">Cible d’intensité</legend>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Type de cible"
          value={mode}
          onChange={(e) => {
            const m = e.target.value;
            const b = bases[0].value === "rpe" ? "hr" : bases[0].value;
            onChange(m === "default" ? null : m === "zone" ? { basis: b as "hr", zone: 2 } : { basis: b, min: 0, max: 0 } as Intensity);
          }}
          className={inputClass}
        >
          <option value="default">Selon le type de séance</option>
          <option value="zone">Zone</option>
          <option value="range">Plage en valeurs</option>
        </select>
        {mode !== "default" && (
          <select
            aria-label="Grandeur"
            value={basis}
            onChange={(e) => {
              const b = e.target.value as Intensity["basis"];
              onChange(mode === "zone" ? ({ basis: b, zone: (value as { zone: number }).zone } as Intensity) : ({ basis: b, min: 0, max: 0 } as Intensity));
            }}
            className={inputClass}
          >
            {bases.filter((b) => mode === "range" || b.value !== "rpe").map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        )}
      </div>
      {mode === "zone" && value && "zone" in value && (
        <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Zone">
          {[1, 2, 3, 4, 5, 6, 7].map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={value.zone === z}
              onClick={() => onChange({ ...value, zone: z })}
              className={`h-10 rounded text-sm ${value.zone === z ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}
            >
              Z{z}
            </button>
          ))}
        </div>
      )}
      {mode === "range" && value && "min" in value && (
        <div key={basis} className="grid grid-cols-2 gap-2">
          <Field label={`${isPace(basis) ? "Plus rapide" : "Min"} (${RANGE_UNIT[basis]})`}>
            <input
              defaultValue={fmt(value.min || undefined)}
              inputMode={isPace(basis) ? "text" : "decimal"}
              placeholder={isPace(basis) ? "5:30" : ""}
              onBlur={(e) => onChange({ ...value, min: read(e.target.value) ?? 0 })}
              className={inputClass}
            />
          </Field>
          <Field label={`${isPace(basis) ? "Plus lent" : "Max"} (${RANGE_UNIT[basis]})`}>
            <input
              defaultValue={fmt(value.max || undefined)}
              inputMode={isPace(basis) ? "text" : "decimal"}
              placeholder={isPace(basis) ? "5:45" : ""}
              onBlur={(e) => onChange({ ...value, max: read(e.target.value) ?? 0 })}
              className={inputClass}
            />
          </Field>
        </div>
      )}
      {mode === "default" && (
        <p className="text-xs text-neutral-500">Zone par défaut du type de séance, calculée avec tes repères à la date de la séance.</p>
      )}
    </fieldset>
  );
}
