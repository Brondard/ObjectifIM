"use client";

import { useState } from "react";
import { v5 as uuidv5 } from "uuid";
import { ChartBlock, ProfileChart } from "@/components/charts";
import { Field, inputClass } from "@/components/session-form";
import { courseProfile, flatProfile, parseGpx, repeatProfile, type CourseProfile } from "@/domain/race/gpx";
import { DEFAULT_BIKE, DEFAULT_HR_STEPS, bikeSplits, hrCaps, runSplits, type Split } from "@/domain/race/pacing";
import { distanceAtTime, fuelPlan } from "@/domain/race/plan";
import { formatClock, formatHms, parseHms } from "@/lib/format";
import type { NutritionProduct, NutritionProtocol, Race, RacePlan } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { coursesOf, type LegCourse } from "@/lib/sync/race-queries";

export type Leg = "swim" | "bike" | "run";
export const LEG_LABEL: Record<Leg, string> = { swim: "Natation", bike: "Vélo", run: "Course à pied" };

export type PlanParams = {
  goal_s?: number;
  distance_m?: number;
  bike?: { cda: number; crr: number; mass_kg: number };
  power_w?: number;
  flat?: number;
};

/** Identifiant stable du plan d'une portion : le même sur tous les appareils, donc fusionné et pas doublé. */
export const planId = (userId: string, raceId: string, leg: string) => uuidv5(`race-plan:${raceId}:${leg}`, userId);

type Props = {
  race: Race;
  leg: Leg;
  plan: RacePlan | null;
  defaultDistance: number | null;
  defaultGoal: number | null;
  weight: number | null;
  lthr: number | null;
  products: NutritionProduct[];
  protocols: NutritionProtocol[];
};

/** Calcul du plan d'une portion : temps de passage ajustés à la pente, plafonds de FC, ravitaillement. */
export function computeLeg(leg: Leg, profile: CourseProfile, goal_s: number, p: { mass_kg: number; cda: number; crr: number }, lthr: number | null) {
  if (leg === "bike") {
    const r = bikeSplits(profile, goal_s, { ...DEFAULT_BIKE, ...p });
    return { splits: r.splits, power_w: r.power_w, flat: r.flatSpeed_kmh, caps: [] as { at_m: number; cap_bpm: number | null }[] };
  }
  if (leg === "run") {
    const r = runSplits(profile, goal_s);
    return { splits: r.splits, power_w: undefined, flat: r.flatPace_s_km, caps: lthr ? hrCaps(r.splits, lthr, DEFAULT_HR_STEPS) : [] };
  }
  // Natation : pas de profil, allure moyenne aux 100 m tous les 500 m.
  const r = runSplits(profile, goal_s, 500);
  return { splits: r.splits, power_w: undefined, flat: Math.round(r.flatPace_s_km / 10), caps: [] };
}

