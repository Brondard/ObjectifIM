"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { v7 as uuidv7 } from "uuid";
import { BASES } from "@/domain/labels";
import { checkinAdvice, DEFAULT_CHECKIN, hrRestBaseline, lighterVersion, type CheckinParams } from "@/domain/life/review";
import { heatAdjust, rainSwaps, sessionWeather } from "@/domain/life/weather";
import { moveChange, planMove } from "@/domain/planning";
import { formatDuration, formatRange } from "@/lib/format";
import type { CompletedSession, PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useDailyLog } from "@/lib/sync/queries";
import { useForecast } from "@/lib/sync/weather";
import { addDays, formatLocalDate, today, type LocalDate } from "@/lib/time";
import { useTargets } from "./targets";

/** Météo pendant une séance extérieure, et correction d'allure à la chaleur affichée en clair. */
export function WeatherLine({ session }: { session: PlannedSession }) {
  const forecast = useForecast();
  const targets = useTargets(session);
  const { db } = useSync();
  const heatParams = useLiveQuery(async () => {
    const r = (await db.engine_rules.where("rule_key").equals("intensity_judgement").toArray()).find((x) => !x.deleted_at);
    const p = (r?.params ?? {}) as { heat_correction_from_c?: number; heat_pct_per_c?: number };
    return { from: p.heat_correction_from_c ?? 20, pct: p.heat_pct_per_c ?? 0.4 };
  }, [db]);
  if (!forecast || session.indoor || !["run", "bike", "other"].includes(session.discipline)) return null;
  const w = sessionWeather(forecast, session.date, session.local_time, session.target_duration_s);
  if (!w) return null;
  const pace = targets?.find((t) => t.status === "ok" && t.basis === "pace");
  const adj = pace && pace.status === "ok" && heatParams ? heatAdjust(pace, w.temp_max, heatParams.from, heatParams.pct) : null;
  return (
    <div className="text-sm text-neutral-600 dark:text-neutral-400">
      <p>
        Météo : {Math.round(w.temp_avg)} °C (max {Math.round(w.temp_max)}){w.rain_mm > 0 || w.rain_probability >= 30 ? `, pluie ${w.rain_mm} mm (${w.rain_probability} %)` : ", sec"}, vent {w.wind_max} km/h
      </p>
      {adj && pace?.status === "ok" && (
        <p className="font-medium text-amber-700 dark:text-amber-400">
          Chaleur {Math.round(w.temp_max)} °C : {BASES.pace.toLowerCase()} cible corrigée de +{String(adj.pct).replace(".", ",")} % → {formatRange("pace", adj.min, adj.max)}
          {" "}(au lieu de {formatRange("pace", pace.min, pace.max)})
        </p>
      )}
    </div>
  );
}

/** Chaussures ou vélo de la séance (pré-rempli par l'équipement Strava quand il est connu). */
export function EquipmentPicker({ completion }: { completion: CompletedSession }) {
  const engine = useSync();
  const items = useLiveQuery(async () => (await engine.db.equipment.toArray()).filter((e) => !e.deleted_at && !e.retired_on && (e.kind === (completion.discipline === "run" ? "shoes" : "bike"))), [engine.db, completion.discipline]);
  if (!items?.length) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      {completion.discipline === "run" ? "Chaussures" : "Vélo"}
      <select value={completion.equipment_id ?? ""} onChange={(e) => void engine.mutate("completed_sessions", completion.id, { equipment_id: e.target.value || null })}
        className="h-9 rounded border border-neutral-300 bg-transparent px-2 dark:border-neutral-700">
        <option value="">—</option>
        {items.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>
  );
}

/**
 * Check-in du matin : à partir de deux indicateurs mauvais, la version allégée de la séance du jour est
 * proposée, déjà prête. Rien n'est changé sans validation.
 */
