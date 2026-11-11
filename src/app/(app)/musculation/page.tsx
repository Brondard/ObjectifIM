"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { ChartBlock, StrengthProgressChart } from "@/components/charts";
import { inputClass } from "@/components/session-form";
import { exerciseProgress, type SetLike } from "@/domain/life/strength";
import { useSync } from "@/lib/sync/provider";
import { formatLocalDate, nowIso, type LocalDate } from "@/lib/time";

/** Musculation : progression des charges par exercice, bibliothèque d'exercices. */
export default function StrengthPage() {
  const engine = useSync();
  const { db } = engine;
  const data = useLiveQuery(async () => {
    const [exercises, sets, sessions] = await Promise.all([db.strength_exercises.toArray(), db.strength_sets.toArray(), db.completed_sessions.toArray()]);
    return {
      exercises: exercises.filter((e) => !e.deleted_at).sort((a, b) => a.name.localeCompare(b.name)),
      sets: sets.filter((s) => !s.deleted_at).map((s) => ({ ...s, load_kg: s.load_kg == null ? null : Number(s.load_kg) })) as SetLike[],
      sessions: sessions.filter((s) => !s.deleted_at).map((s) => ({ id: s.id, local_date: s.local_date })),
    };
  }, [db]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  if (!data) return null;
  const withSets = data.exercises.filter((e) => data.sets.some((s) => s.exercise_id === e.id));
  const current = data.exercises.find((e) => e.id === selected) ?? withSets[0] ?? null;
  const progress = current ? exerciseProgress(data.sets, data.sessions, current.id) : [];
  const save = (id: string, fields: Record<string, unknown>) => void engine.mutate("strength_exercises", id, fields);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Musculation</h1>
      {withSets.length === 0 ? (
        <p className="text-sm text-neutral-500">Aucune série enregistrée. Ouvre une séance de musculation et saisis tes séries : la progression apparaîtra ici.</p>
      ) : (
        <section className="flex flex-col gap-3">
          <select value={current?.id ?? ""} onChange={(e) => setSelected(e.target.value)} className={inputClass} aria-label="Exercice">
            {withSets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {progress.length > 0 && (
            <ChartBlock
              title={`${current?.name} : progression`}
              table={<table className="tabular-nums"><tbody>{progress.map((p) => <tr key={p.date}><td className="pr-3">{p.date}</td><td className="pr-3">{p.top_kg} kg</td><td className="pr-3">1RM ≈ {p.e1rm ?? "—"} kg</td><td>{p.volume_kg} kg soulevés · {p.sets} séries</td></tr>)}</tbody></table>}
            >
              <StrengthProgressChart data={progress.map((p) => ({ label: formatLocalDate(p.date as LocalDate, { day: "numeric", month: "short" }), top: p.top_kg, e1rm: p.e1rm }))} />
            </ChartBlock>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Bibliothèque d&apos;exercices</h2>
        <p className="text-neutral-500">« Jambes » : le moteur n&apos;en place jamais dans les 24 h avant une séance clé, ni dans les 10 jours avant une course A.</p>
        <ul className="flex flex-col">
          {data.exercises.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 py-1.5 dark:border-neutral-800">
              <span className={e.archived_at ? "text-neutral-400 line-through" : ""}>{e.name} <span className="text-xs text-neutral-500">{e.muscle_groups.join(", ")}</span></span>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1"><input type="checkbox" checked={e.loads_legs} onChange={(x) => save(e.id, { loads_legs: x.target.checked })} className="h-5 w-5" /> jambes</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={e.is_unilateral} onChange={(x) => save(e.id, { is_unilateral: x.target.checked })} className="h-5 w-5" /> unilatéral</label>
                <button onClick={() => save(e.id, { archived_at: e.archived_at ? null : nowIso() })} className="text-xs text-neutral-500 underline">{e.archived_at ? "Réactiver" : "Archiver"}</button>
              </span>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          save(uuidv7(), { name: name.trim(), muscle_groups: [], is_unilateral: false, loads_legs: false });
          setName("");
        }}>
          <input placeholder="Nouvel exercice" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          <button className="rounded-md border border-neutral-300 px-3 dark:border-neutral-700">+</button>
        </form>
      </section>
    </div>
  );
}
