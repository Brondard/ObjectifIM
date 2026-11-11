"use client";

import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { FORMATS, SPORTS } from "@/domain/labels";
import { DEFAULT_TIMELINE, morningTimeline, type TimelineItem } from "@/domain/race/plan";
import { formatHms, parseHms } from "@/lib/format";
import type { Checklist, ChecklistItem, Race, RacePlan } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";
import { planId } from "./leg-planner";

type Goals = { a?: number; b?: number; c?: number };

/** Fiche de la course : modifiable champ par champ. */
export function RaceInfo({ race }: { race: Race }) {
  const engine = useSync();
  const goals = (race.goals ?? {}) as Goals;
  const save = (fields: Partial<Race> & Record<string, unknown>) => void engine.mutate("races", race.id, fields);
  const text = (k: "name" | "location" | "registration_url", label: string) => (
    <Field label={label}>
      <input defaultValue={race[k] ?? ""} onBlur={(e) => e.target.value !== (race[k] ?? "") && save({ [k]: e.target.value.trim() || null })} className={inputClass} />
    </Field>
  );
  return (
    <details className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <summary className="cursor-pointer font-medium">Fiche de la course</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {text("name", "Nom")}
        <Field label="Date"><input type="date" defaultValue={race.date} onBlur={(e) => e.target.value && e.target.value !== race.date && save({ date: e.target.value })} className={inputClass} /></Field>
        <Field label="Départ"><input type="time" defaultValue={race.start_time?.slice(0, 5) ?? ""} onBlur={(e) => save({ start_time: e.target.value || null })} className={inputClass} /></Field>
        <Field label="Priorité">
          <select defaultValue={race.priority} onChange={(e) => save({ priority: e.target.value })} className={inputClass}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
        </Field>
        <Field label="Sport">
          <select defaultValue={race.sport} onChange={(e) => save({ sport: e.target.value })} className={inputClass}>
            {Object.entries(SPORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Format">
          <select defaultValue={race.format} onChange={(e) => save({ format: e.target.value })} className={inputClass}>
            {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {(["a", "b", "c"] as const).map((k) => (
          <Field key={k} label={`Objectif ${k.toUpperCase()}`}>
            <input
              defaultValue={goals[k] ? formatHms(goals[k]) : ""}
              placeholder="h:mm:ss"
              onBlur={(e) => {
                const v = parseHms(e.target.value);
                if ((v ?? undefined) !== goals[k]) save({ goals: { ...goals, [k]: v ?? undefined } });
              }}
              className={inputClass}
            />
          </Field>
        ))}
        {text("location", "Lieu")}
        {text("registration_url", "Lien d'inscription")}
      </div>
    </details>
  );
}

/** Déroulé du matin, en horaires relatifs au départ. */
export function MorningTimeline({ race, plan }: { race: Race; plan: RacePlan | null }) {
  const engine = useSync();
  const items = ((plan?.morning_timeline as TimelineItem[] | null)?.length ? plan!.morning_timeline : DEFAULT_TIMELINE) as TimelineItem[];
  const [draft, setDraft] = useState({ offset: "", label: "" });
  const persist = (next: TimelineItem[]) =>
    void engine.mutate("race_plans", planId(engine.db.userId, race.id, "full"), { race_id: race.id, name: `Matin : ${race.name}`, leg: "full", morning_timeline: next });
  const start = race.start_time?.slice(0, 5) ?? null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h2 className="text-lg font-medium">Déroulé du matin</h2>
      {!start && <p className="text-neutral-500">Indique l&apos;heure de départ dans la fiche pour voir les horaires.</p>}
      <ul className="tabular-nums">
        {(start ? morningTimeline(start, items) : items.map((i) => ({ ...i, time: "" }))).map((it, i) => (
          <li key={i} className="flex justify-between gap-2 border-t border-neutral-200 py-1 dark:border-neutral-800">
            <span>
              <strong>{it.time}</strong> <span className="text-neutral-500">(H{it.offset_min >= 0 ? "+" : "−"}{Math.abs(it.offset_min)} min)</span> {it.label}
            </span>
            <button onClick={() => persist(items.filter((x) => x !== items.find((y) => y.offset_min === it.offset_min && y.label === it.label)))} className="text-neutral-500" aria-label="Retirer">×</button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const offset = -Math.abs(Number(draft.offset));
          if (!draft.label.trim() || !Number.isFinite(offset)) return;
          persist([...items, { offset_min: offset, label: draft.label.trim() }]);
          setDraft({ offset: "", label: "" });
        }}
      >
        <input placeholder="min avant" inputMode="numeric" value={draft.offset} onChange={(e) => setDraft({ ...draft, offset: e.target.value })} className={`${inputClass} w-28`} />
        <input placeholder="Étape" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={inputClass} />
        <button className="rounded-md border border-neutral-300 px-3 dark:border-neutral-700">+</button>
      </form>
    </section>
  );
}

/** Checklist de la course : copiée d'un modèle réutilisable, cochée la veille. */
export function RaceChecklist({ race, checklist, items, templates }: { race: Race; checklist: Checklist | null; items: ChecklistItem[]; templates: Checklist[] }) {
  const engine = useSync();
  const [label, setLabel] = useState("");

  async function fromTemplate(templateId: string) {
    const source = (await engine.db.checklist_items.where("checklist_id").equals(templateId).toArray()).filter((i) => !i.deleted_at);
    const id = uuidv7();
    await engine.mutateMany([
      { table: "checklists", id, fields: { name: `Checklist : ${race.name}`, is_template: false, race_id: race.id } },
      ...source.map((s) => ({ table: "checklist_items" as const, id: uuidv7(), fields: { checklist_id: id, label: s.label, position: s.position } })),
    ]);
  }

  if (!checklist) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="text-lg font-medium">Checklist</h2>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => void fromTemplate(t.id)} className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700">Partir du modèle « {t.name} »</button>
          ))}
        </div>
      </section>
    );
  }
  const done = items.filter((i) => i.checked_at).length;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h2 className="text-lg font-medium">Checklist ({done}/{items.length})</h2>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex items-center gap-3 py-1.5">
              <input type="checkbox" checked={!!i.checked_at} onChange={(e) => void engine.mutate("checklist_items", i.id, { checked_at: e.target.checked ? nowIso() : null })} className="h-5 w-5" />
              <span className={i.checked_at ? "text-neutral-400 line-through" : ""}>{i.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        void engine.mutate("checklist_items", uuidv7(), { checklist_id: checklist.id, label: label.trim(), position: items.length + 1 });
        setLabel("");
      }}>
        <input placeholder="Ajouter un élément" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        <button className="rounded-md border border-neutral-300 px-3 dark:border-neutral-700">+</button>
      </form>
    </section>
  );
}

