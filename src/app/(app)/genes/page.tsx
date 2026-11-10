"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { inputClass } from "@/components/session-form";
import { niggleSignals } from "@/domain/analysis/signals";
import type { Niggle, NiggleEntry } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { formatLocalDate, today, type LocalDate } from "@/lib/time";

/** Zones de la carte du corps. x, y : position du côté gauche de la personne sur la vue concernée. */
const ZONES: { code: string; label: string; view: "front" | "back"; x: number; y: number; paired: boolean }[] = [
  { code: "shoulder", label: "Épaule", view: "front", x: 62, y: 78, paired: true },
  { code: "hip_flexor", label: "Psoas / hanche", view: "front", x: 84, y: 160, paired: true },
  { code: "it_band", label: "Bandelette (TFL)", view: "front", x: 70, y: 200, paired: true },
  { code: "quadriceps", label: "Quadriceps", view: "front", x: 86, y: 205, paired: true },
  { code: "knee", label: "Genou", view: "front", x: 86, y: 250, paired: true },
  { code: "shin", label: "Tibia", view: "front", x: 86, y: 292, paired: true },
  { code: "ankle", label: "Cheville", view: "front", x: 86, y: 338, paired: true },
  { code: "foot", label: "Pied (dessus)", view: "front", x: 84, y: 358, paired: true },
  { code: "neck", label: "Nuque", view: "back", x: 100, y: 58, paired: false },
  { code: "upper_back", label: "Haut du dos", view: "back", x: 100, y: 100, paired: false },
  { code: "lower_back", label: "Lombaires", view: "back", x: 100, y: 145, paired: false },
  { code: "glute", label: "Fessier", view: "back", x: 86, y: 172, paired: true },
  { code: "hamstring", label: "Ischio-jambiers", view: "back", x: 86, y: 210, paired: true },
  { code: "calf", label: "Mollet", view: "back", x: 86, y: 288, paired: true },
  { code: "achilles", label: "Tendon d'Achille", view: "back", x: 86, y: 334, paired: true },
  { code: "plantar", label: "Voûte plantaire", view: "back", x: 86, y: 360, paired: true },
];

const SIDES: Record<string, string> = { left: "gauche", right: "droit", both: "les deux", center: "centre" };
const zoneLabel = (code: string) => ZONES.find((z) => z.code === code)?.label ?? code;
const fr = (d: string) => formatLocalDate(d as LocalDate, { day: "numeric", month: "short" });

/** Silhouette simple : tête, tronc, bras, jambes. */
function Body() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={1.5} className="text-neutral-300 dark:text-neutral-700">
      <circle cx={100} cy={30} r={16} />
      <path d="M70 60 Q100 52 130 60 L136 150 Q100 162 64 150 Z" />
      <path d="M70 62 L48 140 M130 62 L152 140" />
      <path d="M72 152 L82 260 L84 360 M128 152 L118 260 L116 360" />
      <path d="M96 160 L92 260 L92 360 M104 160 L108 260 L108 360" />
    </g>
  );
}

