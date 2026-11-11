"use client";

import { planConfirm, planReject } from "@/domain/matching";
import { volumeDelta, type IntensityAnalysis } from "@/domain/intensity";
import { BASES, DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { formatClock, formatDelta, formatDistance, formatDuration, formatRange } from "@/lib/format";
import type { CompletedSession, PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { manualCompletionOf, useCompletionsOf } from "@/lib/sync/queries";
import { storedSessionAnalysis, useSessionAnalysis } from "@/lib/sync/streams";
import { StreamFindings } from "./stream-findings";
import { nowIso } from "@/lib/time";

const label = <T extends Record<string, string>>(map: T, key: string) => map[key as keyof T] ?? key;

export function activitySummary(c: CompletedSession): string {
  const parts = [formatDuration(c.moving_s ?? c.elapsed_s)];
  if (c.distance_m) parts.push(formatDistance(Number(c.distance_m), c.discipline));
  if (c.avg_hr) parts.push(`FC moy. ${c.avg_hr} bpm`);
  if (c.discipline === "run" && c.avg_speed_mps && Number(c.avg_speed_mps) > 0) parts.push(`${formatClock(1000 / Number(c.avg_speed_mps))} /km`);
  if (c.avg_power) parts.push(`${Math.round(Number(c.avg_power))} W`);
  return parts.join(" · ");
}

/** Confirmer ou refuser le rattachement proposé par l'import. */
export function MatchPrompt({ completion, planned }: { completion: CompletedSession; planned: PlannedSession }) {
  const engine = useSync();
  const completions = useCompletionsOf(planned.id);
  const manual = manualCompletionOf(completions?.filter((c) => c.id !== completion.id));
  return (
    <div className="rounded-md border border-sky-400 bg-sky-50 p-3 text-sm dark:bg-sky-950">
      <p>
        Strava : <strong>{completion.name ?? "activité"}</strong> · {activitySummary(completion)}
      </p>
      <p className="mt-1">Est-ce cette séance ?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => void engine.mutateMany(planConfirm(completion, planned, manual, nowIso()))}
          className="h-11 rounded-md bg-foreground font-medium text-background"
        >
          Oui, rattacher
        </button>
        <button
          onClick={() => void engine.mutateMany([planReject(completion)])}
          className="h-11 rounded-md border border-neutral-300 dark:border-neutral-700"
        >
          Non
        </button>
      </div>
    </div>
  );
}

/** Activité importée sans séance prévue : la rattacher à la main à une séance du même jour. */
export function AttachPicker({ completion, candidates }: { completion: CompletedSession; candidates: PlannedSession[] }) {
  const engine = useSync();
  if (!candidates.length) return null;
  return (
    <select
      aria-label="Rattacher à une séance prévue"
      defaultValue=""
      onChange={(e) => {
        const p = candidates.find((c) => c.id === e.target.value);
        if (p) void engine.mutateMany(planConfirm(completion, p, null, nowIso()));
      }}
      className="mt-2 h-10 w-full rounded-md border border-neutral-300 bg-transparent px-2 text-sm dark:border-neutral-700"
    >
      <option value="" disabled>Rattacher à une séance prévue…</option>
      {candidates.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title || label(SESSION_TYPES, p.session_type)} · {label(DISCIPLINES, p.discipline)} · {formatDuration(p.target_duration_s)}
        </option>
      ))}
    </select>
  );
}

/**
 * Verdict d'intensité. Trop intense et pas assez intense sont tous deux des écarts, en rouge,
 * distingués par la flèche et le texte ; le respect de la consigne reste neutre.
 */
export function IntensityVerdict({ analysis, compact = false }: { analysis: IntensityAnalysis; compact?: boolean }) {
  const off = analysis.verdict !== "ok";
  const unit = BASES[analysis.basis];
  const ceiling =
    analysis.basis === "pace"
      ? `${formatClock(analysis.target.min ?? 0)} /km`
      : `${analysis.target.max} ${analysis.basis === "hr" ? "bpm" : "W"}${analysis.target.max_end ? ` (${analysis.target.max_end} en fin de sortie)` : ""}`;
  const text =
    analysis.verdict === "too_hard"
      ? `↑ Trop intense : ${analysis.above_pct} % du temps au-delà de ${ceiling}`
      : analysis.verdict === "too_easy"
        ? `↓ Pas assez intense : ${analysis.below_pct} % du temps sous la cible`
        : `Dans la consigne : ${analysis.above_pct} % au-dessus, ${analysis.below_pct} % en dessous`;
  if (compact) {
    return <span className={off ? "font-semibold text-red-600 dark:text-red-400" : "text-neutral-500"}>{off ? (analysis.verdict === "too_hard" ? "↑" : "↓") : "="}</span>;
  }
  const mean = analysis.mean == null ? "" : analysis.basis === "pace" ? `${formatClock(analysis.mean)} /km` : `${Math.round(analysis.mean)} ${analysis.basis === "hr" ? "bpm" : "W"}`;
  return (
    <div className={`rounded-md p-2 text-sm ${off ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-neutral-100 dark:bg-neutral-900"}`}>
      <p className="font-medium">{text}</p>
      <p className="text-xs opacity-80">
        Jugé sur : {unit} · cible {formatRange(analysis.basis, analysis.target.min, analysis.target.max)}{analysis.target.max_end ? `, ${analysis.target.max_end} bpm à partir de ${analysis.target.end_from_pct ?? 67} % de la séance` : ""} · moyenne {mean} ·{" "}
        {formatDuration(analysis.analysed_s)} analysées
        {analysis.basis === "hr" ? " (3 premières minutes écartées)" : ""}
        {analysis.basis === "pace" ? " · sans correction de pente ni de chaleur" : ""}
      </p>
    </div>
  );
}

/** Détail d'un réalisé importé sur la fiche séance : volume, intensité, fiabilité de la FC. */
export function RealizedAnalysis({ planned, completion }: { planned: PlannedSession; completion: CompletedSession }) {
  const engine = useSync();
  const live = useSessionAnalysis(planned, completion);
  const full = live?.analysis ?? storedSessionAnalysis(completion);
  const analysis = full?.intensity ?? null;
  const vol = volumeDelta(planned.target_duration_s, completion.moving_s ?? completion.elapsed_s);

  return (
    <div className="flex flex-col gap-2">
      {completion.source === "strava" && (
        <p className="text-sm">
          Strava : <strong>{completion.name}</strong> · {activitySummary(completion)}
        </p>
      )}
      {vol != null && (
        <p className="text-sm">
          Volume : {formatDuration(completion.moving_s ?? completion.elapsed_s)} sur {formatDuration(planned.target_duration_s)} prévues{" "}
          <span className={Math.abs(vol) > 0.15 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-neutral-500"}>({formatDelta(vol)})</span>
        </p>
      )}
      {analysis ? (
        <IntensityVerdict analysis={analysis} />
      ) : live?.reason ? (
        <p className="text-xs text-neutral-500">Intensité non analysée : {live.reason}.</p>
      ) : full ? (
        <p className="text-xs text-neutral-500">Intensité non jugée : aucune cible exploitable (zones ou repères manquants).</p>
      ) : null}
      {full && <StreamFindings analysis={full} discipline={completion.discipline} />}
      {completion.strava_activity_id && completion.avg_hr != null && (
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            checked={completion.hr_reliable === false}
            onChange={(e) => void engine.mutate("completed_sessions", completion.id, { hr_reliable: e.target.checked ? false : null })}
            className="h-4 w-4"
          />
          FC aberrante (capteur qui décroche) : juger sur l&apos;allure et le RPE
        </label>
      )}
    </div>
  );
}
