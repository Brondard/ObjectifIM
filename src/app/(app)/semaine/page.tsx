"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { v7 as uuidv7 } from "uuid";
import { disciplineStyle } from "@/components/discipline";
import { IntensityVerdict } from "@/components/realized";
import { ZoneTag } from "@/components/targets";
import { storedAnalysis } from "@/lib/sync/streams";
import { DISCIPLINES, SESSION_TYPES, type Discipline } from "@/domain/labels";
import { moveChange, planDuplicate, planMove } from "@/domain/planning";
import { deltaRatio, dueBy, isDone, isSkipped, volumes, type Volume } from "@/domain/week";
import { formatDelta, formatDistance, formatDuration } from "@/lib/format";
import type { CompletedSession, PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useCompletedBetween, usePlannedBetween } from "@/lib/sync/queries";
import { addDays, formatLocalDate, isLocalDate, today, weekDays, type LocalDate } from "@/lib/time";

export default function WeekPage() {
  return (
    <Suspense>
      <Week />
    </Suspense>
  );
}

function Week() {
  const params = useSearchParams();
  const router = useRouter();
  const engine = useSync();
  const now = today();
  const requested = params.get("d");
  const days = weekDays(requested && isLocalDate(requested) ? requested : now);
  const [from, to] = [days[0], days[6]];
  const planned = usePlannedBetween(from, to);
  const completed = useCompletedBetween(from, to);
  const nextWeek = usePlannedBetween(addDays(from, 7), addDays(to, 7));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Appui long sur mobile : le défilement reste possible.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const session = planned?.find((s) => s.id === e.active.id);
    const target = e.over?.id as LocalDate | undefined;
    if (!session || !target || target === session.date) return;
    await engine.mutateMany([
      { table: "planned_sessions", id: session.id, fields: planMove(session, target) },
      { table: "plan_changes", id: uuidv7(), fields: moveChange(session, target) },
    ]);
  }

  async function duplicate() {
    if (!planned?.length) return;
    const existing = nextWeek?.length ?? 0;
    const msg = existing
      ? `La semaine suivante contient déjà ${existing} séance(s). Ajouter quand même les ${planned.length} séances de cette semaine ?`
      : `Copier les ${planned.length} séances sur la semaine suivante ?`;
    if (!window.confirm(msg)) return;
    const copies = planDuplicate(planned, 7, uuidv7);
    await engine.mutateMany([
      ...copies.map((c) => ({ table: "planned_sessions" as const, id: c.id, fields: c.fields })),
      {
        table: "plan_changes",
        id: uuidv7(),
        fields: {
          trigger: "bulk_edit",
          reason: "Duplication de semaine",
          input: { from, offset_days: 7 },
          chosen_option: "duplicate_week",
          affected: copies.map((c) => ({ id: c.id, after: { date: c.fields.date } })),
        },
      },
    ]);
    router.push(`/semaine?d=${addDays(from, 7)}`);
  }

  const go = (d: LocalDate) => router.push(`/semaine?d=${d}`);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        <button onClick={() => go(addDays(from, -7))} aria-label="Semaine précédente" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">
          ‹
        </button>
        <div className="text-center">
          <h1 className="font-semibold">
            {formatLocalDate(from, { day: "numeric", month: "short" })} – {formatLocalDate(to, { day: "numeric", month: "short", year: "numeric" })}
          </h1>
          {(now < from || now > to) && (
            <button onClick={() => go(now)} className="text-xs text-neutral-500 underline">Revenir à cette semaine</button>
          )}
        </div>
        <button onClick={() => go(addDays(from, 7))} aria-label="Semaine suivante" className="h-10 w-10 rounded-md border border-neutral-300 dark:border-neutral-700">
          ›
        </button>
      </header>

      {planned && completed && <VolumeSummary planned={planned} completed={completed} asOf={now} />}

      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-7 lg:gap-1">
          {days.map((d) => (
            <Day
              key={d}
              date={d}
              isToday={d === now}
              planned={planned?.filter((s) => s.date === d) ?? []}
              unplanned={completed?.filter((c) => c.local_date === d && !c.planned_session_id) ?? []}
              linked={completed?.filter((c) => c.planned_session_id) ?? []}
            />
          ))}
        </div>
      </DndContext>

      <p className="text-xs text-neutral-500">Appui long (ou glisser à la souris) sur une séance pour la déplacer.</p>

      {!!planned?.length && (
        <button onClick={() => void duplicate()} className="self-start text-sm underline">
          Dupliquer vers la semaine suivante
        </button>
      )}
    </div>
  );
}

