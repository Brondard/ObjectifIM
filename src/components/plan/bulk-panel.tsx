"use client";

import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { bulkTargets, planBulk, type BulkAction } from "@/domain/plan/build";
import { formatDuration } from "@/lib/format";
import type { PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { addDays, formatLocalDate, today, type LocalDate } from "@/lib/time";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
type ActionKind = "shift" | "scale" | "indoor" | "type";

/** Modification en masse : décaler un bloc, passer en home trainer, appliquer un facteur de volume. */
export function BulkPanel() {
  const engine = useSync();
  const [from, setFrom] = useState<string>(today());
  const [to, setTo] = useState<string>(addDays(today(), 27));
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [kind, setKind] = useState<ActionKind>("shift");
  const [days, setDays] = useState(7);
  const [factor, setFactor] = useState(80);
  const [type, setType] = useState("endurance");
  const [targets, setTargets] = useState<PlannedSession[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const action = (): BulkAction =>
    kind === "shift" ? { kind: "shift", days }
      : kind === "scale" ? { kind: "scale", factor: factor / 100 }
        : kind === "indoor" ? { kind: "set", fields: { indoor: true } }
          : { kind: "set", fields: { session_type: type } };

  async function find() {
    setDone(null);
    const all = await engine.db.planned_sessions.where("date").between(from, to, true, true).toArray();
    setTargets(bulkTargets(all, { from, to, disciplines, weekdays }) as PlannedSession[]);
  }

  async function apply() {
    if (!targets?.length) return;
    const changes = planBulk(targets, action());
    await engine.mutateMany([
      ...changes.map((c) => ({ table: "planned_sessions" as const, id: c.id, fields: c.fields })),
      {
        table: "plan_changes", id: uuidv7(),
        fields: { trigger: "bulk_edit", reason: "Modification en masse", input: { from, to, disciplines, weekdays, action: action() }, chosen_option: "apply", affected: changes.map((c) => ({ id: c.id, before: c.before, after: c.fields })) },
      },
    ]);
    setDone(`${changes.length} séance(s) modifiée(s).`);
    setTargets(null);
  }

  return (
    <section className="flex flex-col gap-3 text-sm">
      <p className="text-neutral-500">Seules les séances prévues et non réalisées sont modifiées. Chaque modification est inscrite au journal.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1">Disciplines (toutes si aucune)</legend>
        {Object.entries(DISCIPLINES).map(([k, v]) => (
          <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={disciplines.includes(k)} onChange={() => setDisciplines(toggle(disciplines, k))} className="h-5 w-5" />{v}</label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1">Jours (tous si aucun)</legend>
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={weekdays.includes(i + 1)} onChange={() => setWeekdays(toggle(weekdays, i + 1))} className="h-5 w-5" />{d}</label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Action">
          <select value={kind} onChange={(e) => setKind(e.target.value as ActionKind)} className={inputClass}>
            <option value="shift">Décaler de N jours</option>
            <option value="scale">Appliquer un facteur de volume</option>
            <option value="indoor">Passer en intérieur (home trainer, tapis)</option>
            <option value="type">Changer le type de séance</option>
          </select>
        </Field>
        {kind === "shift" && <Field label="Jours (négatif : avancer)"><input inputMode="numeric" value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} className={inputClass} /></Field>}
        {kind === "scale" && <Field label="Volume (%)"><input inputMode="numeric" value={factor} onChange={(e) => setFactor(Number(e.target.value) || 100)} className={inputClass} /></Field>}
        {kind === "type" && (
          <Field label="Nouveau type">
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
              {Object.entries(SESSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
      </div>
      <button onClick={() => void find()} className="h-11 self-start rounded-md border border-neutral-300 px-4 dark:border-neutral-700">Voir les séances concernées</button>
      {targets && (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">{targets.length} séance(s) concernée(s)</p>
          <ul className="max-h-48 overflow-auto text-neutral-600 dark:text-neutral-400">
            {targets.map((s) => (
              <li key={s.id}>{formatLocalDate(s.date as LocalDate, { weekday: "short", day: "numeric", month: "short" })} · {s.title ?? SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES]} · {formatDuration(s.target_duration_s)}</li>
            ))}
          </ul>
          <button onClick={() => void apply()} disabled={!targets.length} className="h-11 rounded-md bg-foreground font-medium text-background disabled:opacity-50">Appliquer</button>
        </div>
      )}
      {done && <p className="rounded-md bg-neutral-100 p-3 dark:bg-neutral-900">{done}</p>}
    </section>
  );
}
