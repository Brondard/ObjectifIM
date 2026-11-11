"use client";

import Link from "next/link";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { inputClass, Field } from "@/components/session-form";
import { EngineRulesSettings, SubstitutionsSettings } from "@/components/engine-settings";
import { StravaSettings } from "@/components/strava-settings";
import { RetestList } from "@/components/targets";
import { BASES, DISCIPLINES, METHODS, METRICS, ZONE_SETUPS } from "@/domain/labels";
import { PRESETS, computeZones, metricAt, zoneModelAt, type Bound, type Method, type MetricKind, type ZoneModel } from "@/domain/zones";
import { formatMetric, formatRange, parseClock } from "@/lib/format";
import type { MetricRow, ZoneModelRow } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { useMetrics, useZoneModels } from "@/lib/sync/queries";
import { formatLocalDate, nowIso, today, type LocalDate } from "@/lib/time";

const PACE_KINDS = new Set(["threshold_pace", "css"]);

export default function SettingsPage() {
  const metrics = useMetrics();
  const models = useZoneModels();
  if (!metrics || !models) return null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Réglages</h1>
        <nav className="flex gap-3 text-sm underline">
          <Link href="/courses">Courses</Link>
          <Link href="/nutrition">Nutrition</Link>
          <Link href="/saisons">Saisons</Link>
        </nav>
      </header>
      <RetestList />
      <StravaSettings />
      <MetricsSection metrics={metrics} />
      <ZonesSection metrics={metrics} models={models} />
      <EngineRulesSettings />
      <SubstitutionsSettings />
    </div>
  );
}

// ─── Repères ────────────────────────────────────────────────────────────────

function MetricsSection({ metrics }: { metrics: MetricRow[] }) {
  const day = today();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Repères physiologiques</h2>
      <p className="text-sm text-neutral-500">
        Chaque mesure est datée et conservée : une séance passée reste lue avec les repères de son époque.
      </p>
      <ul className="flex flex-col gap-2">
        {(Object.keys(METRICS) as MetricKind[]).map((kind) => (
          <MetricRowView key={kind} kind={kind} history={metrics.filter((m) => m.kind === kind)} today={day} />
        ))}
      </ul>
    </section>
  );
}

