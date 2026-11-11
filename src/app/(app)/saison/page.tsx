"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { ChartBlock, VolumeChart } from "@/components/charts";
import { Field, inputClass } from "@/components/session-form";
import { PHASE_TYPES } from "@/domain/labels";
import { backwardPhases, weeksUntil, type PhaseDraft } from "@/domain/plan/build";
import { completedDuration } from "@/domain/week";
import { formatDuration } from "@/lib/format";
import type { Phase, Race, Season } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { addDays, diffDays, formatLocalDate, nowIso, today, weekStart, type LocalDate } from "@/lib/time";

const short = (d: string) => formatLocalDate(d as LocalDate, { day: "numeric", month: "short" });
const PHASE_COLOR: Record<string, string> = {
  base: "bg-sky-200 dark:bg-sky-900", build: "bg-sky-400 dark:bg-sky-700", specific: "bg-sky-600 text-white dark:bg-sky-500",
  taper: "bg-emerald-300 dark:bg-emerald-800", recovery: "bg-neutral-200 dark:bg-neutral-800", return: "bg-amber-200 dark:bg-amber-900",
};

/** Vue Saison : frise des phases et des courses, volume hebdomadaire prévu et réalisé. */
export default function SeasonPage() {
  const engine = useSync();
  const { db } = engine;
  const data = useLiveQuery(async () => {
    const [seasons, phases, races] = await Promise.all([db.seasons.toArray(), db.phases.toArray(), db.races.toArray()]);
    return {
      seasons: seasons.filter((s) => !s.deleted_at).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      phases: phases.filter((p) => !p.deleted_at).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      races: races.filter((r) => !r.deleted_at),
    };
  }, [db]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) return null;
  const now = today();
  const season = data.seasons.find((s) => s.id === selected) ?? data.seasons.find((s) => s.start_date <= now && s.end_date >= now) ?? data.seasons.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Saison</h1>
        <nav className="flex gap-3 text-sm underline"><Link href="/mois">Mois</Link><Link href="/plan">Construire le plan</Link></nav>
      </header>
      {data.seasons.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {data.seasons.map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)} className={`rounded-md px-3 py-1.5 text-sm ${s.id === season?.id ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>{s.name}</button>
          ))}
        </div>
      )}
      {season ? (
        <>
          <SeasonTimeline season={season} phases={data.phases.filter((p) => p.season_id === season.id)} races={data.races.filter((r) => r.date >= season.start_date && r.date <= season.end_date)} />
          <SeasonVolume season={season} />
          <PhaseList season={season} phases={data.phases.filter((p) => p.season_id === season.id)} />
        </>
      ) : (
        <p className="text-sm text-neutral-500">Aucune saison. Crée-la à rebours depuis ta course objectif, ou à la main.</p>
      )}
      <Backward races={data.races.filter((r) => r.date > now)} seasons={data.seasons} phases={data.phases} />
      <NewSeason />
    </div>
  );
}

function SeasonTimeline({ season, phases, races }: { season: Season; phases: Phase[]; races: Race[] }) {
  const total = diffDays(season.end_date as LocalDate, season.start_date as LocalDate) + 1;
  const pos = (d: string) => `${Math.min(100, Math.max(0, (diffDays(d as LocalDate, season.start_date as LocalDate) / total) * 100))}%`;
  const width = (a: string, b: string) => `${((diffDays(b as LocalDate, a as LocalDate) + 1) / total) * 100}%`;
  const now = today();
  return (
    <section className="flex flex-col gap-1">
      <p className="text-sm text-neutral-500">{season.name} · {short(season.start_date)} → {short(season.end_date)}{season.goal ? ` · ${season.goal}` : ""}</p>
      <div className="relative h-24 w-full overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
        {phases.map((p) => (
          <div key={p.id} className={`absolute top-0 flex h-12 items-center overflow-hidden px-1 text-xs ${PHASE_COLOR[p.type] ?? ""}`} style={{ left: pos(p.start_date), width: width(p.start_date, p.end_date) }} title={`${p.name} : ${short(p.start_date)} → ${short(p.end_date)}`}>
            <span className="truncate">{p.name}</span>
          </div>
        ))}
        {races.map((r) => (
          <div key={r.id} className="absolute top-12 flex -translate-x-1/2 flex-col items-center" style={{ left: pos(r.date) }}>
            <span className="h-4 w-px bg-foreground" />
            <Link href={`/courses/${r.id}`} className="rounded bg-foreground px-1 text-xs text-background">{r.priority}</Link>
          </div>
        ))}
        {now >= season.start_date && now <= season.end_date && (
          <div className="absolute top-0 h-full w-0.5 bg-red-500" style={{ left: pos(now) }} title="Aujourd'hui" />
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 text-xs text-neutral-600 dark:text-neutral-400">
        {races.map((r) => <li key={r.id}>{r.priority} · {r.name} ({short(r.date)})</li>)}
        <li><span className="text-red-500">|</span> aujourd&apos;hui</li>
      </ul>
    </section>
  );
}

function SeasonVolume({ season }: { season: Season }) {
  const { db } = useSync();
  const weeks = useLiveQuery(async () => {
    const [planned, completed] = await Promise.all([
      db.planned_sessions.where("date").between(season.start_date, season.end_date, true, true).toArray(),
      db.completed_sessions.where("local_date").between(season.start_date, season.end_date, true, true).toArray(),
    ]);
    const out: { label: string; planned: number; done: number }[] = [];
    for (let w: string = weekStart(season.start_date as LocalDate); w <= season.end_date; w = addDays(w as LocalDate, 7)) {
      const end = addDays(w as LocalDate, 6);
      out.push({
        label: short(w),
        planned: planned.filter((p) => !p.deleted_at && p.date >= w && p.date <= end).reduce((a, p) => a + (p.target_duration_s ?? 0), 0) / 3600,
        done: completed.filter((c) => !c.deleted_at && c.local_date >= w && c.local_date <= end).reduce((a, c) => a + completedDuration(c), 0) / 3600,
      });
    }
    return out;
  }, [db, season.start_date, season.end_date]);
  if (!weeks) return null;
  return (
    <ChartBlock
      title="Volume hebdomadaire prévu et réalisé"
      table={<table className="text-sm tabular-nums"><tbody>{weeks.map((w) => <tr key={w.label}><td className="pr-3">{w.label}</td><td className="pr-3">{formatDuration(w.planned * 3600)}</td><td>{formatDuration(w.done * 3600)}</td></tr>)}</tbody></table>}
    >
      <VolumeChart data={weeks} />
    </ChartBlock>
  );
}

function PhaseList({ season, phases }: { season: Season; phases: Phase[] }) {
  const engine = useSync();
  const save = (id: string, fields: Record<string, unknown>) => void engine.mutate("phases", id, fields);
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="font-medium">Phases</h2>
      {phases.map((p) => (
        <div key={p.id} className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 p-2 sm:grid-cols-5 dark:border-neutral-800">
          <input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && save(p.id, { name: e.target.value })} className={`${inputClass} h-9`} aria-label="Nom" />
          <select value={p.type} onChange={(e) => save(p.id, { type: e.target.value })} className={`${inputClass} h-9`} aria-label="Type">
            {Object.entries(PHASE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" defaultValue={p.start_date} onBlur={(e) => e.target.value && e.target.value !== p.start_date && save(p.id, { start_date: e.target.value })} className={`${inputClass} h-9`} aria-label="Début" />
          <input type="date" defaultValue={p.end_date} onBlur={(e) => e.target.value && e.target.value !== p.end_date && save(p.id, { end_date: e.target.value })} className={`${inputClass} h-9`} aria-label="Fin" />
          <button onClick={() => window.confirm("Supprimer cette phase ?") && save(p.id, { deleted_at: nowIso() })} className="text-xs text-neutral-500 underline">Supprimer</button>
        </div>
      ))}
      <button
        onClick={() => {
          const last = phases.at(-1);
          const start = last ? addDays(last.end_date as LocalDate, 1) : season.start_date;
          void engine.mutate("phases", uuidv7(), { season_id: season.id, type: "base", name: "Nouvelle phase", start_date: start, end_date: addDays(start as LocalDate, 27) });
        }}
        className="self-start underline"
      >
        + Ajouter une phase
      </button>
    </section>
  );
}

/** Planification à rebours : date d'objectif et nombre de semaines → structure de phases vide à remplir. */
function Backward({ races, seasons, phases }: { races: Race[]; seasons: Season[]; phases: Phase[] }) {
  const engine = useSync();
  const target = races.find((r) => r.priority === "A") ?? races[0];
  const [raceId, setRaceId] = useState(target?.id ?? "");
  const race = races.find((r) => r.id === raceId);
  const [weeks, setWeeks] = useState(() => (target ? Math.min(52, weeksUntil(addDays(today(), 7), target.date)) : 24));
  const [done, setDone] = useState<string | null>(null);
  if (!races.length) return null;
  const drafts: PhaseDraft[] = race ? backwardPhases(race.date, weeks) : [];
  const start = drafts[0]?.start_date;
  const overlap = race && start ? phases.filter((p) => p.start_date <= race.date && p.end_date >= start) : [];

  async function create() {
    if (!race || !start) return;
    let season = seasons.find((s) => s.start_date <= start && s.end_date >= race.date);
    const writes: { table: "seasons" | "phases"; id: string; fields: Record<string, unknown> }[] = [];
    if (!season) {
      const id = uuidv7();
      writes.push({ table: "seasons", id, fields: { name: `Saison ${race.name}`, start_date: start, end_date: race.date, goal: race.name, main_race_id: race.id } });
      season = { id } as Season;
    }
    for (const d of drafts) writes.push({ table: "phases", id: uuidv7(), fields: { season_id: season.id, type: d.type, name: d.name, start_date: d.start_date, end_date: d.end_date } });
    await engine.mutateMany(writes);
    setDone(`${drafts.length} phases créées du ${short(start)} au ${short(race.date)}. Remplis-les avec des motifs de semaine.`);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <h2 className="font-medium">Planifier à rebours depuis une course</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Course">
          <select value={raceId} onChange={(e) => setRaceId(e.target.value)} className={inputClass}>
            {races.map((r) => <option key={r.id} value={r.id}>{r.priority} · {r.name} ({short(r.date)})</option>)}
          </select>
        </Field>
        <Field label="Semaines de préparation"><input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(Number(e.target.value) || 4)} className={inputClass} /></Field>
      </div>
      <ul className="tabular-nums text-neutral-600 dark:text-neutral-400">
        {drafts.map((d) => <li key={d.type}>{d.name} : {d.weeks} sem. · {short(d.start_date)} → {short(d.end_date)}</li>)}
      </ul>
      {overlap.length > 0 && <p className="text-amber-700 dark:text-amber-400">{overlap.length} phase(s) existent déjà sur cette période : supprime-les d&apos;abord pour éviter les chevauchements.</p>}
      <button onClick={() => void create()} disabled={!drafts.length || overlap.length > 0} className="h-11 rounded-md bg-foreground font-medium text-background disabled:opacity-50">Créer la structure</button>
      {done && <p>{done}</p>}
    </section>
  );
}

function NewSeason() {
  const engine = useSync();
  const [f, setF] = useState({ name: "", start: today() as string, end: addDays(today(), 300) as string, goal: "" });
  return (
    <details className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <summary className="cursor-pointer font-medium">Créer une saison à la main</summary>
      <form className="mt-3 grid grid-cols-2 gap-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim() || f.end <= f.start) return;
        void engine.mutate("seasons", uuidv7(), { name: f.name.trim(), start_date: f.start, end_date: f.end, goal: f.goal.trim() || null });
        setF({ ...f, name: "", goal: "" });
      }}>
        <Field label="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputClass} required /></Field>
        <Field label="Objectif"><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} className={inputClass} /></Field>
        <Field label="Début"><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={inputClass} /></Field>
        <Field label="Fin"><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={inputClass} /></Field>
        <button className="col-span-2 h-11 rounded-md bg-foreground font-medium text-background">Créer</button>
      </form>
    </details>
  );
}