export function CheckinAdvice({ sessions }: { sessions: PlannedSession[] }) {
  const engine = useSync();
  const day = today();
  const log = useDailyLog(day);
  const ctx = useLiveQuery(async () => {
    const [logs, rules] = await Promise.all([
      engine.db.daily_logs.where("date").between(addDays(day, -21), addDays(day, -1), true, true).toArray(),
      engine.db.engine_rules.where("rule_key").equals("checkin_lighten").toArray(),
    ]);
    return {
      baseline: hrRestBaseline(logs.filter((l) => !l.deleted_at).map((l) => l.hr_rest)),
      params: { ...DEFAULT_CHECKIN, ...((rules.find((r) => !r.deleted_at)?.params ?? {}) as Partial<CheckinParams>) },
    };
  }, [engine.db, day]);
  if (!log || !ctx) return null;
  const advice = checkinAdvice(log, ctx.baseline, ctx.params);
  const target = sessions.find((s) => s.status === "planned" && s.discipline !== "strength") ?? sessions.find((s) => s.status === "planned");
  if (!advice.lighten || !target) return null;
  const lighter = lighterVersion(target, ctx.params.duration_ratio);

  async function apply() {
    if (!target) return;
    await engine.mutateMany([
      { table: "planned_sessions", id: target.id, fields: { ...lighter, instructions: `Version allégée (check-in : ${advice.bad.join(", ")}).${target.instructions ? ` ${target.instructions}` : ""}` } },
      {
        table: "plan_changes", id: uuidv7(),
        fields: {
          trigger: "manual", reason: `Check-in : ${advice.bad.join(", ")}`, input: { checkin: log?.date }, chosen_option: "lighten",
          affected: [{ id: target.id, before: { target_duration_s: target.target_duration_s, session_type: target.session_type, priority: target.priority }, after: lighter }],
        },
      },
    ]);
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
      <p>Check-in : {advice.bad.join(", ")} en dessous de l&apos;habitude.</p>
      <p>
        Version allégée de « {target.title ?? target.session_type} » prête : {formatDuration(lighter.target_duration_s)} au lieu de {formatDuration(target.target_duration_s)},
        {lighter.target_intensity ? ` zone ${lighter.target_intensity.zone},` : ""} sans structure.
      </p>
      <button onClick={() => void apply()} className="h-11 rounded-md bg-foreground font-medium text-background">Passer à la version allégée</button>
    </section>
  );
}

/** Grosse pluie sur une sortie longue ou une séance clé : proposer d'intervertir avec un jour sec. */
export function RainSwaps({ sessions, weekEnd }: { sessions: PlannedSession[]; weekEnd: string }) {
  const engine = useSync();
  const forecast = useForecast();
  const t = useLiveQuery(async () => {
    const r = (await engine.db.engine_rules.where("rule_key").equals("weather").toArray()).find((x) => !x.deleted_at);
    const p = (r?.params ?? {}) as { rain_mm?: number; rain_probability?: number };
    return { rain_mm: p.rain_mm ?? 3, probability: p.rain_probability ?? 70 };
  }, [engine.db]);
  if (!forecast || !t) return null;
  const swaps = rainSwaps(sessions, forecast, today(), weekEnd, t);
  if (!swaps.length) return null;
  const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric" });

  async function swap(a: PlannedSession, b: PlannedSession) {
    await engine.mutateMany([
      { table: "planned_sessions", id: a.id, fields: planMove(a, b.date as LocalDate) },
      { table: "planned_sessions", id: b.id, fields: planMove(b, a.date as LocalDate) },
      { table: "plan_changes", id: uuidv7(), fields: { ...moveChange(a, b.date as LocalDate, "Pluie annoncée"), trigger: "manual", affected: [
        { id: a.id, before: { date: a.date }, after: { date: b.date } }, { id: b.id, before: { date: b.date }, after: { date: a.date } },
      ] } },
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      {swaps.map((s) => (
        <div key={s.session.id} className="rounded-md border border-sky-400 bg-sky-50 p-3 text-sm dark:bg-sky-950">
          <p>
            Pluie annoncée {fr(s.session.date)} pendant « {s.session.title ?? s.session.session_type} » ({s.rain_mm} mm, {s.probability} %).
            {" "}Intervertir avec « {s.with.title ?? s.with.session_type} » {fr(s.with.date)}, annoncé sec ?
          </p>
          <button onClick={() => void swap(s.session as PlannedSession, s.with as PlannedSession)} className="mt-2 h-10 rounded-md bg-foreground px-3 text-background">Intervertir</button>
        </div>
      ))}
    </div>
  );
}
