"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { DISCIPLINES, PRIORITIES, SESSION_TYPES } from "@/domain/labels";
import type { ImportPlan, PlanBlock } from "@/domain/plan/block";
import { applyPattern, type PatternItem, type PatternWeek } from "@/domain/plan/build";
import { formatDuration } from "@/lib/format";
import type { WeekTemplateItem } from "@/lib/sync/db";
import { applyImport, previewImport } from "@/lib/sync/plan-import";
import { useSync } from "@/lib/sync/provider";
import { addDays, nowIso, today, weekStart } from "@/lib/time";
import { ImportPreview } from "./import-panel";

const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Motifs de semaine : la voie principale pour remplir une préparation de 400 à 500 séances. */
export function PatternsPanel() {
  const engine = useSync();
  const { db } = engine;
  const data = useLiveQuery(async () => {
    const [templates, items, sessionTemplates] = await Promise.all([db.week_templates.toArray(), db.week_template_items.toArray(), db.session_templates.toArray()]);
    return {
      templates: templates.filter((t) => !t.deleted_at),
      items: items.filter((i) => !i.deleted_at),
      sessionTemplates: sessionTemplates.filter((t) => !t.deleted_at),
    };
  }, [db]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) return null;
  const current = data.templates.find((t) => t.id === selected) ?? data.templates[0] ?? null;

  async function create() {
    const id = uuidv7();
    await engine.mutate("week_templates", id, { name: "Semaine type", notes: null });
    setSelected(id);
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-neutral-500">
        Une semaine type par phase, appliquée sur une plage de dates avec une progression et une semaine allégée régulière. Les séances
        générées s&apos;ajustent ensuite une par une ; réappliquer le motif remplace celles qui ne sont pas encore faites.
      </p>
      <div className="flex flex-wrap gap-2">
        {data.templates.map((t) => (
          <button key={t.id} onClick={() => setSelected(t.id)} className={`rounded-md px-3 py-2 text-sm ${t.id === current?.id ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {t.name}
          </button>
        ))}
        <button onClick={() => void create()} className="rounded-md px-3 py-2 text-sm underline">+ Nouveau motif</button>
      </div>
      {current && (
        <PatternEditor
          key={current.id}
          template={current}
          items={data.items.filter((i) => i.week_template_id === current.id).sort((a, b) => a.weekday - b.weekday || (a.local_time ?? "").localeCompare(b.local_time ?? ""))}
          sessionTemplates={data.sessionTemplates}
        />
      )}
    </section>
  );
}

function PatternEditor({
  template, items, sessionTemplates,
}: {
  template: { id: string; name: string };
  items: WeekTemplateItem[];
  sessionTemplates: { id: string; name: string; discipline: string; session_type: string; default_duration_s: number | null; target_intensity: unknown; structure: unknown; instructions: string | null }[];
}) {
  const engine = useSync();
  const [from, setFrom] = useState<string>(weekStart(addDays(today(), 7)));
  const [to, setTo] = useState<string>(addDays(weekStart(addDays(today(), 7)), 27));
  const [deloadEvery, setDeloadEvery] = useState(4);
  const [ratio, setRatio] = useState(60);
  const [preview, setPreview] = useState<{ block: PlanBlock; plan: ImportPlan; weeks: PatternWeek[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const save = (id: string, fields: Partial<WeekTemplateItem> & Record<string, unknown>) => void engine.mutate("week_template_items", id, fields);

  function addItem(templateId: string) {
    const t = sessionTemplates.find((s) => s.id === templateId);
    void engine.mutate("week_template_items", uuidv7(), {
      week_template_id: template.id, weekday: 1, local_time: null, position: items.length,
      session_template_id: t?.id ?? null, discipline: t?.discipline ?? "run", session_type: t?.session_type ?? "endurance",
      priority: "secondary", duration_s: t?.default_duration_s ?? 2700, distance_m: null,
      target_intensity: t?.target_intensity ?? null, structure: t?.structure ?? null, instructions: t?.instructions ?? null, progression: {},
    });
  }

  async function previewApply() {
    setDone(null);
    const patternItems: PatternItem[] = items.map((i) => ({
      id: i.id, weekday: i.weekday, local_time: i.local_time, discipline: i.discipline, session_type: i.session_type, priority: i.priority,
      duration_s: i.duration_s, distance_m: i.distance_m, target_intensity: i.target_intensity, structure: i.structure, instructions: i.instructions,
      title: sessionTemplates.find((s) => s.id === i.session_template_id)?.name ?? null,
      progression: i.progression as PatternItem["progression"],
    }));
    const { block, weeks } = applyPattern(patternItems, { from, to, deloadEvery, deloadRatio: ratio / 100 });
    setPreview({ block, weeks, plan: await previewImport(engine, block, "motif") });
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    await applyImport(engine, preview.block, preview.plan, { kind: "json", source: "pattern", fileName: `Motif « ${template.name} »`, payload: { template: template.id, from, to, deloadEvery, ratio } });
    setBusy(false);
    setDone(`${preview.plan.creates.length + preview.plan.updates.length} séance(s) générée(s) du ${from} au ${to}.`);
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input defaultValue={template.name} onBlur={(e) => e.target.value !== template.name && void engine.mutate("week_templates", template.id, { name: e.target.value })} className={inputClass} aria-label="Nom du motif" />
        <button onClick={() => window.confirm("Supprimer ce motif ? Les séances déjà générées restent.") && void engine.mutate("week_templates", template.id, { deleted_at: nowIso() })} className="text-sm text-neutral-500 underline">Supprimer</button>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((i) => {
          const p = (i.progression ?? {}) as { step_min?: number; every_weeks?: number; max_min?: number };
          return (
            <li key={i.id} className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 p-2 text-sm sm:grid-cols-6 dark:border-neutral-800">
              <select value={i.weekday} onChange={(e) => save(i.id, { weekday: Number(e.target.value) })} className={`${inputClass} h-9`} aria-label="Jour">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select>
              <input type="time" defaultValue={i.local_time?.slice(0, 5) ?? ""} onBlur={(e) => save(i.id, { local_time: e.target.value || null })} className={`${inputClass} h-9`} aria-label="Heure" />
              <select value={i.discipline} onChange={(e) => save(i.id, { discipline: e.target.value })} className={`${inputClass} h-9`} aria-label="Discipline">
                {Object.entries(DISCIPLINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={i.session_type} onChange={(e) => save(i.id, { session_type: e.target.value })} className={`${inputClass} h-9`} aria-label="Type">
                {Object.entries(SESSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={i.priority} onChange={(e) => save(i.id, { priority: e.target.value })} className={`${inputClass} h-9`} aria-label="Priorité">
                {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <label className="flex items-center gap-1">
                <input inputMode="numeric" defaultValue={i.duration_s ? i.duration_s / 60 : ""} onBlur={(e) => save(i.id, { duration_s: Number(e.target.value) * 60 || null })} className={`${inputClass} h-9`} aria-label="Durée en minutes" /> min
              </label>
              <label className="col-span-2 flex items-center gap-1 text-xs sm:col-span-5">
                Progression : +
                <input inputMode="numeric" defaultValue={p.step_min ?? ""} onBlur={(e) => save(i.id, { progression: { ...p, step_min: Number(e.target.value) || undefined } })} className={`${inputClass} h-8 w-14`} aria-label="Minutes ajoutées" />
                min toutes les
                <input inputMode="numeric" defaultValue={p.every_weeks ?? 1} onBlur={(e) => save(i.id, { progression: { ...p, every_weeks: Number(e.target.value) || 1 } })} className={`${inputClass} h-8 w-12`} aria-label="Semaines" />
                sem., plafond
                <input inputMode="numeric" defaultValue={p.max_min ?? ""} onBlur={(e) => save(i.id, { progression: { ...p, max_min: Number(e.target.value) || undefined } })} className={`${inputClass} h-8 w-16`} aria-label="Plafond en minutes" />
                min
              </label>
              <button onClick={() => save(i.id, { deleted_at: nowIso() })} className="text-xs text-neutral-500 underline">Retirer</button>
            </li>
          );
        })}
      </ul>
      <select value="" onChange={(e) => addItem(e.target.value)} className={`${inputClass} self-start`} aria-label="Ajouter une séance au motif">
        <option value="">+ Ajouter une séance…</option>
        <option value="blank">Séance vierge</option>
        {sessionTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-4 dark:border-neutral-800">
        <Field label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
        <Field label="Semaine allégée toutes les">
          <select value={deloadEvery} onChange={(e) => setDeloadEvery(Number(e.target.value))} className={inputClass}>
            <option value={0}>jamais</option><option value={3}>3 semaines</option><option value={4}>4 semaines</option>
          </select>
        </Field>
        <Field label="Volume allégé (%)"><input inputMode="numeric" value={ratio} onChange={(e) => setRatio(Number(e.target.value) || 60)} className={inputClass} /></Field>
        <button onClick={() => void previewApply()} disabled={!items.length} className="col-span-2 h-11 rounded-md bg-foreground font-medium text-background disabled:opacity-50 sm:col-span-4">Aperçu</button>
      </div>

      {preview && (
        <>
          <ul className="text-sm tabular-nums">
            {preview.weeks.map((w) => <li key={w.start}>Semaine du {w.start} : {formatDuration(w.minutes * 60)}{w.deload ? " · allégée" : ""}</li>)}
          </ul>
          <ImportPreview block={preview.block} plan={preview.plan} onApply={() => void apply()} onCancel={() => setPreview(null)} busy={busy} />
        </>
      )}
      {done && <p className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{done}</p>}
    </div>
  );
}
