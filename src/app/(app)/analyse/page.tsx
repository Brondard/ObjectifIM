"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AcwrChart, ChartBlock, LoadChart, VolumeChart, ZonesChart } from "@/components/charts";
import { adherenceByWeek, skipReasons, weeksBack } from "@/domain/analysis/adherence";
import { acwrSeries, dailyLoads, foster, type LoadParams } from "@/domain/analysis/load";
import { rigor } from "@/domain/analysis/rigor";
import { chainSignals, niggleSignals, type Signal } from "@/domain/analysis/signals";
import { DISCIPLINES } from "@/domain/labels";
import { formatDuration } from "@/lib/format";
import type { CompletedSession, PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useTargetContext } from "@/lib/sync/queries";
import { BATCH_LIMIT, prepareAnalyses, storedSessionAnalysis } from "@/lib/sync/streams";
import { addDays, formatLocalDate, today, type LocalDate } from "@/lib/time";

const WEEKS = 8;
const RIGOR_WEEKS = 4;
const short = (d: string) => formatLocalDate(d as LocalDate, { day: "numeric", month: "short" });

export default function AnalysisPage() {
  const engine = useSync();
  const { db } = engine;
  const now = today();
  const weeks = useMemo(() => weeksBack(now, WEEKS), [now]);
  const from = weeks[0];
  const ctx = useTargetContext();
  const [progress, setProgress] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [planned, completed, rules, niggles, entries] = await Promise.all([
      db.planned_sessions.where("date").between(from, addDays(now, 7), true, true).toArray(),
      db.completed_sessions.where("local_date").between(addDays(from as LocalDate, -28), addDays(now, 7), true, true).toArray(),
      db.engine_rules.toArray(),
      db.niggles.toArray(),
      db.niggle_entries.toArray(),
    ]);
    return {
      planned: planned.filter((p) => !p.deleted_at),
      completed: completed.filter((c) => !c.deleted_at),
      rules: rules.filter((r) => !r.deleted_at),
      niggles,
      entries,
    };
  }, [db, from, now]);

  if (!data || !ctx) return null;
  const plannedById = new Map(data.planned.map((p) => [p.id, p]));
  const typeOf = (c: CompletedSession) => (c.planned_session_id ? plannedById.get(c.planned_session_id)?.session_type ?? null : null);
  const rule = (key: string) => (data.rules.find((r) => r.rule_key === key)?.params ?? {}) as Record<string, unknown>;
  const loadParams: LoadParams = {
    defaultRpe: Number(rule("planned_rpe_by_type").default_done_rpe ?? 4),
    rpeByType: (rule("planned_rpe_by_type").by_type ?? {}) as Record<string, number>,
  };
  const low = Number(rule("load_ratio").low ?? 0.8);
  const high = Number(rule("load_ratio").high ?? 1.5);

  // ─── Rigueur ─────────────────────────────────────────────────────────────
  const rigorFrom = weeks[WEEKS - RIGOR_WEEKS];
  const recent = data.completed.filter((c) => c.local_date >= rigorFrom && c.local_date <= now);
  const r = rigor(recent.map((c) => ({ local_date: c.local_date, discipline: c.discipline, planned_type: typeOf(c), analysis: storedSessionAnalysis(c) })), RIGOR_WEEKS);
  const missing = recent.filter((c) => c.strava_activity_id && (c.discipline === "run" || c.discipline === "bike") && !storedSessionAnalysis(c));

  async function prepare() {
    if (!ctx) return;
    const items = missing.map((c) => ({ completion: c, planned: c.planned_session_id ? (plannedById.get(c.planned_session_id) as PlannedSession) ?? null : null }));
    const res = await prepareAnalyses(engine, items, ctx, (d, t) => setProgress(`Analyse des flux : ${d}/${t}`));
    setProgress(
      res.stoppedOn
        ? `${res.analysed} séance(s) analysée(s), arrêt : ${res.stoppedOn}. Relance plus tard, rien n'est perdu.`
        : `${res.analysed} séance(s) analysée(s).`,
    );
  }

  // ─── Assiduité et volume ─────────────────────────────────────────────────
  const adherence = adherenceByWeek(data.planned, data.completed, weeks, now);
  const reasons = skipReasons(adherence.slice(-RIGOR_WEEKS));
  const byDiscipline = (Object.keys(DISCIPLINES) as (keyof typeof DISCIPLINES)[])
    .map((d) => ({ d, rows: adherenceByWeek(data.planned, data.completed, weeks.slice(-RIGOR_WEEKS), now, d) }))
    .filter((x) => x.rows.some((w) => w.planned > 0));

  // ─── Intensité : temps par zone de FC en course ──────────────────────────
  const zoneCount = Math.max(5, ...recent.map((c) => storedSessionAnalysis(c)?.zones?.seconds.length ?? 0));
  const zonesData = weeks.map((w) => {
    const row: Record<string, number | string> = { label: short(w) };
    for (let k = 0; k < zoneCount; k++) row[`z${k + 1}`] = 0;
    for (const c of data.completed.filter((x) => x.discipline === "run" && x.local_date >= w && x.local_date <= addDays(w as LocalDate, 6))) {
      const z = storedSessionAnalysis(c)?.zones;
      if (z?.basis === "hr") z.seconds.forEach((s, k) => (row[`z${k + 1}`] = Number(row[`z${k + 1}`]) + s / 3600));
    }
    return row;
  });
  const judged = recent
    .filter((c) => storedSessionAnalysis(c)?.intensity && c.planned_session_id)
    .sort((a, b) => b.local_date.localeCompare(a.local_date));

  // ─── Charge ──────────────────────────────────────────────────────────────
  const days = dailyLoads(data.completed.map((c) => ({ ...c, session_type: typeOf(c) })), addDays(from as LocalDate, -28), now, loadParams);
  const acwr = acwrSeries(days).filter((d) => d.date >= from).map((d) => ({ label: short(d.date), acwr: d.acwr }));
  const weekly = weeks.map((w) => {
    const wd = days.filter((d) => d.date >= w && d.date <= addDays(w as LocalDate, 6));
    return { label: short(w), ...foster(wd), estimated: Math.round(wd.reduce((a, d) => a + d.estimated, 0)) };
  });
  const currentAcwr = [...acwr].reverse().find((d) => d.acwr != null)?.acwr ?? null;

  // ─── Signaux ─────────────────────────────────────────────────────────────
  const around = [
    ...data.completed
      .filter((c) => c.local_date >= addDays(now, -7) && c.local_date <= now && c.planned_session_id)
      .map((c) => plannedById.get(c.planned_session_id!))
      .filter((p): p is PlannedSession => !!p)
      .map((p) => ({ ...p, done: true })),
    ...data.planned.filter((p) => p.date >= now && p.status === "planned").map((p) => ({ ...p, done: false })),
  ];
  const signals: Signal[] = [
    ...(currentAcwr != null && (currentAcwr > high || currentAcwr < low)
      ? [{ key: "acwr", level: "serious" as const, message: `Ratio de charge aiguë / chronique à ${currentAcwr} (zone de confort ${low}–${high}).` }]
      : []),
    ...weekly.slice(-2).filter((w) => w.monotony != null && w.monotony > 2).map((w) => ({ key: `mono:${w.label}`, level: "warning" as const, message: `Semaine du ${w.label} trop uniforme : monotonie ${w.monotony} (au-delà de 2).` })),
    ...chainSignals(around),
    ...niggleSignals(data.niggles, data.entries, now),
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Analyse</h1>
        <Link href="/genes" className="text-sm underline">Gênes et douleurs</Link>
      </header>

      {/* La question du cahier des charges, en premier. */}
      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium">Est-ce que je cours trop vite ?</h2>
        <p className="text-lg leading-snug">{r.sentence}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat value={r.easyTooHardPct == null ? "—" : `${r.easyTooHardPct} %`} label="footings faciles trop intenses" alert={(r.easyTooHardPct ?? 0) > 20} />
          <Stat value={r.meanAboveCeilingPct == null ? "—" : `${r.meanAboveCeilingPct} %`} label="du temps au-dessus du plafond, en moyenne" alert={(r.meanAboveCeilingPct ?? 0) > 15} />
          <Stat value={r.aboveZ2Pct == null ? "—" : `${r.aboveZ2Pct} %`} label="du temps de course au-dessus de Z2" />
        </div>
        <p className="text-xs text-neutral-500">
          Jugé à la FC, 3 premières minutes écartées, alerte au-delà de 15 % du temps au-dessus du plafond de zone. {r.easyAnalysed} footing(s) prévu(s)
          analysé(s), {formatDuration(r.runSeconds)} de course répartie par zone sur {RIGOR_WEEKS} semaines.
        </p>
        {missing.length > 0 && (
          <button onClick={() => void prepare()} disabled={!!progress?.startsWith("Analyse")} className="self-start rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700">
            Analyser {Math.min(missing.length, BATCH_LIMIT)} séance(s) sans analyse{missing.length > BATCH_LIMIT ? ` (sur ${missing.length})` : ""}
          </button>
        )}
        {progress && <p className="text-sm text-neutral-600 dark:text-neutral-400">{progress}</p>}
      </section>

      {signals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Signaux</h2>
          {signals.map((s) => (
            <p key={s.key} className={`rounded-md p-2 text-sm ${s.level === "serious" ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
              {s.level === "serious" ? "⚠ " : "△ "}{s.message}
            </p>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Respect de l&apos;intensité</h2>
        <ChartBlock
          title="Course : temps par zone de FC, par semaine"
          table={<SimpleTable head={["Semaine", ...Array.from({ length: zoneCount }, (_, k) => `Z${k + 1}`)]} rows={zonesData.map((d) => [String(d.label), ...Array.from({ length: zoneCount }, (_, k) => `${Math.round(Number(d[`z${k + 1}`]) * 10) / 10} h`)])} />}
        >
          <ZonesChart data={zonesData} zones={zoneCount} />
        </ChartBlock>
        {judged.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {judged.slice(0, 12).map((c) => {
              const a = storedSessionAnalysis(c)!.intensity!;
              const off = a.verdict !== "ok";
              return (
                <li key={c.id} className="flex justify-between gap-2 border-t border-neutral-200 py-1 dark:border-neutral-800">
                  <Link href={`/seance/${c.planned_session_id}`} className="truncate underline-offset-2 hover:underline">
                    {short(c.local_date)} · {plannedById.get(c.planned_session_id!)?.title ?? c.name}
                  </Link>
                  <span className={`shrink-0 tabular-nums ${off ? "font-semibold text-red-700 dark:text-red-400" : "text-neutral-500"}`}>
                    {a.verdict === "too_hard" ? `↑ ${a.above_pct} % au-dessus` : a.verdict === "too_easy" ? `↓ ${a.below_pct} % en dessous` : "dans la consigne"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Assiduité</h2>
        <SimpleTable
          head={["Semaine", "Faites", "Taux", "Manquées : choix / vie / blessure"]}
          rows={adherence.map((w) => [
            short(w.week),
            `${w.done + w.partial}/${w.planned - w.open}${w.partial ? ` (${w.partial} partielle${w.partial > 1 ? "s" : ""})` : ""}`,
            w.rate == null ? "—" : `${Math.round(w.rate * 100)} %`,
            `${w.skipped.choice} / ${w.skipped.life} / ${w.skipped.injury}`,
          ])}
        />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {RIGOR_WEEKS} dernières semaines : {reasons.choice} manquée(s) par choix, {reasons.life} par la vie, {reasons.injury} par blessure.
        </p>
        {byDiscipline.length > 0 && (
          <SimpleTable
            head={["Discipline", ...weeks.slice(-RIGOR_WEEKS).map(short)]}
            rows={byDiscipline.map(({ d, rows }) => [DISCIPLINES[d], ...rows.map((w) => (w.rate == null ? "—" : `${Math.round(w.rate * 100)} %`))])}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Respect du volume</h2>
        <ChartBlock
          title="Durée prévue et réalisée par semaine"
          table={<SimpleTable head={["Semaine", "Prévu", "Réalisé"]} rows={adherence.map((w) => [short(w.week), formatDuration(w.planned_s), formatDuration(w.done_s)])} />}
        >
          <VolumeChart data={adherence.map((w) => ({ label: short(w.week), planned: w.planned_s / 3600, done: w.done_s / 3600 }))} />
        </ChartBlock>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Charge et risque</h2>
        <ChartBlock
          title="Charge hebdomadaire (RPE × minutes)"
          table={<SimpleTable head={["Semaine", "Charge", "dont RPE estimé", "Monotonie", "Contrainte"]} rows={weekly.map((w) => [w.label, String(w.load), String(w.estimated), w.monotony == null ? "—" : String(w.monotony), w.strain == null ? "—" : String(w.strain)])} />}
        >
          <LoadChart data={weekly} />
        </ChartBlock>
        <ChartBlock
          title={`Ratio aigu / chronique (7 j / 28 j) : ${currentAcwr ?? "—"} aujourd'hui, zone de confort ${low}–${high}`}
          table={<SimpleTable head={["Jour", "Ratio"]} rows={acwr.filter((_, i) => i % 7 === 6).map((d) => [d.label, d.acwr == null ? "—" : String(d.acwr)])} />}
        >
          <AcwrChart data={acwr} low={low} high={high} />
        </ChartBlock>
        <p className="text-xs text-neutral-500">
          Sans RPE saisi, la charge utilise un RPE estimé (type de la séance prévue, sinon {loadParams.defaultRpe}) : la part estimée est indiquée dans le tableau.
        </p>
      </section>
    </div>
  );
}

function Stat({ value, label, alert = false }: { value: string; label: string; alert?: boolean }) {
  return (
    <div className="rounded-md bg-neutral-100 p-2 dark:bg-neutral-900">
      <p className={`text-xl font-semibold tabular-nums ${alert ? "text-red-700 dark:text-red-400" : ""}`}>{value}</p>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">{label}</p>
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-neutral-500">
          <tr>{head.map((h) => <th key={h} className="py-1 pr-2 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
              {r.map((c, j) => <td key={j} className="py-1 pr-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
