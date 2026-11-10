"use client";

import Link from "next/link";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { DISCIPLINES, PRIORITIES, SESSION_TYPES, SKIP_REASONS } from "@/domain/labels";
import { planFeedback, planMark, type Mark, type SkipReason } from "@/domain/marking";
import { isDone, isSkipped } from "@/domain/week";
import { formatDistance, formatDuration } from "@/lib/format";
import type { PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { manualCompletionOf, useCompletionsOf } from "@/lib/sync/queries";
import { nowIso } from "@/lib/time";
import { disciplineStyle } from "./discipline";
import { TargetLines } from "./targets";

const label = <T extends Record<string, string>>(map: T, key: string) => map[key as keyof T] ?? key;

/**
 * Carte d'une séance du jour. Marquer « fait » est un seul geste ;
 * RPE et ressenti sont demandés juste après, sur la même carte.
 */
export function SessionCard({ session }: { session: PlannedSession }) {
  const engine = useSync();
  const completions = useCompletionsOf(session.id);
  const manual = manualCompletionOf(completions);
  const active = completions?.find((c) => !c.deleted_at) ?? null;
  const [panel, setPanel] = useState<"none" | "partial" | "skip">("none");
  const [partialMin, setPartialMin] = useState("");

  async function mark(m: Mark) {
    const writes = planMark(session, m, { manualCompletion: manual, newId: uuidv7(), at: nowIso() });
    await engine.mutateMany(writes);
    setPanel("none");
  }

  const style = disciplineStyle(session.discipline);
  const done = isDone(session.status);
  const skipped = isSkipped(session.status);

  return (
    <article className={`rounded-lg border border-l-4 border-neutral-200 p-4 dark:border-neutral-800 ${style.bar}`}>
      <Link href={`/seance/${session.id}`} className="block">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {session.title || label(SESSION_TYPES, session.session_type)}
          </h2>
          {session.priority === "key" && (
            <span className="rounded bg-foreground px-1.5 py-0.5 text-xs text-background">{PRIORITIES.key}</span>
          )}
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {label(DISCIPLINES, session.discipline)}
          {session.local_time && ` · ${session.local_time.slice(0, 5)}`}
          {` · ${formatDuration(session.target_duration_s)}`}
          {session.target_distance_m ? ` · ${formatDistance(session.target_distance_m, session.discipline)}` : ""}
        </p>
        <div className="mt-2">
          <TargetLines session={session} />
        </div>
        {session.instructions && <p className="mt-2 line-clamp-3 text-sm">{session.instructions}</p>}
      </Link>

      {!done && !skipped && panel === "none" && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={() => void mark({ kind: "done" })} className="h-12 rounded-md bg-foreground font-medium text-background">
            Fait
          </button>
          <button onClick={() => setPanel("partial")} className="h-12 rounded-md border border-neutral-300 dark:border-neutral-700">
            Partiel
          </button>
          <button onClick={() => setPanel("skip")} className="h-12 rounded-md border border-neutral-300 dark:border-neutral-700">
            Manqué
          </button>
        </div>
      )}

      {panel === "partial" && (
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const min = Number(partialMin);
            if (min > 0) void mark({ kind: "partial", duration_s: Math.round(min * 60) });
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Durée réelle (min)
            <input
              autoFocus
              type="number"
              inputMode="numeric"
              min={1}
              value={partialMin}
              onChange={(e) => setPartialMin(e.target.value)}
              className="h-12 rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700"
            />
          </label>
          <button className="h-12 rounded-md bg-foreground px-4 font-medium text-background">OK</button>
          <button type="button" onClick={() => setPanel("none")} className="h-12 px-2 text-sm text-neutral-500">
            Retour
          </button>
        </form>
      )}

      {panel === "skip" && (
        <div className="mt-4">
          <p className="mb-2 text-sm">Pourquoi ?</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SKIP_REASONS) as SkipReason[]).map((reason) => (
              <button
                key={reason}
                onClick={() => void mark({ kind: "skipped", reason })}
                className="h-12 rounded-md border border-neutral-300 dark:border-neutral-700"
              >
                {SKIP_REASONS[reason]}
              </button>
            ))}
          </div>
          <button onClick={() => setPanel("none")} className="mt-2 text-sm text-neutral-500">
            Retour
          </button>
        </div>
      )}

      {done && (
        <div className="mt-4 flex flex-col gap-3">
          <StatusLine
            text={`${session.status === "partial" ? "Partielle" : "Faite"}${active ? ` · ${formatDuration(active.moving_s ?? active.elapsed_s)}` : ""}`}
            onUndo={() => void mark({ kind: "reset" })}
          />
          {active && (
            <Feedback
              key={active.id}
              rpe={active.rpe}
              feeling={active.feeling}
              onChange={(rpe, feeling) => void engine.mutateMany([planFeedback(active.id, rpe, feeling)])}
            />
          )}
        </div>
      )}

      {skipped && (
        <div className="mt-4">
          <StatusLine
            text={`Manquée · ${label(SKIP_REASONS, session.status.replace("skipped_", ""))}${session.skip_note ? ` · ${session.skip_note}` : ""}`}
            onUndo={() => void mark({ kind: "reset" })}
          />
        </div>
      )}
    </article>
  );
}

function StatusLine({ text, onUndo }: { text: string; onUndo: () => void }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{text}</span>
      <button onClick={onUndo} className="text-neutral-500 underline">Annuler</button>
    </div>
  );
}

/** RPE sur 10 et ressenti en une ligne : demandés à chaque séance. */
export function Feedback({
  rpe,
  feeling,
  onChange,
}: {
  rpe: number | null;
  feeling: string | null;
  onChange: (rpe: number | null, feeling: string | null) => void;
}) {
  const [text, setText] = useState(feeling ?? "");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">RPE {rpe ? <strong>{rpe}/10</strong> : <span className="text-neutral-500">(effort perçu)</span>}</p>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => onChange(n === rpe ? null : n, text || null)}
            className={`h-10 rounded text-sm ${n === rpe ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        placeholder="Ressenti en une ligne"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (feeling ?? "") && onChange(rpe, text || null)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-11 rounded-md border border-neutral-300 bg-transparent px-3 dark:border-neutral-700"
      />
    </div>
  );
}
