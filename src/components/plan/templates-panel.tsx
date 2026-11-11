"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { v7 as uuidv7 } from "uuid";
import { inputClass } from "@/components/session-form";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { useSync } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";

/** Bibliothèque de séances types réutilisables (création rapide, motifs de semaine). */
export function TemplatesPanel() {
  const engine = useSync();
  const templates = useLiveQuery(async () => (await engine.db.session_templates.toArray()).filter((t) => !t.deleted_at).sort((a, b) => a.discipline.localeCompare(b.discipline) || a.name.localeCompare(b.name)), [engine.db]);
  if (!templates) return null;
  const save = (id: string, fields: Record<string, unknown>) => void engine.mutate("session_templates", id, fields);
  return (
    <section className="flex flex-col gap-2 text-sm">
      {templates.map((t) => (
        <details key={t.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <summary className="cursor-pointer">
            {t.name} <span className="text-neutral-500">· {DISCIPLINES[t.discipline as keyof typeof DISCIPLINES]} · {t.default_duration_s ? Math.round(t.default_duration_s / 60) : "?"} min{t.structure ? " · structurée" : ""}</span>
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && save(t.id, { name: e.target.value })} className={inputClass} aria-label="Nom" />
            <input inputMode="numeric" defaultValue={t.default_duration_s ? t.default_duration_s / 60 : ""} onBlur={(e) => save(t.id, { default_duration_s: Number(e.target.value) * 60 || null })} className={inputClass} aria-label="Durée en minutes" />
            <select value={t.discipline} onChange={(e) => save(t.id, { discipline: e.target.value })} className={inputClass} aria-label="Discipline">
              {Object.entries(DISCIPLINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={t.session_type} onChange={(e) => save(t.id, { session_type: e.target.value })} className={inputClass} aria-label="Type">
              {Object.entries(SESSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <textarea defaultValue={t.instructions ?? ""} onBlur={(e) => save(t.id, { instructions: e.target.value || null })} rows={2} className="col-span-2 rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" aria-label="Consignes" />
            <button onClick={() => window.confirm("Supprimer cette séance type ?") && save(t.id, { deleted_at: nowIso() })} className="justify-self-start text-neutral-500 underline">Supprimer</button>
          </div>
        </details>
      ))}
      <button onClick={() => save(uuidv7(), { name: "Nouvelle séance type", discipline: "run", session_type: "endurance", default_duration_s: 2700, tags: [] })} className="self-start underline">
        + Ajouter une séance type
      </button>
    </section>
  );
}
