"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { FORMAT_DISTANCE, FORMATS, SPORTS } from "@/domain/labels";
import { formatHms, parseHms } from "@/lib/format";
import { useSync } from "@/lib/sync/provider";
import { useRaceList } from "@/lib/sync/race-queries";
import { diffDays, formatLocalDate, today, type LocalDate } from "@/lib/time";

export default function RacesPage() {
  const races = useRaceList();
  const now = today();
  const [creating, setCreating] = useState(false);
  if (!races) return null;
  const upcoming = races.filter((r) => r.date >= now);
  const past = races.filter((r) => r.date < now).reverse();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Courses</h1>
        <Link href="/nutrition" className="text-sm underline">Nutrition</Link>
      </header>
      {creating ? <NewRace onCancel={() => setCreating(false)} /> : (
        <button onClick={() => setCreating(true)} className="h-11 self-start rounded-md bg-foreground px-4 font-medium text-background">Nouvelle course</button>
      )}
      <RaceList title="À venir" races={upcoming} now={now} />
      {past.length > 0 && <RaceList title="Passées" races={past} now={now} />}
    </div>
  );
}

function RaceList({ title, races, now }: { title: string; races: NonNullable<ReturnType<typeof useRaceList>>; now: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      {races.length === 0 && <p className="text-sm text-neutral-500">Aucune.</p>}
      {races.map((r) => {
        const days = diffDays(r.date as LocalDate, now as LocalDate);
        const goals = r.goals as { a?: number; b?: number; c?: number } | null;
        return (
          <Link key={r.id} href={`/courses/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div>
              <p className="font-medium">
                <span className="mr-2 rounded bg-foreground px-1.5 text-xs text-background">{r.priority}</span>
                {r.name}
              </p>
              <p className="text-sm text-neutral-500">
                {formatLocalDate(r.date as LocalDate, { weekday: "short", day: "numeric", month: "long", year: "numeric" })} · {FORMATS[r.format as keyof typeof FORMATS] ?? r.format}
                {goals?.a ? ` · objectif A ${formatHms(goals.a)}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-sm tabular-nums text-neutral-500">{days >= 0 ? `J−${days}` : `J+${-days}`}</span>
          </Link>
        );
      })}
    </section>
  );
}

function NewRace({ onCancel }: { onCancel: () => void }) {
  const engine = useSync();
  const router = useRouter();
  const [f, setF] = useState({ name: "", date: today() as string, start_time: "07:00", sport: "tri", format: "140.6", priority: "A", location: "", goalA: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const id = uuidv7();
    const goal = parseHms(f.goalA);
    await engine.mutate("races", id, {
      name: f.name.trim(), date: f.date, start_time: f.start_time || null, sport: f.sport, format: f.format, priority: f.priority,
      location: f.location.trim() || null, distance_m: FORMAT_DISTANCE[f.format as keyof typeof FORMATS] ?? null,
      goals: goal ? { a: goal } : {},
    });
    router.push(`/courses/${id}`);
  }

  return (
    <form onSubmit={(e) => void save(e)} className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <Field label="Nom" className="col-span-2"><input required value={f.name} onChange={(e) => set("name", e.target.value)} className={inputClass} /></Field>
      <Field label="Date"><input type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} className={inputClass} /></Field>
      <Field label="Heure de départ"><input type="time" value={f.start_time} onChange={(e) => set("start_time", e.target.value)} className={inputClass} /></Field>
      <Field label="Sport">
        <select value={f.sport} onChange={(e) => set("sport", e.target.value)} className={inputClass}>
          {Object.entries(SPORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Format">
        <select value={f.format} onChange={(e) => set("format", e.target.value)} className={inputClass}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Priorité">
        <select value={f.priority} onChange={(e) => set("priority", e.target.value)} className={inputClass}>
          <option value="A">A (objectif)</option><option value="B">B</option><option value="C">C</option>
        </select>
      </Field>
      <Field label="Objectif A (h:mm:ss)"><input placeholder="11:30:00" value={f.goalA} onChange={(e) => set("goalA", e.target.value)} className={inputClass} /></Field>
      <Field label="Lieu" className="col-span-2"><input value={f.location} onChange={(e) => set("location", e.target.value)} className={inputClass} /></Field>
      <div className="col-span-2 flex gap-2">
        <button className="h-11 flex-1 rounded-md bg-foreground font-medium text-background">Créer</button>
        <button type="button" onClick={onCancel} className="h-11 px-3 text-sm text-neutral-500">Annuler</button>
      </div>
    </form>
  );
}