type Debrief = { worked?: string; failed?: string; fix?: string };

/** Résultat et débrief structuré : ce qui a marché, ce qui a lâché, à corriger. */
export function RaceDebrief({ race }: { race: Race }) {
  const engine = useSync();
  const result = (race.result ?? {}) as { time_s?: number; notes?: string };
  const debrief = (race.debrief ?? {}) as Debrief;
  const field = (k: keyof Debrief, label: string) => (
    <Field label={label}>
      <textarea rows={3} defaultValue={debrief[k] ?? ""} onBlur={(e) => e.target.value !== (debrief[k] ?? "") && void engine.mutate("races", race.id, { debrief: { ...debrief, [k]: e.target.value } })}
        className="rounded-md border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" />
    </Field>
  );
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h2 className="text-lg font-medium">Résultat et débrief</h2>
      <Field label="Temps final (h:mm:ss)">
        <input defaultValue={result.time_s ? formatHms(result.time_s) : ""} onBlur={(e) => {
          const t = parseHms(e.target.value);
          if (t !== (result.time_s ?? null)) void engine.mutate("races", race.id, { result: { ...result, time_s: t ?? undefined } });
        }} className={inputClass} />
      </Field>
      {field("worked", "Ce qui a marché")}
      {field("failed", "Ce qui a lâché")}
      {field("fix", "À corriger pour la prochaine")}
    </section>
  );
}
