/**
 * Export d'une période, destiné à qui construit le bloc suivant (coach, ou soi-même) : assiduité,
 * volume, écarts d'intensité, charge, gênes, ressentis et notes du jour. Faits, sans interprétation.
 */
import { addDays, weekStart, type LocalDate } from "@/lib/time";
import { adherenceByWeek, skipReasons } from "../analysis/adherence";
import { acwrSeries, dailyLoads, foster, type LoadParams } from "../analysis/load";
import { rigor, type SessionAnalysis } from "../analysis/rigor";
import { niggleSignals, type NiggleEntryLike, type NiggleLike } from "../analysis/signals";
import { completedDuration, type CompletedLike, type PlannedLike } from "../week";

export type ExportPlanned = PlannedLike & { session_type: string; priority: string; title: string | null; skip_note: string | null };
export type ExportCompleted = CompletedLike & { rpe: number | null; feeling: string | null; analysis: unknown; name: string | null };

export function buildExport(input: {
  from: string;
  to: string;
  generatedAt: string;
  planned: ExportPlanned[];
  completed: ExportCompleted[];
  /** Réalisé élargi aux 28 jours précédents, pour le ratio de charge. */
  completedForLoad: ExportCompleted[];
  niggles: NiggleLike[];
  niggleEntries: NiggleEntryLike[];
  notes: { date: string; note: string | null }[];
  loadParams: LoadParams;
  /** Dates des courses : une course dans la fenêtre rend le ratio de charge non significatif. */
  raceDates?: string[];
}) {
  const { from, to } = input;
  const weeks: string[] = [];
  for (let w: string = weekStart(from as LocalDate); w <= to; w = addDays(w as LocalDate, 7)) weeks.push(w);
  const plannedById = new Map(input.planned.map((p) => [p.id, p]));
  const typeOf = (c: ExportCompleted) => (c.planned_session_id ? plannedById.get(c.planned_session_id)?.session_type ?? null : null);
  const analysisOf = (c: ExportCompleted) => ((c.analysis as SessionAnalysis | null)?.version === 3 ? (c.analysis as SessionAnalysis) : null);

  const adherence = adherenceByWeek(input.planned, input.completed, weeks, addDays(to as LocalDate, 1));
  const disciplines = [...new Set(input.planned.map((p) => p.discipline))];
  const days = dailyLoads(input.completedForLoad.map((c) => ({ ...c, session_type: typeOf(c) })), addDays(from as LocalDate, -28), to, input.loadParams);
  const acwr = acwrSeries(days, input.raceDates ?? []);
  const r = rigor(input.completed.map((c) => ({ local_date: c.local_date, discipline: c.discipline, planned_type: typeOf(c), analysis: analysisOf(c) })), weeks.length);

  return {
    format: "objectifim-export",
    format_version: "1",
    period: { start: from, end: to },
    generated_at: input.generatedAt,
    adherence: {
      weeks: adherence.map((w) => ({ week: w.week, planned: w.planned, done: w.done, partial: w.partial, skipped: w.skipped, rate: w.rate })),
      by_discipline: Object.fromEntries(disciplines.map((d) => {
        const rows = adherenceByWeek(input.planned, input.completed, weeks, addDays(to as LocalDate, 1), d);
        const due = rows.reduce((a, w) => a + w.planned - w.open, 0);
        const done = rows.reduce((a, w) => a + w.done + w.partial, 0);
        return [d, { planned: rows.reduce((a, w) => a + w.planned, 0), done, rate: due ? Math.round((done / due) * 100) / 100 : null }];
      })),
      skip_reasons: skipReasons(adherence),
    },
    volume: {
      planned_min: Math.round(adherence.reduce((a, w) => a + w.planned_s, 0) / 60),
      done_min: Math.round(adherence.reduce((a, w) => a + w.done_s, 0) / 60),
      weeks: adherence.map((w) => ({ week: w.week, planned_min: Math.round(w.planned_s / 60), done_min: Math.round(w.done_s / 60) })),
    },
    intensity: {
      summary: r.sentence,
      easy_runs_analysed: r.easyAnalysed,
      easy_runs_too_hard_pct: r.easyTooHardPct,
      mean_time_above_ceiling_pct: r.meanAboveCeilingPct,
      unplanned_run_time_above_ceiling_pct: r.unplannedAbovePct,
      sessions: input.completed
        .filter((c) => c.planned_session_id && analysisOf(c)?.intensity)
        .map((c) => {
          const p = plannedById.get(c.planned_session_id!);
          const a = analysisOf(c)!;
          return {
            date: c.local_date, title: p?.title ?? c.name, type: p?.session_type, verdict: a.intensity!.verdict,
            above_pct: a.intensity!.above_pct, below_pct: a.intensity!.below_pct, drift_pct: a.drift?.pct ?? null,
          };
        }),
    },
    load: {
      weeks: weeks.map((w) => ({ week: w, ...foster(days.filter((d) => d.date >= w && d.date <= addDays(w as LocalDate, 6))) })),
      acwr_end: acwr.at(-1)?.acwr ?? null,
      acwr_end_unreliable: acwr.at(-1)?.unreliable ?? null,
    },
    sessions: input.planned
      .filter((p) => !p.deleted_at)
      .map((p) => {
        const done = input.completed.filter((c) => c.planned_session_id === p.id);
        return {
          date: p.date, discipline: p.discipline, type: p.session_type, priority: p.priority, title: p.title, status: p.status,
          skip_note: p.skip_note, planned_min: p.target_duration_s ? Math.round(p.target_duration_s / 60) : null,
          done_min: done.length ? Math.round(done.reduce((a, c) => a + completedDuration(c), 0) / 60) : null,
          rpe: done.find((c) => c.rpe != null)?.rpe ?? null, feeling: done.find((c) => c.feeling)?.feeling ?? null,
        };
      }),
    unplanned: input.completed
      .filter((c) => !c.planned_session_id)
      .map((c) => ({ date: c.local_date, discipline: c.discipline, name: c.name, minutes: Math.round(completedDuration(c) / 60), rpe: c.rpe })),
    niggles: {
      signals: niggleSignals(input.niggles, input.niggleEntries, to).map((s) => s.message),
      episodes: input.niggles.filter((n) => !n.deleted_at && n.started_on <= to && (!n.resolved_on || n.resolved_on >= from))
        .map((n) => ({ zone: n.body_zone, side: n.side, from: n.started_on, to: n.resolved_on, intensities: input.niggleEntries.filter((e) => e.niggle_id === n.id).map((e) => e.intensity) })),
    },
    day_notes: input.notes.filter((n) => n.note && n.date >= from && n.date <= to),
  };
}
