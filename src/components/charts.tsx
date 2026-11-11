"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ReactNode } from "react";

/** Étapes de la rampe des zones (Z1 → Z5), en variables CSS (voir globals.css). */
export const ZONE_STEPS = ["--viz-z1", "--viz-z2", "--viz-z3", "--viz-z4", "--viz-z5"];

const axis = { stroke: "var(--viz-grid)", tick: { fill: "var(--viz-axis)", fontSize: 11 }, tickLine: false };
const tooltipStyle = {
  contentStyle: { background: "var(--background)", border: "1px solid var(--viz-grid)", borderRadius: 6, fontSize: 12, color: "var(--foreground)" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  cursor: { fill: "var(--viz-band)", opacity: 0.6 },
};

/** Graphique + vue tableau repliable (lisible sans la couleur, au lecteur d'écran, en impression). */
export function ChartBlock({ title, children, table }: { title: string; children: ReactNode; table: ReactNode }) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div className="h-52 w-full">{children}</div>
      <details className="text-xs text-neutral-600 dark:text-neutral-400">
        <summary className="cursor-pointer">Voir en tableau</summary>
        <div className="mt-1 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

const number = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
const hours = (v: number) => `${number(v)} h`;
const hoursTick = (v: number) => hours(v);
/** Le texte de légende garde la couleur du texte ; seule la pastille porte la couleur de la série. */
const legendText = (value: string) => <span style={{ color: "var(--viz-axis)" }}>{value}</span>;

export function VolumeChart({ data }: { data: { label: string; planned: number; done: number }[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} tickFormatter={hoursTick} width={48} allowDecimals />
        <Tooltip {...tooltipStyle} formatter={(v, name) => [hours(Number(v)), String(name)]} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        <Bar dataKey="planned" name="Prévu" fill="var(--viz-planned)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="done" name="Réalisé" fill="var(--viz-done)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ZonesChart({ data, zones }: { data: Record<string, number | string>[]; zones: number }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} tickFormatter={hoursTick} width={48} allowDecimals />
        <Tooltip {...tooltipStyle} formatter={(v, name) => [hours(Number(v)), String(name)]} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        {Array.from({ length: zones }, (_, i) => (
          <Bar
            key={i}
            dataKey={`z${i + 1}`}
            name={`Z${i + 1}`}
            stackId="z"
            fill={`var(${ZONE_STEPS[i] ?? ZONE_STEPS.at(-1)})`}
            stroke="var(--background)"
            strokeWidth={1}
            maxBarSize={22}
            radius={i === zones - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LoadChart({ data }: { data: { label: string; load: number; estimated: number }[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={48} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, _n, item) => [
            `${Math.round(Number(v))} (dont ${Math.round((((item.payload as { estimated?: number })?.estimated ?? 0) / (Number(v) || 1)) * 100)} % de RPE estimé)`,
            "Charge (RPE × min)",
          ]}
        />
        <Bar dataKey="load" name="Charge" fill="var(--viz-done)" radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AcwrChart({ data, low, high }: { data: { label: string; acwr: number | null }[]; low: number; high: number }) {
  const max = Math.max(high + 0.3, ...data.map((d) => d.acwr ?? 0));
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        {/* Zone de confort entre les deux seuils d'alerte. */}
        <ReferenceArea y1={low} y2={high} fill="var(--viz-band)" fillOpacity={0.8} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...axis} domain={[0, Math.ceil(max * 10) / 10]} width={48} tickFormatter={(v) => number(v)} />
        <Tooltip {...tooltipStyle} formatter={(v) => [String(v), "Ratio aigu / chronique"]} />
        <Line
          type="monotone"
          dataKey="acwr"
          stroke="var(--viz-done)"
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
          dot={(p: { cx?: number; cy?: number; payload?: { acwr: number | null }; index?: number }) =>
            p.payload?.acwr != null && (p.payload.acwr > high || p.payload.acwr < low) ? (
              <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="var(--viz-alert)" stroke="var(--background)" strokeWidth={2} />
            ) : (
              <g key={p.index} />
            )
          }
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Profil altimétrique d'un parcours (une seule série : pas de légende, le titre la nomme). */
export function ProfileChart({ samples }: { samples: { d: number; ele: number }[] }) {
  const data = samples.map((s) => ({ km: Math.round(s.d / 100) / 10, ele: s.ele }));
  const min = Math.min(...data.map((d) => d.ele));
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="km" type="number" domain={["dataMin", "dataMax"]} {...axis} tickFormatter={(v) => `${number(v)} km`} />
        <YAxis {...axis} width={48} domain={[Math.floor(min / 10) * 10, "auto"]} tickFormatter={(v) => `${number(v)} m`} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `km ${number(Number(v))}`} formatter={(v) => [`${number(Number(v))} m`, "Altitude"]} />
        <Area dataKey="ele" type="monotone" stroke="var(--viz-done)" strokeWidth={2} fill="var(--viz-done)" fillOpacity={0.15} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
