"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { LEG_LABEL, LegPlanner, type Leg } from "@/components/race/leg-planner";
import { MorningTimeline, RaceChecklist, RaceDebrief, RaceInfo } from "@/components/race/race-sections";
import { FORMATS, TRI_LEGS, TRI_TIME_SHARE } from "@/domain/labels";
import { raceReminders } from "@/domain/race/plan";
import { formatHms } from "@/lib/format";
import { useRaceBundle } from "@/lib/sync/race-queries";
import { diffDays, formatLocalDate, today, type LocalDate } from "@/lib/time";

export default function RacePage() {
  const { id } = useParams<{ id: string }>();
  const bundle = useRaceBundle(id);
  if (bundle === undefined) return null;
  if (bundle === null) return <p className="text-sm text-neutral-500">Course introuvable.</p>;
  const { race, plans, weight, lthr, products, protocols } = bundle;
  const now = today();
  const days = diffDays(race.date as LocalDate, now as LocalDate);
  const goals = (race.goals ?? {}) as { a?: number; b?: number; c?: number };
  const legs: Leg[] = race.sport === "tri" ? ["swim", "bike", "run"] : race.sport === "bike" ? ["bike"] : race.sport === "swim" ? ["swim"] : ["run"];
  const triLegs = TRI_LEGS[race.format as keyof typeof TRI_LEGS];
  const reminders = raceReminders([race], now, weight);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/courses" className="text-sm text-neutral-500">← Courses</Link>
        <h1 className="text-xl font-semibold">
          <span className="mr-2 rounded bg-foreground px-1.5 text-sm text-background">{race.priority}</span>
          {race.name}
        </h1>
        <p className="text-sm text-neutral-500 first-letter:uppercase">
          {formatLocalDate(race.date as LocalDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {race.start_time ? ` · départ ${race.start_time.slice(0, 5)}` : ""} · {FORMATS[race.format as keyof typeof FORMATS] ?? race.format}
          {" · "}{days > 0 ? `dans ${days} jours` : days === 0 ? "aujourd'hui" : `il y a ${-days} jours`}
        </p>
        {(goals.a || goals.b || goals.c) && (
          <p className="text-sm">Objectifs : {(["a", "b", "c"] as const).filter((k) => goals[k]).map((k) => `${k.toUpperCase()} ${formatHms(goals[k])}`).join(" · ")}</p>
        )}
      </header>

      {reminders.map((r) => <p key={r.key} className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{r.message}</p>)}

      <Link href={`/courses/${race.id}/mode`} className="flex h-12 items-center justify-center rounded-md bg-foreground font-medium text-background">
        Mode course
      </Link>

      <RaceInfo race={race} />

      {legs.map((leg) => (
        <LegPlanner
          key={`${leg}-${plans.find((p) => p.leg === leg)?._rev ?? 0}`}
          race={race}
          leg={leg}
          plan={plans.find((p) => p.leg === leg) ?? null}
          defaultDistance={triLegs ? triLegs[leg] : race.distance_m}
          defaultGoal={goals.a ? (race.sport === "tri" ? Math.round(goals.a * TRI_TIME_SHARE[leg]) : goals.a) : null}
          weight={weight}
          lthr={lthr}
          products={products}
          protocols={protocols}
        />
      ))}
      {legs.length > 1 && (
        <p className="text-xs text-neutral-500">
          Objectifs par portion proposés d&apos;après l&apos;objectif A ({LEG_LABEL.swim} {Math.round(TRI_TIME_SHARE.swim * 100)} %, {LEG_LABEL.bike} {Math.round(TRI_TIME_SHARE.bike * 100)} %, {LEG_LABEL.run} {Math.round(TRI_TIME_SHARE.run * 100)} %, transitions {Math.round(TRI_TIME_SHARE.transitions * 100)} %) : ajuste-les.
        </p>
      )}

      <MorningTimeline race={race} plan={plans.find((p) => p.leg === "full") ?? null} />
      <RaceChecklist race={race} checklist={bundle.checklist} items={bundle.items} templates={bundle.templates} />
      <RaceDebrief race={race} />
    </div>
  );
}
