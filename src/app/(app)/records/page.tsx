"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";
import { BIKE_POWER_S, RUN_DISTANCES, recordLines, type BestEfforts } from "@/domain/life/records";
import { formatHms } from "@/lib/format";
import type { PlannedSession } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useTargetContext } from "@/lib/sync/queries";
import { isStale, prepareAnalyses, storedSessionAnalysis } from "@/lib/sync/streams";
import { formatLocalDate, type LocalDate } from "@/lib/time";

const RUN_LABEL: Record<number, string> = { 1000: "1 km", 5000: "5 km", 10000: "10 km", 21097: "Semi-marathon", 42195: "Marathon" };
const POWER_LABEL: Record<number, string> = { 300: "5 min", 1200: "20 min", 3600: "1 h" };
const fr = (d: string) => formatLocalDate(d as LocalDate, { day: "numeric", month: "short", year: "numeric" });

/** Records personnels par distance (course) et par durée (puissance vélo), avec leur progression. */
export default function RecordsPage() {
  const engine = useSync();
  const ctx = useTargetContext();
  const [progress, setProgress] = useState<string | null>(null);
  const completed = useLiveQuery(async () => (await engine.db.completed_sessions.toArray()).filter((c) => !c.deleted_at), [engine.db]);
  if (!completed || !ctx) return null;

  const entries = completed.flatMap((c) => {
    const best = (storedSessionAnalysis(c)?.best ?? {}) as BestEfforts;
    return [
      ...Object.entries(best.run ?? {}).map(([d, v]) => ({ key: `run:${d}`, date: c.local_date, value: v as number, source_id: c.id })),
      ...Object.entries(best.power ?? {}).map(([s, v]) => ({ key: `power:${s}`, date: c.local_date, value: v as number, source_id: c.id })),
    ];
  });
  const lines = new Map(recordLines(entries, (k) => k.startsWith("run")).map((l) => [l.key, l]));
  const missing = completed.filter((c) => c.strava_activity_id && (c.discipline === "run" || c.discipline === "bike") && isStale(c, ctx));
  const name = (id: string) => completed.find((c) => c.id === id)?.name ?? "séance";

  async function analyse() {
    if (!ctx) return;
    const res = await prepareAnalyses(engine, missing.map((c) => ({ completion: c, planned: null as PlannedSession | null })), ctx, (d, t) => setProgress(`Analyse : ${d}/${t}`));
    setProgress(res.stoppedOn ? `${res.analysed} séance(s) analysée(s) ; arrêt : ${res.stoppedOn}. Relance plus tard pour continuer.` : `${res.analysed} séance(s) analysée(s).`);
  }

  const Row = ({ k, label, format }: { k: string; label: string; format: (v: number) => string }) => {
    const l = lines.get(k);
    return (
      <tr className="border-t border-neutral-200 align-top dark:border-neutral-800">
        <td className="py-1.5 pr-2">{label}</td>
        <td className="py-1.5 pr-2 font-semibold tabular-nums">{l ? format(l.best.value) : "—"}</td>
        <td className="py-1.5 text-xs text-neutral-500">
          {l ? <>{fr(l.best.date)} · {name(l.best.source_id)}{l.history.length > 1 && <> · progression : {l.history.map((h) => format(h.value)).join(" → ")}</>}</> : ""}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Records</h1>
      <p className="text-sm text-neutral-500">
        Meilleurs efforts mesurés sur les flux (un kilomètre le plus rapide au sein d&apos;une sortie compte aussi), pas seulement les courses officielles.
      </p>
      {missing.length > 0 && (
        <button onClick={() => void analyse()} disabled={!!progress?.startsWith("Analyse")} className="self-start rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700">
          Analyser {missing.length} séance(s) (60 téléchargements Strava au plus par lot)
        </button>
      )}
      {progress && <p className="text-sm">{progress}</p>}
      <section>
        <h2 className="font-medium">Course à pied</h2>
        <table className="w-full text-sm"><tbody>{RUN_DISTANCES.map((d) => <Row key={d} k={`run:${d}`} label={RUN_LABEL[d]} format={(v) => formatHms(v)} />)}</tbody></table>
      </section>
      <section>
        <h2 className="font-medium">Vélo : puissance moyenne</h2>
        <table className="w-full text-sm"><tbody>{BIKE_POWER_S.map((s) => <Row key={s} k={`power:${s}`} label={POWER_LABEL[s]} format={(v) => `${v} W`} />)}</tbody></table>
      </section>
      <Link href="/analyse" className="text-sm underline">Analyse</Link>
    </div>
  );
}