export function LegPlanner({ race, leg, plan, defaultDistance, defaultGoal, weight, lthr, products, protocols }: Props) {
  const engine = useSync();
  const courses = coursesOf(race);
  const course: LegCourse | undefined = courses[leg];
  const params = (plan?.params ?? {}) as PlanParams;
  const [goalText, setGoalText] = useState(formatHms(params.goal_s ?? plan?.target_time_s ?? defaultGoal ?? null).replace("—", ""));
  const [distanceKm, setDistanceKm] = useState(String((params.distance_m ?? defaultDistance ?? course?.distance_m ?? 0) / 1000 || ""));
  const [protocolId, setProtocolId] = useState(plan?.protocol_id ?? protocols[0]?.id ?? "");
  const [bike, setBike] = useState(params.bike ?? { cda: DEFAULT_BIKE.cda, crr: DEFAULT_BIKE.crr, mass_kg: (weight ?? 75) + 9 });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const goal = parseHms(goalText);
  const distance = Math.round(Number(distanceKm.replace(",", ".")) * 1000);
  // GPX plus court que la course (tracé d'une boucle) : parcours répété jusqu'à la distance de la course.
  const loops = course && distance > 0 && Math.abs(distance - course.distance_m) > 50 ? distance / course.distance_m : null;
  const profile: CourseProfile | null = course
    ? (loops ? repeatProfile(course, distance) : course)
    : distance > 0 ? flatProfile(distance) : null;
  const result = profile && goal ? computeLeg(leg, profile, goal, bike, lthr) : null;
  const protocol = protocols.find((p) => p.id === protocolId) ?? null;
  const fuel = result && goal && protocol && leg !== "swim"
    ? fuelPlan(goal, { carbs_per_h: Number(protocol.carbs_per_h), items: (protocol.items ?? []) as { product_id: string; every_min: number }[] }, products.map((p) => ({ ...p, carbs_g: p.carbs_g == null ? null : Number(p.carbs_g) })), distanceAtTime(result.splits))
    : null;

  async function upload(file: File) {
    setError(null);
    const text = await file.text();
    const points = parseGpx(text);
    if (points.length < 2) return setError("Aucun point de trace lisible dans ce fichier.");
    const prof = courseProfile(points, { step_m: leg === "bike" ? 200 : 100 });
    let gpx_path: string | null = null;
    if (navigator.onLine) {
      const path = `${engine.db.userId}/${race.id}-${leg}.gpx`;
      const { error: e } = await engine.supabase.storage.from("gpx").upload(path, file, { upsert: true, contentType: "application/gpx+xml" });
      if (!e) gpx_path = path;
    }
    await engine.mutate("races", race.id, { course: { ...courses, [leg]: { ...prof, gpx_path, file_name: file.name } } });
    if (!distance) setDistanceKm(String(prof.distance_m / 1000));
  }

  async function removeGpx() {
    if (!course || !window.confirm("Retirer ce parcours GPX ? Le plan repassera sur un parcours plat.")) return;
    const rest = { ...courses };
    delete rest[leg];
    await engine.mutate("races", race.id, { course: rest });
    if (course.gpx_path && navigator.onLine) await engine.supabase.storage.from("gpx").remove([course.gpx_path]);
  }

  async function save() {
    if (!result || !goal) return;
    await engine.mutate("race_plans", planId(engine.db.userId, race.id, leg), {
      race_id: race.id,
      name: `${LEG_LABEL[leg]} : ${race.name}`,
      leg,
      target_time_s: goal,
      splits: result.splits,
      hr_caps: result.caps,
      nutrition: fuel ? { events: fuel.events, total_g: fuel.total_g, target_g: fuel.target_g } : [],
      protocol_id: protocol?.id ?? null,
      params: { goal_s: goal, distance_m: profile?.distance_m, bike: leg === "bike" ? bike : undefined, power_w: result.power_w, flat: result.flat },
    });
    setSaved(true);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-lg font-medium">{LEG_LABEL[leg]}</h2>

      {leg !== "swim" && (
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-1">
            Parcours (fichier GPX){course?.file_name ? ` : ${course.file_name}` : ""}
            <input type="file" accept=".gpx,application/gpx+xml" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} className="text-sm" />
          </label>
          {course && <button onClick={() => void removeGpx()} className="self-start text-red-600 underline">Retirer le GPX</button>}
          {error && <p className="text-red-600">{error}</p>}
          {course && (
            <>
              {loops && (
                <p className="text-amber-700 dark:text-amber-400">
                  Le GPX fait {(course.distance_m / 1000).toFixed(1)} km pour une course de {(distance / 1000).toFixed(1)} km :
                  parcours répété {loops.toFixed(2).replace(".", ",")} fois (boucles). Si ce n&apos;est pas un circuit en boucle, retire le GPX.
                </p>
              )}
              <p>
                {loops ? "Boucle : " : ""}{(course.distance_m / 1000).toFixed(1)} km · D+ {course.gain_m} m · D− {course.loss_m} m
                {course.min_ele != null && ` · altitude ${course.min_ele}–${course.max_ele} m`}
                <span className="text-neutral-500"> (dénivelé avec seuil anti-bruit de 5 m)</span>
              </p>
              {course.has_elevation && (
                <ChartBlock
                  title="Profil altimétrique"
                  table={<ul>{course.climbs.map((c, i) => <li key={i}>km {(c.start_m / 1000).toFixed(1)}–{(c.end_m / 1000).toFixed(1)} : +{c.gain_m} m à {c.grade_pct} %</li>)}</ul>}
                >
                  <ProfileChart samples={course.samples} />
                </ChartBlock>
              )}
              {course.climbs.length > 0 && (
                <ul className="text-neutral-600 dark:text-neutral-400">
                  {course.climbs.map((c, i) => (
                    <li key={i}>Montée : km {(c.start_m / 1000).toFixed(1)} → {(c.end_m / 1000).toFixed(1)}, +{c.gain_m} m à {c.grade_pct} % de moyenne</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Objectif (h:mm:ss)"><input value={goalText} onChange={(e) => { setGoalText(e.target.value); setSaved(false); }} placeholder="3:30:00" className={inputClass} /></Field>
        <Field label="Distance (km)">
          <input inputMode="decimal" value={distanceKm} onChange={(e) => { setDistanceKm(e.target.value); setSaved(false); }} className={inputClass} />
        </Field>
        {leg === "bike" && (
          <>
            <Field label="Masse vélo + cycliste (kg)"><input inputMode="decimal" value={bike.mass_kg} onChange={(e) => setBike({ ...bike, mass_kg: Number(e.target.value) || 0 })} className={inputClass} /></Field>
            <Field label="CdA (m², position)"><input inputMode="decimal" value={bike.cda} onChange={(e) => setBike({ ...bike, cda: Number(e.target.value.replace(",", ".")) || 0.3 })} className={inputClass} /></Field>
          </>
        )}
        {leg !== "swim" && (
          <Field label="Protocole de ravitaillement" className="col-span-2">
            <select value={protocolId} onChange={(e) => setProtocolId(e.target.value)} className={inputClass}>
              <option value="">Aucun</option>
              {protocols.map((p) => <option key={p.id} value={p.id}>{p.name} ({Number(p.carbs_per_h)} g/h)</option>)}
            </select>
          </Field>
        )}
      </div>

      {result && (
        <>
          <p className="text-sm">
            {leg === "bike"
              ? <>Puissance constante estimée : <strong>{result.power_w} W</strong> · {result.flat} km/h à plat (modèle physique, à recaler sur tes sorties)</>
              : leg === "run"
                ? <>Allure à plat équivalente : <strong>{formatClock(result.flat)} /km</strong> ; l&apos;écart attendu en montée et en descente est indiqué tronçon par tronçon.</>
                : <>Allure moyenne : <strong>{formatClock(result.flat)} /100 m</strong></>}
          </p>
          <SplitsTable leg={leg} splits={result.splits} caps={result.caps} />
          {leg === "run" && !lthr && <p className="text-xs text-neutral-500">Ajoute ta FC au seuil dans Réglages pour obtenir les plafonds de FC par tronçon.</p>}
        </>
      )}

      {fuel && (
        <div className="text-sm">
          <p className="font-medium">Ravitaillement : {fuel.total_g} g de glucides prévus pour {fuel.target_g} g visés</p>
          <ul className="tabular-nums text-neutral-600 dark:text-neutral-400">
            {fuel.events.map((e, i) => (
              <li key={i}>{formatHms(e.t_s).slice(0, -3)}{e.at_m != null ? ` · km ${(e.at_m / 1000).toFixed(1)}` : ""} · {e.product} ({e.carbs_g} g)</li>
            ))}
          </ul>
        </div>
      )}

      <button onClick={() => void save()} disabled={!result} className="h-11 rounded-md bg-foreground font-medium text-background disabled:opacity-50">
        {saved ? "Plan enregistré" : "Enregistrer ce plan"}
      </button>
    </section>
  );
}

export function SplitsTable({ leg, splits, caps, large = false }: { leg: Leg; splits: Split[]; caps: { at_m: number; cap_bpm: number | null }[]; large?: boolean }) {
  const cap = (m: number) => caps.find((c) => c.at_m === m)?.cap_bpm;
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className={`w-full tabular-nums ${large ? "text-xl" : "text-sm"}`}>
        <thead className="sticky top-0 bg-background text-left text-xs text-neutral-500">
          <tr>
            <th className="py-1 font-normal">km</th>
            <th className="py-1 font-normal">Passage</th>
            <th className="py-1 font-normal">{leg === "bike" ? "km/h" : "Allure"}</th>
            <th className="py-1 font-normal">Pente</th>
            {caps.length > 0 && <th className="py-1 font-normal">FC max</th>}
          </tr>
        </thead>
        <tbody>
          {splits.map((s) => (
            <tr key={s.at_m} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="py-1">{(s.at_m / 1000).toFixed(s.at_m % 1000 ? 1 : 0)}</td>
              <td className={`py-1 ${large ? "font-semibold" : ""}`}>{formatHms(s.cumulative_s)}</td>
              <td className="py-1">
                {leg === "bike" ? s.speed_kmh : formatClock(s.pace_s_km! / (leg === "swim" ? 10 : 1))}
                {s.delta !== 0 && leg !== "swim" && (
                  <span className="ml-1 text-xs text-neutral-500">
                    ({s.delta > 0 ? "+" : "−"}{leg === "bike" ? Math.abs(s.delta) : `${Math.abs(s.delta)} s`})
                  </span>
                )}
              </td>
              <td className="py-1 text-neutral-500">{s.grade_pct > 0 ? "+" : ""}{s.grade_pct} %</td>
              {caps.length > 0 && <td className="py-1">{cap(s.at_m) ?? "libre"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
