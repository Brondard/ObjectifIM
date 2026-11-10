"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import type { EngineRule, SubstitutionRow } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";
import { inputClass } from "./session-form";

const GROUPS = [
  { kind: "hard", title: "Règles dures", hint: "Jamais violées par le moteur. Les désactiver est possible, mais à tes risques." },
  { kind: "soft", title: "Règles souples", hint: "Pondérées : plus le poids est haut, plus le moteur évite de les enfreindre." },
  { kind: "config", title: "Paramètres", hint: "Valeurs utilisées par les calculs (jugement de l'intensité, charge, cibles par défaut)." },
] as const;

/** Règles du moteur : modifiables sans redéployer (paramètres en base, logique en code). */
export function EngineRulesSettings() {
  const { db } = useSync();
  const rules = useLiveQuery(async () => (await db.engine_rules.toArray()).filter((r) => !r.deleted_at).sort((a, b) => a.rule_key.localeCompare(b.rule_key)), [db]);
  if (!rules) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Règles du moteur</h2>
      {GROUPS.map((g) => (
        <details key={g.kind} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <summary className="cursor-pointer font-medium">{g.title} ({rules.filter((r) => r.kind === g.kind).length})</summary>
          <p className="mt-1 text-xs text-neutral-500">{g.hint}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {rules.filter((r) => r.kind === g.kind).map((r) => <RuleRow key={r.id} rule={r} />)}
          </ul>
        </details>
      ))}
    </section>
  );
}

function RuleRow({ rule }: { rule: EngineRule }) {
  const engine = useSync();
  const [text, setText] = useState(JSON.stringify(rule.params, null, 1));
  const [error, setError] = useState<string | null>(null);
  const save = (fields: Partial<EngineRule>) => void engine.mutate("engine_rules", rule.id, fields);

  return (
    <li className="flex flex-col gap-1 border-t border-neutral-200 pt-2 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2">
          {rule.kind !== "config" && (
            <input type="checkbox" checked={rule.enabled} onChange={(e) => save({ enabled: e.target.checked })} className="h-5 w-5" />
          )}
          <span className={rule.enabled ? "" : "text-neutral-400 line-through"}>{rule.description ?? rule.rule_key}</span>
        </label>
        {rule.kind === "soft" && (
          <label className="flex shrink-0 items-center gap-1 text-xs">
            poids
            <input
              type="number"
              min={0}
              step={0.5}
              defaultValue={Number(rule.weight)}
              onBlur={(e) => Number(e.target.value) !== Number(rule.weight) && save({ weight: Number(e.target.value) })}
              className="h-8 w-16 rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-700"
            />
          </label>
        )}
      </div>
      {text !== "{}" || rule.kind === "config" ? (
        <textarea
          rows={Math.min(8, text.split("\n").length)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            try {
              const parsed = JSON.parse(text);
              setError(null);
              if (JSON.stringify(parsed) !== JSON.stringify(rule.params)) save({ params: parsed });
            } catch {
              setError("JSON invalide : non enregistré.");
            }
          }}
          className="rounded border border-neutral-300 bg-transparent p-2 font-mono text-xs dark:border-neutral-700"
          aria-label={`Paramètres de ${rule.rule_key}`}
        />
      ) : null}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

/** Table de correspondance du mode déplacement. */
export function SubstitutionsSettings() {
  const engine = useSync();
  const rows = useLiveQuery(async () => (await engine.db.substitutions.toArray()).filter((r) => !r.deleted_at), [engine.db]);
  if (!rows) return null;
  const add = () =>
    void engine.mutate("substitutions", uuidv7(), {
      from_discipline: "bike", from_session_type: null, to_discipline: "run", to_session_type: "endurance",
      to_label: "Nouvelle substitution", duration_ratio: 1, loss_note: "À préciser",
    });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Substitutions en déplacement</h2>
      <p className="text-sm text-neutral-500">Quand le matériel manque, le moteur propose ces équivalents et affiche ce qu&apos;ils font perdre.</p>
      {rows.map((r) => <SubstitutionRowEditor key={r.id} row={r} />)}
      <button onClick={add} className="self-start text-sm underline">+ Ajouter une substitution</button>
    </section>
  );
}

function SubstitutionRowEditor({ row }: { row: SubstitutionRow }) {
  const engine = useSync();
  const save = (fields: Partial<SubstitutionRow>) => void engine.mutate("substitutions", row.id, fields);
  const select = (value: string | null, options: Record<string, string>, onChange: (v: string | null) => void, allowAny = false) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={`${inputClass} h-9 text-sm`}>
      {allowAny && <option value="">tout type</option>}
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <span className="col-span-2 text-xs text-neutral-500">Si impossible :</span>
      {select(row.from_discipline, DISCIPLINES, (v) => save({ from_discipline: v ?? "bike" }))}
      {select(row.from_session_type, SESSION_TYPES, (v) => save({ from_session_type: v }), true)}
      <span className="col-span-2 text-xs text-neutral-500">Remplacer par :</span>
      {select(row.to_discipline, DISCIPLINES, (v) => save({ to_discipline: v ?? "run" }))}
      {select(row.to_session_type, SESSION_TYPES, (v) => save({ to_session_type: v ?? "endurance" }))}
      <input defaultValue={row.to_label} onBlur={(e) => e.target.value !== row.to_label && save({ to_label: e.target.value })} className={`${inputClass} col-span-2 h-9`} aria-label="Libellé" />
      <label className="flex items-center gap-2 text-xs">
        durée ×
        <input type="number" step={0.05} min={0.1} defaultValue={Number(row.duration_ratio)} onBlur={(e) => Number(e.target.value) !== Number(row.duration_ratio) && save({ duration_ratio: Number(e.target.value) })} className={`${inputClass} h-9`} />
      </label>
      <button onClick={() => window.confirm("Supprimer cette substitution ?") && save({ deleted_at: nowIso() })} className="text-xs text-neutral-500 underline">
        Supprimer
      </button>
      <textarea defaultValue={row.loss_note} onBlur={(e) => e.target.value !== row.loss_note && save({ loss_note: e.target.value })} rows={2} className="col-span-2 rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" aria-label="Ce que la substitution fait perdre" />
    </div>
  );
}