function MetricRowView({ kind, history, today: day }: { kind: MetricKind; history: MetricRow[]; today: LocalDate }) {
  const engine = useSync();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [date, setDate] = useState<string>(day);
  const current = metricAt(history.map((m) => ({ ...m, value: Number(m.value) })), kind, day);
  const sorted = [...history].sort((a, b) => b.measured_on.localeCompare(a.measured_on));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = PACE_KINDS.has(kind) ? parseClock(value) : Number(value.replace(",", "."));
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) return;
    await engine.mutate("metrics", uuidv7(), { kind, value: parsed, measured_on: date, source: "manual" });
    setValue("");
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <button onClick={() => setOpen(!open)} className="flex w-full items-baseline justify-between text-left">
        <span>{METRICS[kind].label}</span>
        <span className="text-sm">
          {current ? (
            <>
              <strong>{formatMetric(kind, current.value)}</strong>
              <span className="text-neutral-500"> · {formatLocalDate(current.measured_on as LocalDate, { day: "numeric", month: "short", year: "numeric" })}</span>
            </>
          ) : (
            <span className="text-neutral-500">non renseigné</span>
          )}
        </span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <form onSubmit={(e) => void add(e)} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label={`Valeur (${METRICS[kind].unit})`}>
              <input
                inputMode={PACE_KINDS.has(kind) ? "text" : "decimal"}
                placeholder={PACE_KINDS.has(kind) ? "4:30" : ""}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Mesuré le">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
            </Field>
            <button className="h-11 rounded-md bg-foreground px-4 text-background">Ajouter</button>
          </form>
          {sorted.length > 0 && (
            <ul className="text-sm">
              {sorted.map((m) => (
                <li key={m.id} className="flex justify-between border-t border-neutral-200 py-1.5 dark:border-neutral-800">
                  <span>
                    {m.measured_on} · {formatMetric(kind, Number(m.value))}
                    {m.source !== "manual" ? ` · ${m.source}` : ""}
                  </span>
                  <button
                    onClick={() => window.confirm("Supprimer cette mesure ?") && void engine.mutate("metrics", m.id, { deleted_at: nowIso() })}
                    className="text-neutral-500 underline"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Zones ──────────────────────────────────────────────────────────────────

function ZonesSection({ metrics, models }: { metrics: MetricRow[]; models: ZoneModelRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Zones</h2>
      <p className="text-sm text-neutral-500">
        Samsung Health calcule les zones cardiaques en % simple de la FC max. Choisis la même méthode ici pour
        qu&apos;une « zone 3 » veuille dire la même chose dans l&apos;app et sur la montre. Changer de méthode crée un
        nouveau modèle daté : les séances passées gardent l&apos;ancien.
      </p>
      {ZONE_SETUPS.map((setup) => (
        <ZoneSetup
          key={`${setup.discipline}-${setup.basis}`}
          setup={setup}
          metrics={metrics}
          models={models as unknown as (ZoneModel & { id: string })[]}
        />
      ))}
    </section>
  );
}

function ZoneSetup({
  setup,
  metrics,
  models,
}: {
  setup: (typeof ZONE_SETUPS)[number];
  metrics: MetricRow[];
  models: (ZoneModel & { id: string })[];
}) {
  const day = today();
  const [editing, setEditing] = useState(false);
  const current = zoneModelAt(models, setup.discipline, setup.basis, day) as (ZoneModel & { id: string }) | null;
  const numeric = metrics.map((m) => ({ ...m, value: Number(m.value) }));
  const computed = current ? computeZones(current, numeric, day) : null;
  const title = `${DISCIPLINES[setup.discipline]} · ${BASES[setup.basis]}`;

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <button onClick={() => setEditing(!editing)} className="text-sm underline">
          {editing ? "Fermer" : current ? "Modifier" : "Configurer"}
        </button>
      </div>
      {current ? (
        <p className="text-sm text-neutral-500">
          {METHODS[current.method]} · depuis le {current.valid_from}
        </p>
      ) : (
        <p className="text-sm text-neutral-500">Non configuré : les séances n&apos;affichent pas de cible sur cette grandeur.</p>
      )}
      {computed && !computed.ok && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Repère manquant : {computed.missing.map((k) => METRICS[k].label).join(", ")}.
        </p>
      )}
      {computed?.ok && (
        <>
          <table className="mt-2 w-full text-sm tabular-nums">
            <tbody>
              {computed.zones.map((z) => (
                <tr key={z.zone} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1">Z{z.zone}</td>
                  <td className="py-1 text-right">{formatRange(setup.basis, z.min, z.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {computed.references.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              Calculé avec {computed.references.map((r) => `${METRICS[r.kind].label} ${formatMetric(r.kind, r.value)} (${r.measured_on})`).join(", ")}.
            </p>
          )}
        </>
      )}
      {editing && (
        <ZoneEditor
          setup={setup}
          models={models}
          initial={current}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function ZoneEditor({
  setup,
  models,
  initial,
  onDone,
}: {
  setup: (typeof ZONE_SETUPS)[number];
  models: (ZoneModel & { id: string })[];
  initial: ZoneModel | null;
  onDone: () => void;
}) {
  const engine = useSync();
  const [method, setMethod] = useState<Method>(initial?.method ?? setup.methods[0]);
  const [bounds, setBounds] = useState<Bound[]>(initial?.bounds ?? PRESETS[setup.methods[0]]);
  const [validFrom, setValidFrom] = useState<string>(today());

  const pct = (v: number | null) => (v == null ? "" : String(Math.round(v * 1000) / 10));
  const setBound = (i: number, key: "lo" | "hi", text: string) =>
    setBounds((b) => b.map((x, j) => (j === i ? { ...x, [key]: text === "" ? null : Number(text.replace(",", ".")) / 100 } : x)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Même date de début qu'un modèle existant : on le remplace plutôt que d'en créer un second.
    const same = models.find((m) => m.discipline === setup.discipline && m.basis === setup.basis && m.valid_from === validFrom);
    await engine.mutate("zone_models", same?.id ?? uuidv7(), {
      discipline: setup.discipline,
      basis: setup.basis,
      method,
      bounds,
      overrides: null,
      valid_from: validFrom,
    });
    onDone();
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mt-3 flex flex-col gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Méthode">
          <select
            value={method}
            onChange={(e) => {
              const m = e.target.value as Method;
              setMethod(m);
              setBounds(PRESETS[m]);
            }}
            className={inputClass}
          >
            {setup.methods.map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}
          </select>
        </Field>
        <Field label="Valable à partir du">
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      <table className="text-sm">
        <thead className="text-xs text-neutral-500">
          <tr><th className="text-left font-normal">Zone</th><th className="font-normal">de (%)</th><th className="font-normal">à (%)</th></tr>
        </thead>
        <tbody>
          {bounds.map((b, i) => (
            <tr key={b.zone}>
              <td className="py-1">Z{b.zone}</td>
              <td className="px-1 py-1"><input inputMode="decimal" value={pct(b.lo)} onChange={(e) => setBound(i, "lo", e.target.value)} className={`${inputClass} h-9`} /></td>
              <td className="px-1 py-1"><input inputMode="decimal" value={pct(b.hi)} onChange={(e) => setBound(i, "hi", e.target.value)} className={`${inputClass} h-9`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-neutral-500">Case vide : zone ouverte. Pourcentages de la référence de la méthode.</p>
      <button className="h-11 rounded-md bg-foreground font-medium text-background">Enregistrer le modèle</button>
    </form>
  );
}

