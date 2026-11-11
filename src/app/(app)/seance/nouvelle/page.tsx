"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Suspense, useState } from "react";
import { parseIntensity } from "@/domain/session-structure";
import { v7 as uuidv7 } from "uuid";
import { Feedback } from "@/components/session-card";
import { DisciplinePicker, Field, SessionForm, inputClass } from "@/components/session-form";
import type { Discipline } from "@/domain/labels";
import { useSync } from "@/lib/sync/provider";
import { isLocalDate, today } from "@/lib/time";

export default function NewSessionPage() {
  return (
    <Suspense>
      <NewSession />
    </Suspense>
  );
}

function NewSession() {
  const params = useSearchParams();
  const router = useRouter();
  const engine = useSync();
  const now = today();
  const requested = params.get("date");
  const date = requested && isLocalDate(requested) ? requested : now;
  const [alreadyDone, setAlreadyDone] = useState(params.get("faite") === "1");
  const back = (d: string) => router.push(d === now ? "/" : `/semaine?d=${d}`);
  const templates = useLiveQuery(async () => (await engine.db.session_templates.toArray()).filter((t) => !t.deleted_at).sort((a, b) => a.name.localeCompare(b.name)), [engine.db]);
  const [templateId, setTemplateId] = useState("");
  const template = templates?.find((t) => t.id === templateId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">{alreadyDone ? "Séance imprévue" : "Nouvelle séance"}</h1>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-100 p-1 text-sm dark:bg-neutral-900">
        <button onClick={() => setAlreadyDone(false)} className={`h-9 rounded ${!alreadyDone ? "bg-background font-medium shadow-sm" : ""}`}>
          À prévoir
        </button>
        <button onClick={() => setAlreadyDone(true)} className={`h-9 rounded ${alreadyDone ? "bg-background font-medium shadow-sm" : ""}`}>
          Déjà faite
        </button>
      </div>

      {alreadyDone ? (
        <UnplannedForm
          date={date}
          onSave={async (fields) => {
            await engine.mutate("completed_sessions", uuidv7(), fields);
            back(fields.local_date);
          }}
        />
      ) : (
        <>
        {!!templates?.length && (
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-11 rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700" aria-label="Partir d'une séance type">
            <option value="">Partir d&apos;une séance type…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <SessionForm
          key={templateId}
          collapsed={!template}
          submitLabel="Créer la séance"
          initial={{
            date,
            local_time: null,
            discipline: (template?.discipline ?? "run") as "run",
            session_type: template?.session_type ?? "endurance",
            priority: "secondary",
            status: "planned",
            title: template?.name ?? null,
            target_duration_s: template?.default_duration_s ?? null,
            target_distance_m: template?.default_distance_m ?? null,
            instructions: template?.instructions ?? null,
            indoor: false,
            target_intensity: parseIntensity(template?.target_intensity),
          }}
          onSubmit={async (values) => {
            await engine.mutate("planned_sessions", uuidv7(), {
              ...values, source: "manual", template_id: template?.id ?? null, structure: template?.structure ?? null,
            });
            back(values.date);
          }}
        />
        </>
      )}
    </div>
  );
}

/** Séance faite sans avoir été prévue : réalisé seul, sans lien. */
function UnplannedForm({
  date: initialDate,
  onSave,
}: {
  date: string;
  onSave: (fields: { local_date: string } & Record<string, unknown>) => Promise<void>;
}) {
  const [date, setDate] = useState(initialDate);
  const [discipline, setDiscipline] = useState<Discipline>("run");
  const [minutes, setMinutes] = useState("");
  const [distance, setDistance] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [feeling, setFeeling] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const seconds = Math.round(Number(minutes) * 60);
        const dist = distance === "" ? null : Number(distance.replace(",", "."));
        void onSave({
          local_date: date,
          discipline,
          moving_s: seconds,
          elapsed_s: seconds,
          distance_m: dist == null ? null : Math.round(discipline === "swim" ? dist : dist * 1000),
          rpe,
          feeling,
          source: "manual",
          match_status: "standalone",
        });
      }}
    >
      <Field label="Date">
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </Field>
      <DisciplinePicker value={discipline} onChange={setDiscipline} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Durée (min)">
          <input type="number" inputMode="numeric" min={1} required value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputClass} />
        </Field>
        <Field label={discipline === "swim" ? "Distance (m)" : "Distance (km)"}>
          <input type="number" inputMode="decimal" step="any" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Feedback rpe={rpe} feeling={feeling} onChange={(r, f) => { setRpe(r); setFeeling(f); }} />
      <button className="h-12 rounded-md bg-foreground font-medium text-background">Enregistrer</button>
    </form>
  );
}
