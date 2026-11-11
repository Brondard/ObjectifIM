"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { v7 as uuidv7 } from "uuid";
import { exercisesForType, nextSetPrefill, previousSets, type SetLike } from "@/domain/life/strength";
import type { CompletedSession, StrengthSet } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * Séries d'une séance de musculation. « + Série » recopie la série précédente (ou celle de la dernière
 * séance) : il ne reste qu'à ajuster d'un tap la charge ou les répétitions.
 */
export function StrengthLog({ completion, sessionType }: { completion: CompletedSession; sessionType: string }) {
  const engine = useSync();
  const { db } = engine;
  const data = useLiveQuery(async () => {
    const [exercises, sets, sessions] = await Promise.all([
      db.strength_exercises.toArray(),
      db.strength_sets.toArray(),
      db.completed_sessions.toArray(),
    ]);
    return {
      exercises: exercises.filter((e) => !e.deleted_at && !e.archived_at),
      sets: sets.filter((s) => !s.deleted_at).map((s) => ({ ...s, load_kg: num(s.load_kg) })) as (StrengthSet & SetLike)[],
      sessions: sessions.filter((s) => !s.deleted_at).map((s) => ({ id: s.id, local_date: s.local_date })),
    };
  }, [db]);
  if (!data) return null;

  const mine = data.sets.filter((s) => s.completed_session_id === completion.id);
  const used = [...new Set(mine.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")).map((s) => s.exercise_id))];
  const name = (id: string) => data.exercises.find((e) => e.id === id)?.name ?? "Exercice";

  const addSet = (exerciseId: string) => {
    const prev = previousSets(data.sets, data.sessions, exerciseId, completion.id);
    const next = nextSetPrefill(mine.filter((s) => s.exercise_id === exerciseId), prev);
    void engine.mutate("strength_sets", uuidv7(), {
      completed_session_id: completion.id, exercise_id: exerciseId, set_index: next.set_index, side: next.side,
      load_kg: next.load_kg, reps: next.reps, rir: next.rir, is_warmup: false,
    });
  };
  const update = (s: SetLike, fields: Record<string, unknown>) => void engine.mutate("strength_sets", s.id, fields);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Séries</h2>
      {used.map((exerciseId) => {
        const prev = previousSets(data.sets, data.sessions, exerciseId, completion.id).filter((s) => !s.is_warmup);
        const rows = mine.filter((s) => s.exercise_id === exerciseId).sort((a, b) => a.set_index - b.set_index);
        return (
          <div key={exerciseId} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">{name(exerciseId)}</h3>
              {prev.length > 0 && (
                <span className="text-xs text-neutral-500">Dernière fois : {prev.map((s) => `${s.load_kg ?? 0} kg × ${s.reps ?? "?"}`).join(", ")}</span>
              )}
            </div>
            {rows.map((s) => (
              <div key={s.id} className="flex items-center gap-1 text-sm tabular-nums">
                <span className="w-6 text-neutral-500">{s.set_index}</span>
                <Stepper value={s.load_kg} step={2.5} unit="kg" onChange={(v) => update(s, { load_kg: v })} />
                <Stepper value={s.reps} step={1} unit="rép." onChange={(v) => update(s, { reps: v })} />
                <select value={s.rir ?? ""} onChange={(e) => update(s, { rir: e.target.value === "" ? null : Number(e.target.value) })} className="h-10 rounded border border-neutral-300 bg-transparent px-1 text-xs dark:border-neutral-700" aria-label="Répétitions en réserve">
                  <option value="">RIR</option>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>RIR {n}</option>)}
                </select>
                <button onClick={() => update(s, { deleted_at: nowIso() })} className="px-2 text-neutral-500" aria-label="Supprimer la série">×</button>
              </div>
            ))}
            <button onClick={() => addSet(exerciseId)} className="h-11 rounded-md bg-foreground font-medium text-background">+ Série</button>
          </div>
        );
      })}
      <select
        value=""
        onChange={(e) => e.target.value && addSet(e.target.value)}
        className="h-11 rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700"
        aria-label="Ajouter un exercice"
      >
        <option value="">+ Ajouter un exercice…</option>
        {exercisesForType(data.exercises.filter((e) => !used.includes(e.id)), sessionType).map((e) => (
          <option key={e.id} value={e.id}>{e.name}{e.loads_legs ? " (jambes)" : ""}</option>
        ))}
      </select>
    </section>
  );
}

function Stepper({ value, step, unit, onChange }: { value: number | null; step: number; unit: string; onChange: (v: number | null) => void }) {
  const v = value ?? 0;
  return (
    <span className="flex items-center">
      <button onClick={() => onChange(Math.max(0, Math.round((v - step) * 10) / 10))} className="h-10 w-9 rounded-l border border-neutral-300 dark:border-neutral-700" aria-label={`Moins ${step} ${unit}`}>−</button>
      <input
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value.replace(",", ".")))}
        className="h-10 w-14 border-y border-neutral-300 bg-transparent text-center dark:border-neutral-700"
        aria-label={unit}
      />
      <button onClick={() => onChange(Math.round((v + step) * 10) / 10)} className="h-10 w-9 rounded-r border border-neutral-300 dark:border-neutral-700" aria-label={`Plus ${step} ${unit}`}>+</button>
      <span className="ml-1 w-8 text-xs text-neutral-500">{unit}</span>
    </span>
  );
}
