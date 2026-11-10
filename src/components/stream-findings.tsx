"use client";

import type { SessionAnalysis } from "@/domain/analysis/rigor";
import { BASES, METHODS } from "@/domain/labels";
import { formatClock, formatDuration, formatRange } from "@/lib/format";
import { ZONE_STEPS } from "./charts";

/** Temps par zone, dérive cardiaque, cadence, blocs d'allure : les analyses sur les flux d'une séance. */
export function StreamFindings({ analysis, discipline }: { analysis: SessionAnalysis; discipline: string }) {
  const { zones, drift, cadence, blocks } = analysis;
  const totalZ = zones ? zones.seconds.reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {zones && totalZ > 0 && (
        <div>
          <p className="text-xs text-neutral-500">
            Temps par zone ({BASES[zones.basis as keyof typeof BASES]}, {METHODS[zones.method as keyof typeof METHODS] ?? zones.method})
          </p>
          <div className="viz-root mt-1 flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="Répartition du temps par zone">
            {zones.seconds.map((sec, i) =>
              sec > 0 ? (
                <div key={i} style={{ width: `${(sec / totalZ) * 100}%`, background: `var(${ZONE_STEPS[i] ?? ZONE_STEPS.at(-1)})` }} title={`Z${i + 1} : ${formatDuration(sec)}`} />
              ) : null,
            )}
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
            {zones.seconds.map((sec, i) => (
              <li key={i}>
                Z{i + 1} {Math.round((sec / totalZ) * 100)} %
                <span className="text-neutral-400"> ({formatRange(zones.basis, zones.bounds[i]?.min ?? null, zones.bounds[i]?.max ?? null)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {drift && (
        <p>
          Dérive cardiaque : <strong className={drift.pct > 5 ? "text-red-700 dark:text-red-400" : ""}>{drift.pct > 0 ? "+" : ""}{drift.pct} %</strong>
          <span className="text-neutral-500">
            {" "}({drift.mode === "pace" ? "allure" : "puissance"} / FC, 2ᵉ moitié contre 1ʳᵉ, {formatDuration(drift.analysed_s)} analysées ;{" "}
            {drift.pct <= 5 ? "sous 5 % : endurance solide" : "au-delà de 5 % : l'endurance lâche en fin de séance"})
          </span>
        </p>
      )}
      {cadence && (
        <p>
          Cadence : {cadence.early} → {cadence.late} {discipline === "run" ? "pas/min" : "tr/min"}{" "}
          <span className={cadence.drop_pct > 3 ? "font-semibold text-red-700 dark:text-red-400" : "text-neutral-500"}>
            ({cadence.drop_pct > 0 ? "−" : "+"}{Math.abs(cadence.drop_pct)} % en fin de séance{cadence.drop_pct > 3 ? " : la foulée se dégrade" : ""})
          </span>
        </p>
      )}
      {blocks && blocks.length > 0 && (
        <div>
          <p className="text-xs text-neutral-500">Blocs d&apos;allure (alignés sur les durées et distances prévues : approximatif)</p>
          <ul className="tabular-nums">
            {blocks.map((b) => (
              <li key={b.index}>
                Bloc {b.index + 1} : {formatClock(b.actual)} /km pour {formatClock(b.target_min)}–{formatClock(b.target_max)}{" "}
                <span className={b.delta_s !== 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-neutral-500"}>
                  {b.delta_s < 0 ? `↑ ${-b.delta_s} s/km trop vite` : b.delta_s > 0 ? `↓ ${b.delta_s} s/km trop lent` : "dans la cible"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