function Day({
  date,
  isToday,
  planned,
  unplanned,
  linked,
}: {
  date: LocalDate;
  isToday: boolean;
  planned: PlannedSession[];
  unplanned: CompletedSession[];
  linked: CompletedSession[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-16 flex-col gap-1.5 rounded-lg border p-2 ${
        isOver ? "border-foreground" : isToday ? "border-neutral-400 dark:border-neutral-500" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className={`text-sm first-letter:uppercase ${isToday ? "font-semibold" : ""}`}>
          {formatLocalDate(date, { weekday: "short", day: "numeric" })}
        </h2>
        <Link href={`/seance/nouvelle?date=${date}`} aria-label="Ajouter une séance" className="px-2 text-lg leading-none text-neutral-500">
          +
        </Link>
      </div>
      {planned.map((s) => (
        <SessionChip key={s.id} session={s} completions={linked.filter((c) => c.planned_session_id === s.id)} />
      ))}
      {unplanned.map((c) => (
        <div key={c.id} className={`rounded border border-l-4 border-dashed border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 ${disciplineStyle(c.discipline).bar}`}>
          {c.source === "strava" ? c.name : "Imprévue"} · {disciplineStyle(c.discipline).short} · {formatDuration(c.moving_s ?? c.elapsed_s)}
        </div>
      ))}
    </section>
  );
}

function SessionChip({ session, completions }: { session: PlannedSession; completions: CompletedSession[] }) {
  const suggested = completions.some((c) => c.match_status === "suggested");
  const analysis = storedAnalysis(completions.find((c) => c.match_status === "confirmed" && c.source !== "manual") ?? null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: session.id });
  const style = disciplineStyle(session.discipline);
  const done = isDone(session.status);
  const skipped = isSkipped(session.status);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`touch-manipulation select-none rounded border border-l-4 border-neutral-200 bg-background px-2 py-1.5 text-xs dark:border-neutral-800 ${style.bar} ${
        isDragging ? "relative z-10 shadow-lg" : ""
      } ${skipped ? "opacity-50" : ""}`}
    >
      <Link href={`/seance/${session.id}`} className="flex items-center justify-between gap-1">
        <span className={`truncate ${skipped ? "line-through" : ""}`}>
          {session.priority === "key" && <strong>● </strong>}
          {session.title || `${style.short} ${SESSION_TYPES[session.session_type as keyof typeof SESSION_TYPES] ?? ""}`}
        </span>
        <span className="shrink-0 tabular-nums">
          {suggested && <span className="text-sky-600" title="Activité Strava à confirmer">? </span>}
          {analysis && <><IntensityVerdict analysis={analysis} compact /> </>}
          {done ? (session.status === "partial" ? "◐" : "✓") : <><ZoneTag session={session} /> {formatDuration(session.target_duration_s)}</>}
        </span>
      </Link>
    </div>
  );
}

/** Les écarts d'abord : réalisé contre prévu à date, puis les totaux de la semaine. */
function VolumeSummary({ planned, completed, asOf }: { planned: PlannedSession[]; completed: CompletedSession[]; asOf: LocalDate }) {
  const week = volumes(planned, completed);
  const toDate = volumes(
    planned.filter((s) => dueBy(s, asOf)),
    completed.filter((c) => c.local_date <= asOf),
  );
  const disciplines = (Object.keys(DISCIPLINES) as Discipline[]).filter((d) => week.byDiscipline[d]);
  if (!disciplines.length) return <p className="text-sm text-neutral-500">Semaine vide.</p>;

  return (
    <section className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="py-1 font-normal">Discipline</th>
            <th className="py-1 text-right font-normal">Écart à date</th>
            <th className="py-1 text-right font-normal">Fait / prévu</th>
            <th className="py-1 text-right font-normal">Séances</th>
          </tr>
        </thead>
        <tbody>
          {disciplines.map((d) => (
            <Row key={d} label={DISCIPLINES[d]} dot={disciplineStyle(d).dot} week={week.byDiscipline[d]!} toDate={toDate.byDiscipline[d]} discipline={d} />
          ))}
          <Row label="Total" week={week.total} toDate={toDate.total} />
        </tbody>
      </table>
    </section>
  );
}

function Row({ label, dot, week, toDate, discipline }: { label: string; dot?: string; week: Volume; toDate?: Volume; discipline?: string }) {
  const delta = toDate ? deltaRatio(toDate.done_s, toDate.planned_s) : null;
  const off = delta !== null && Math.abs(delta) > 0.15;
  return (
    <tr className={`border-t border-neutral-200 dark:border-neutral-800 ${dot ? "" : "font-medium"}`}>
      <td className="py-1.5">
        <span className="flex items-center gap-2">
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
          {label}
        </span>
      </td>
      <td className={`py-1.5 text-right tabular-nums ${off ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
        {formatDelta(delta) || "—"}
      </td>
      <td className="py-1.5 text-right tabular-nums">
        {formatDuration(week.done_s)} / {formatDuration(week.planned_s)}
        {discipline && week.planned_m > 0 && (
          <span className="block text-xs text-neutral-500">
            {formatDistance(week.done_m, discipline) || "0"} / {formatDistance(week.planned_m, discipline)}
          </span>
        )}
      </td>
      <td className="py-1.5 text-right tabular-nums">
        {week.done_count}/{week.planned_count}
        {week.skipped_count > 0 && <span className="block text-xs text-neutral-500">{week.skipped_count} manquée(s)</span>}
      </td>
    </tr>
  );
}