function BodyMap({ onPick, active }: { onPick: (code: string, side: string) => void; active: Set<string> }) {
  const views: ("front" | "back")[] = ["front", "back"];
  return (
    <div className="grid grid-cols-2 gap-2">
      {views.map((view) => (
        <figure key={view} className="flex flex-col items-center">
          <svg viewBox="0 0 200 380" className="h-80 w-full max-w-[200px]" role="group" aria-label={view === "front" ? "Vue de face" : "Vue de dos"}>
            <Body />
            {ZONES.filter((z) => z.view === view).flatMap((z) => {
              // De face, le côté gauche de la personne est à droite de l'écran ; de dos, à gauche.
              const leftX = view === "front" ? 200 - z.x : z.x;
              const spots = z.paired
                ? [{ side: "left", x: leftX }, { side: "right", x: 200 - leftX }]
                : [{ side: "center", x: z.x }];
              return spots.map((s) => {
                const on = active.has(`${z.code}|${s.side}`);
                return (
                  <g key={`${z.code}-${s.side}`} role="button" tabIndex={0} aria-label={`${z.label} ${SIDES[s.side]}`}
                    onClick={() => onPick(z.code, s.side)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(z.code, s.side)}
                    className="cursor-pointer">
                    <circle cx={s.x} cy={z.y} r={11} fill="transparent" />
                    <circle cx={s.x} cy={z.y} r={6} className={on ? "fill-red-500" : "fill-neutral-400/60 hover:fill-neutral-600"} />
                  </g>
                );
              });
            })}
          </svg>
          <figcaption className="text-xs text-neutral-500">{view === "front" ? "Face" : "Dos"}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function NigglesPage() {
  const engine = useSync();
  const { db } = engine;
  const now = today();
  const [pick, setPick] = useState<{ code: string; side: string } | null>(null);
  const data = useLiveQuery(async () => {
    const [niggles, entries] = await Promise.all([db.niggles.toArray(), db.niggle_entries.toArray()]);
    return { niggles: niggles.filter((n) => !n.deleted_at), entries: entries.filter((e) => !e.deleted_at) };
  }, [db]);
  if (!data) return null;

  const activeList = data.niggles.filter((n) => !n.resolved_on).sort((a, b) => b.started_on.localeCompare(a.started_on));
  const resolved = data.niggles.filter((n) => n.resolved_on);
  const signals = niggleSignals(data.niggles, data.entries, now);
  const historyByZone = new Map<string, Niggle[]>();
  for (const n of data.niggles) historyByZone.set(`${n.body_zone}|${n.side}`, [...(historyByZone.get(`${n.body_zone}|${n.side}`) ?? []), n]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Gênes et douleurs</h1>
      <p className="text-sm text-neutral-500">Touche l&apos;endroit qui gêne. Une petite douleur notée tôt vaut mieux qu&apos;une blessure découverte tard.</p>

      {signals.map((s) => (
        <p key={s.key} className={`rounded-md p-2 text-sm ${s.level === "serious" ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
          {s.message.replace(/\((\w+), (\w+)\)/, (_, z, side) => `(${zoneLabel(z)}, ${SIDES[side] ?? side})`)}
        </p>
      ))}

      <BodyMap onPick={(code, side) => setPick({ code, side })} active={new Set(activeList.map((n) => `${n.body_zone}|${n.side}`))} />

      {pick && (
        <NewNiggle
          key={`${pick.code}-${pick.side}`}
          code={pick.code}
          side={pick.side}
          previous={historyByZone.get(`${pick.code}|${pick.side}`)?.length ?? 0}
          onDone={() => setPick(null)}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">En cours</h2>
        {activeList.length === 0 && <p className="text-sm text-neutral-500">Aucune gêne en cours.</p>}
        {activeList.map((n) => (
          <ActiveNiggle key={n.id} niggle={n} entries={data.entries.filter((e) => e.niggle_id === n.id)} />
        ))}
      </section>

      {resolved.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">Historique par zone</h2>
          {[...historyByZone.entries()].map(([k, list]) => {
            const [code, side] = k.split("|");
            return (
              <p key={k}>
                {zoneLabel(code)} ({SIDES[side]}) : {list.length} épisode(s) —{" "}
                <span className="text-neutral-500">{list.map((n) => `${fr(n.started_on)}${n.resolved_on ? ` → ${fr(n.resolved_on)}` : " → en cours"}`).join(" ; ")}</span>
              </p>
            );
          })}
        </section>
      )}
    </div>
  );
}

function Intensity({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label="Intensité de 0 à 10">
      {Array.from({ length: 11 }, (_, i) => i).map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} onClick={() => onChange(i)}
          className={`h-10 rounded text-sm ${value === i ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>
          {i}
        </button>
      ))}
    </div>
  );
}

function NewNiggle({ code, side, previous, onDone }: { code: string; side: string; previous: number; onDone: () => void }) {
  const engine = useSync();
  const [intensity, setIntensity] = useState<number | null>(null);
  const [context, setContext] = useState("");
  const [date, setDate] = useState<string>(today());

  async function save() {
    if (intensity == null) return;
    const id = uuidv7();
    await engine.mutateMany([
      { table: "niggles", id, fields: { body_zone: code, side, started_on: date, context: context.trim() || null } },
      { table: "niggle_entries", id: uuidv7(), fields: { niggle_id: id, date, intensity } },
    ]);
    onDone();
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">{zoneLabel(code)} ({SIDES[side]})</h2>
      {previous > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Déjà {previous} épisode(s) à cet endroit.</p>}
      <p className="text-sm">Intensité (0 = rien, 10 = impossible de courir)</p>
      <Intensity value={intensity} onChange={setIntensity} />
      <input placeholder="Contexte : après quelle séance, à quel moment…" value={context} onChange={(e) => setContext(e.target.value)} className={inputClass} />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={intensity == null} className="h-11 flex-1 rounded-md bg-foreground font-medium text-background disabled:opacity-50">Noter</button>
        <button onClick={onDone} className="h-11 px-3 text-sm text-neutral-500">Annuler</button>
      </div>
    </section>
  );
}

function ActiveNiggle({ niggle, entries }: { niggle: Niggle; entries: NiggleEntry[] }) {
  const engine = useSync();
  const [intensity, setIntensity] = useState<number | null>(null);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">{zoneLabel(niggle.body_zone)} ({SIDES[niggle.side]})</h3>
        <span className="text-neutral-500">depuis le {fr(niggle.started_on)}</span>
      </div>
      {niggle.context && <p className="text-neutral-600 dark:text-neutral-400">{niggle.context}</p>}
      <p className="tabular-nums">Évolution : {sorted.map((e) => `${e.intensity}/10 (${fr(e.date)})`).join(" → ") || "—"}</p>
      <p className="text-xs text-neutral-500">Noter l&apos;intensité aujourd&apos;hui :</p>
      <Intensity value={intensity ?? (last?.date === today() ? last.intensity : null)} onChange={(v) => {
        setIntensity(v);
        const todayEntry = sorted.find((e) => e.date === today());
        void engine.mutate("niggle_entries", todayEntry?.id ?? uuidv7(), { niggle_id: niggle.id, date: today(), intensity: v });
      }} />
      <button onClick={() => void engine.mutate("niggles", niggle.id, { resolved_on: today() })} className="self-start text-sm underline">
        C&apos;est passé
      </button>
    </article>
  );
}
