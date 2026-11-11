"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LEG_LABEL, SplitsTable, type Leg } from "@/components/race/leg-planner";
import type { Split } from "@/domain/race/pacing";
import type { FuelEvent } from "@/domain/race/plan";
import { formatHms } from "@/lib/format";
import { useRaceBundle } from "@/lib/sync/race-queries";
import { now as clock, today, zonedInstant, type LocalDate } from "@/lib/time";

/**
 * Mode course : plein écran, gros caractères, écran maintenu allumé. Tout vient de la copie locale :
 * utilisable sans réseau sur la ligne de départ.
 */
export default function RaceMode() {
  const { id } = useParams<{ id: string }>();
  const bundle = useRaceBundle(id);
  const [leg, setLeg] = useState<Leg | null>(null);
  const [tick, setTick] = useState(0);

  // Écran maintenu allumé tant que la page est visible.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void acquire();
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      void lock?.release();
    };
  }, []);

  if (!bundle) return null;
  const { race, plans } = bundle;
  const legPlans = plans.filter((p) => p.leg !== "full" && Array.isArray(p.splits) && (p.splits as Split[]).length);
  const order: Leg[] = ["swim", "bike", "run"];
  const available = order.filter((l) => legPlans.some((p) => p.leg === l));
  const current = leg ?? available[0] ?? null;
  const plan = legPlans.find((p) => p.leg === current);
  const splits = (plan?.splits ?? []) as Split[];
  const caps = (plan?.hr_caps ?? []) as { at_m: number; cap_bpm: number | null }[];
  const fuel = ((plan?.nutrition as { events?: FuelEvent[] } | null)?.events ?? []) as FuelEvent[];

  // Temps de course écoulé, le jour J, depuis l'heure de départ (toutes portions confondues).
  void tick;
  const elapsed = race.date === today() && race.start_time
    ? Math.round((clock().getTime() - zonedInstant(race.date as LocalDate, race.start_time).getTime()) / 1000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-background p-4">
      <header className="flex items-center justify-between gap-2">
        <Link href={`/courses/${race.id}`} className="text-sm text-neutral-500">← Quitter</Link>
        <h1 className="truncate text-lg font-semibold">{race.name}</h1>
        <button onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} className="text-sm underline">Plein écran</button>
      </header>

      {elapsed != null && elapsed > 0 && (
        <p className="text-center text-4xl font-bold tabular-nums">{formatHms(elapsed)}</p>
      )}

      {available.length > 1 && (
        <div className="grid grid-cols-3 gap-1">
          {available.map((l) => (
            <button key={l} onClick={() => setLeg(l)} className={`h-12 rounded-md text-lg ${l === current ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>
              {LEG_LABEL[l]}
            </button>
          ))}
        </div>
      )}

      {!plan ? (
        <p className="text-lg">Aucun plan enregistré. Prépare-le depuis la fiche de la course, avec du réseau ou non.</p>
      ) : (
        <>
          <p className="text-lg">
            Objectif {LEG_LABEL[plan.leg as Leg].toLowerCase()} : <strong className="tabular-nums">{formatHms(plan.target_time_s)}</strong>
            {(plan.params as { power_w?: number })?.power_w ? <> · <strong>{(plan.params as { power_w: number }).power_w} W</strong></> : null}
          </p>
          <SplitsTable leg={plan.leg as Leg} splits={splits} caps={caps} large />
          {fuel.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">Ravitaillement</h2>
              <ul className="text-xl tabular-nums">
                {fuel.map((e, i) => (
                  <li key={i} className="border-t border-neutral-200 py-1 dark:border-neutral-800">
                    {formatHms(e.t_s).slice(0, -3)}{e.at_m != null ? ` · km ${(e.at_m / 1000).toFixed(1)}` : ""} · {e.product}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
