"use client";

import { useState } from "react";
import { v5 as uuidv5 } from "uuid";
import type { DailyLog } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useDailyLog } from "@/lib/sync/queries";
import type { LocalDate } from "@/lib/time";

/** Une ligne par jour et par compte : même identifiant sur tous les appareils, donc fusion champ par champ. */
function useDailyWriter(date: LocalDate) {
  const engine = useSync();
  const id = uuidv5(`daily:${date}`, engine.db.userId);
  return (fields: Partial<DailyLog>) => engine.mutate("daily_logs", id, { date, ...fields });
}

const SCALES: { field: "sleep_quality" | "freshness" | "soreness" | "motivation" | "mood"; label: string; low: string; high: string }[] = [
  { field: "sleep_quality", label: "Sommeil", low: "mauvais", high: "excellent" },
  { field: "freshness", label: "Fraîcheur", low: "épuisé", high: "frais" },
  { field: "soreness", label: "Courbatures", low: "aucune", high: "fortes" },
  { field: "motivation", label: "Motivation", low: "nulle", high: "forte" },
  { field: "mood", label: "Humeur", low: "basse", high: "haute" },
];

/** Check-in matinal : un tap par ligne, chaque tap est enregistré tout de suite. */
export function CheckIn({ date }: { date: LocalDate }) {
  const log = useDailyLog(date);
  const write = useDailyWriter(date);
  if (log === undefined) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">Check-in</h2>
      {SCALES.map((s) => (
        <div key={s.field} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-sm">{s.label}</span>
          <div className="grid flex-1 grid-cols-5 gap-1" role="radiogroup" aria-label={`${s.label} (1 ${s.low}, 5 ${s.high})`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={log?.[s.field] === n}
                onClick={() => void write({ [s.field]: log?.[s.field] === n ? null : n })}
                className={`h-10 rounded text-sm ${log?.[s.field] === n ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="-mt-1 text-xs text-neutral-500">1 = mauvais · 5 = bon ; courbatures : 1 = aucune · 5 = fortes</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          key={`sleep-${log?.sleep_h}`}
          label="Sommeil (h)"
          value={log?.sleep_h ?? null}
          step={0.5}
          onCommit={(v) => void write({ sleep_h: v })}
        />
        <NumberField
          key={`hr-${log?.hr_rest}`}
          label="FC repos (bpm)"
          value={log?.hr_rest ?? null}
          step={1}
          onCommit={(v) => void write({ hr_rest: v })}
        />
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number | null;
  step: number;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text === "" ? null : Number(text.replace(",", "."));
          if (v !== value && (v === null || Number.isFinite(v))) onCommit(v);
        }}
        className="h-11 rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700"
      />
    </label>
  );
}

/** Note du jour : libre, attachée à la date, pas à une séance. */
export function DayNote({ date }: { date: LocalDate }) {
  const log = useDailyLog(date);
  const write = useDailyWriter(date);
  if (log === undefined) return null;
  return <DayNoteField key={log?.id ?? "new"} initial={log?.note ?? ""} onCommit={(note) => void write({ note: note || null })} />;
}

function DayNoteField({ initial, onCommit }: { initial: string; onCommit: (note: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">Note du jour</span>
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== initial && onCommit(text.trim())}
        placeholder="Travail, sommeil, contexte… ce qui expliquera cette journée dans six mois."
        className="rounded-md border border-neutral-300 bg-transparent p-3 text-sm dark:border-neutral-700"
      />
    </label>
  );
}
