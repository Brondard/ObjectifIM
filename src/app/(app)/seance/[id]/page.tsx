"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { MatchPrompt, RealizedAnalysis } from "@/components/realized";
import { StrengthLog } from "@/components/strength-log";
import { EquipmentPicker, WeatherLine } from "@/components/life";
import { planMark } from "@/domain/marking";
import { SessionFuel } from "@/components/race/reminders";
import { Feedback } from "@/components/session-card";
import { TargetLines, resolveStep, targetLabel } from "@/components/targets";
import { SessionForm, valuesOf, type SessionFormValues } from "@/components/session-form";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { moveChange, planMove } from "@/domain/planning";
import { flattenSteps, SessionStructure } from "@/domain/session-structure";
import { formatDuration } from "@/lib/format";
import { planFeedback } from "@/domain/marking";
import { useSync } from "@/lib/sync/provider";
import { useCompletionsOf, usePlanned, useTargetContext } from "@/lib/sync/queries";
import { formatLocalDate, nowIso, type LocalDate } from "@/lib/time";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const engine = useSync();
  const session = usePlanned(id);
  const completions = useCompletionsOf(id)?.filter((c) => !c.deleted_at) ?? [];
  const targetCtx = useTargetContext();

  if (session === undefined) return null;
  if (!session || session.deleted_at) return <p className="text-sm text-neutral-500">Séance introuvable ou supprimée.</p>;

  async function save(values: SessionFormValues) {
    if (!session) return;
    const before = valuesOf(session);
    const changed = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof SessionFormValues])),
    ) as Partial<SessionFormValues> & Record<string, unknown>;
    if (!Object.keys(changed).length) return router.back();
    const writes = [];
    if (changed.date) {
      // Un changement de date est un déplacement : date d'origine gardée et journalisée.
      Object.assign(changed, planMove(session, changed.date as LocalDate));
      writes.push({ table: "plan_changes" as const, id: uuidv7(), fields: moveChange(session, changed.date as LocalDate) });
    }
    await engine.mutateMany([{ table: "planned_sessions", id: session.id, fields: changed }, ...writes]);
    router.back();
  }

  async function remove() {
    if (!session || !window.confirm("Supprimer cette séance prévue ? Le réalisé éventuel est conservé.")) return;
    await engine.mutate("planned_sessions", session.id, { deleted_at: nowIso() });
    router.back();
  }

  const structure = session.structure ? SessionStructure.safeParse(session.structure) : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-neutral-500 first-letter:uppercase">
          {formatLocalDate(session.date as LocalDate)} · {DISCIPLINES[session.discipline as keyof typeof DISCIPLINES]}
        </p>
        <h1 className="text-xl font-semibold">
          {session.title || SESSION_TYPES[session.session_type as keyof typeof SESSION_TYPES]}
        </h1>
        {session.original_date && (
          <p className="text-sm text-neutral-500">
            Déplacée depuis le {formatLocalDate(session.original_date as LocalDate, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-1">
        <h2 className="font-medium">Cible</h2>
        <TargetLines session={session} />
      </section>

      <WeatherLine session={session} />
      <SessionFuel session={session} />

      {session.discipline === "strength" && completions.length === 0 && (
        <button
          onClick={() => void engine.mutateMany(planMark(session, { kind: "done" }, { manualCompletion: null, newId: uuidv7(), at: nowIso() }))}
          className="h-12 rounded-md bg-foreground font-medium text-background"
        >
          Commencer : saisir les séries
        </button>
      )}

      {structure?.success && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">Structure</h2>
          <ol className="list-decimal pl-5">
            {flattenSteps(structure.data.steps).map((s, i) => (
              <li key={i}>
                {STEP_LABELS[s.kind]} · {s.duration_s ? formatDuration(s.duration_s) : s.distance_m ? `${s.distance_m} m` : "libre"}
                {(() => {
                  const t = s.intensity ? resolveStep(session, s.intensity, targetCtx) : null;
                  return t ? ` · ${targetLabel(t)}` : "";
                })()}
                {s.note ? ` · ${s.note}` : ""}
              </li>
            ))}
          </ol>
        </section>
      )}

      {completions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Réalisé</h2>
          {completions.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              {c.match_status === "suggested" ? (
                <MatchPrompt completion={c} planned={session} />
              ) : (
                <RealizedAnalysis planned={session} completion={c} />
              )}
              {c.discipline === "strength" && <StrengthLog completion={c} sessionType={session.session_type} />}
              {(c.discipline === "run" || c.discipline === "bike") && <EquipmentPicker completion={c} />}
              <Feedback
                key={c.id}
                rpe={c.rpe}
                feeling={c.feeling}
                onChange={(rpe, feeling) => void engine.mutateMany([planFeedback(c.id, rpe, feeling)])}
              />
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`/replanifier?kind=move&session=${session.id}`} className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700">
          Je dois la déplacer
        </Link>
        <Link href={`/replanifier?kind=short_time&session=${session.id}`} className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700">
          J&apos;ai moins de temps
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Modifier</h2>
        <SessionForm key={session._rev ?? session.id} initial={valuesOf(session)} submitLabel="Enregistrer" showStatus onSubmit={save} />
      </section>

      <button onClick={() => void remove()} className="self-start text-sm text-red-600 underline">
        Supprimer la séance
      </button>
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  warmup: "Échauffement",
  work: "Effort",
  recovery: "Récupération",
  cooldown: "Retour au calme",
  rest: "Repos",
};
