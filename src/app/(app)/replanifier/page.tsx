"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import { planApply } from "@/domain/engine/apply";
import { propose } from "@/domain/engine/generate";
import type { Change, EngineSession, Option, Proposal, Trigger } from "@/domain/engine/types";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { formatDuration } from "@/lib/format";
import { useSync } from "@/lib/sync/provider";
import { useEngineContext } from "@/lib/sync/queries";
import { addDays, formatLocalDate, isLocalDate, today, type LocalDate } from "@/lib/time";

const KINDS = {
  unavailable: "Indisponible",
  sick: "Malade ou blessé",
  travel: "En déplacement",
  move: "Déplacer une séance",
  short_time: "Moins de temps",
  missed: "Séance manquée",
} as const;
type Kind = keyof typeof KINDS;

export default function ReplanPage() {
  return (
    <Suspense>
      <Replan />
    </Suspense>
  );
}

const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "long", day: "numeric", month: "long" });
const short = (d: string) => formatLocalDate(d as LocalDate, { weekday: "short", day: "numeric" });

function Replan() {
  const params = useSearchParams();
  const router = useRouter();
  const engine = useSync();
  const now = today();
  const [kind, setKind] = useState<Kind>((params.get("kind") as Kind) in KINDS ? (params.get("kind") as Kind) : "unavailable");
  const [sessionId, setSessionId] = useState(params.get("session") ?? "");
  const [from, setFrom] = useState<string>(params.get("from") ?? now);
  const [to, setTo] = useState<string>(params.get("to") ?? addDays(now, 1));
  const [days, setDays] = useState("3");
  const [injury, setInjury] = useState(false);
  const [minutes, setMinutes] = useState("45");
  const [toDay, setToDay] = useState("");
  const [noBike, setNoBike] = useState(true);
  const [noPool, setNoPool] = useState(true);
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applied, setApplied] = useState(false);

  const anchorParam = params.get("d");
  const ctx = useEngineContext((anchorParam && isLocalDate(anchorParam) ? anchorParam : from && isLocalDate(from) ? from : now) as LocalDate);
  const sessions = useMemo(() => ctx?.sessions ?? [], [ctx]);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const pickable = sessions.filter((s) => s.date >= addDays(now, -7)).sort((a, b) => a.date.localeCompare(b.date));

  function trigger(): Trigger | null {
    switch (kind) {
      case "unavailable":
        return isLocalDate(from) && isLocalDate(to) && to >= from ? { kind, from, to, reason: reason || undefined } : null;
      case "sick":
        return isLocalDate(from) && Number(days) > 0 ? { kind, from, days: Number(days), injury } : null;
      case "travel":
        return isLocalDate(from) && isLocalDate(to) && to >= from ? { kind, from, to, noBike, noPool } : null;
      case "move":
        return sessionId ? { kind, sessionId, to: toDay || undefined } : null;
      case "short_time":
        return sessionId && Number(minutes) > 0 ? { kind, sessionId, minutes: Number(minutes) } : null;
      case "missed":
        return sessionId ? { kind, sessionId } : null;
    }
  }

  async function choose(option: Option) {
    if (!proposal || !ctx) return;
    const writes = planApply(proposal, option, ctx.sessions, uuidv7(), reason || null);
    await engine.mutateMany(writes);
    setApplied(true);
    router.push(`/semaine?d=${proposal.weekStart}`);
  }

  const needsSession = kind === "move" || kind === "short_time" || kind === "missed";

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Replanifier</h1>

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3" role="radiogroup" aria-label="Situation">
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setProposal(null);
            }}
            className={`h-11 rounded-md text-sm ${kind === k ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {KINDS[k]}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = trigger();
          if (t && ctx) setProposal(propose(ctx, t));
        }}
      >
        {needsSession ? (
          <Field label="Séance">
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={inputClass} required>
              <option value="" disabled>Choisir…</option>
              {pickable.map((s) => (
                <option key={s.id} value={s.id}>
                  {short(s.date)} · {s.title ?? SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES] ?? s.session_type} · {formatDuration(s.target_duration_s)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === "sick" ? "Depuis le" : "Du"}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} required />
            </Field>
            {kind === "sick" ? (
              <Field label="Pour (jours)">
                <input type="number" inputMode="numeric" min={1} value={days} onChange={(e) => setDays(e.target.value)} className={inputClass} required />
              </Field>
            ) : (
              <Field label="Au">
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass} required />
              </Field>
            )}
          </div>
        )}
        {kind === "sick" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} className="h-5 w-5" /> Blessure (plutôt que maladie)
          </label>
        )}
        {kind === "travel" && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={noBike} onChange={(e) => setNoBike(e.target.checked)} className="h-5 w-5" /> Sans vélo</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={noPool} onChange={(e) => setNoPool(e.target.checked)} className="h-5 w-5" /> Sans piscine</label>
          </div>
        )}
        {kind === "move" && (
          <Field label="Jour souhaité (facultatif)">
            <input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={inputClass} />
          </Field>
        )}
        {kind === "short_time" && (
          <Field label="Temps disponible (min)">
            <input type="number" inputMode="numeric" min={10} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputClass} required />
          </Field>
        )}
        {(kind === "unavailable" || kind === "travel") && (
          <Field label="Raison (facultatif, gardée dans le journal)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </Field>
        )}
        <button className="h-12 rounded-md bg-foreground font-medium text-background" disabled={!ctx}>
          Proposer des options
        </button>
      </form>

      {proposal && (
        <section className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">Semaine du {fr(proposal.weekStart)}. Rien n&apos;est appliqué sans ton choix.</p>
          {proposal.notes.map((n) => (
            <p key={n} className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{n}</p>
          ))}
          {proposal.options.map((o, i) => (
            <OptionCard key={o.key} index={i} option={o} byId={byId} onChoose={() => void choose(o)} disabled={applied} />
          ))}
          {proposal.eliminated.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-medium">Options écartées par les règles dures</h2>
              {proposal.eliminated.map((e) => (
                <div key={e.key} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <p className="font-medium">{e.title}</p>
                  <ul className="list-disc pl-5 text-neutral-600 dark:text-neutral-400">
                    {e.reasons.map((r, j) => <li key={j}>{r.label} : {r.detail}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function describe(c: Change, s: EngineSession | undefined): string {
  const name = s?.title ?? (s ? SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES] ?? s.session_type : "séance");
  switch (c.kind) {
    case "move":
      return `${name} : ${c.reopen ? "rattrapée" : "déplacée"} ${short(c.from)} → ${short(c.to)}`;
    case "drop":
      return `${name} : supprimée (${short(s?.date ?? "")})`;
    case "shorten":
      return `${name} : ${formatDuration(c.from_s)} → ${formatDuration(c.to_s)}`;
    case "substitute":
      return `${name} → ${c.label} (${formatDuration(c.duration_s)}). Ce qu'on perd : ${c.loss}`;
  }
}

function OptionCard({
  index, option: o, byId, onChoose, disabled,
}: {
  index: number;
  option: Option;
  byId: Map<string, EngineSession>;
  onChoose: () => void;
  disabled: boolean;
}) {
  const disciplines = [...new Set([...Object.keys(o.volumeBefore), ...Object.keys(o.volumeAfter)])];
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <header>
        <p className="text-xs text-neutral-500">Option {String.fromCharCode(65 + index)}</p>
        <h2 className="text-lg font-semibold">{o.title}</h2>
        <p className="text-sm">{o.explanation}</p>
      </header>

      {o.changes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {o.changes.map((c) => <li key={`${c.kind}-${c.id}`}>• {describe(c, byId.get(c.id))}</li>)}
        </ul>
      )}

      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-neutral-500">
          <tr><th className="font-normal">Volume prévu</th><th className="text-right font-normal">Avant</th><th className="text-right font-normal">Après</th></tr>
        </thead>
        <tbody>
          {disciplines.map((d) => (
            <tr key={d} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="py-1">{DISCIPLINES[d as keyof typeof DISCIPLINES] ?? d}</td>
              <td className="py-1 text-right">{formatDuration(o.volumeBefore[d] ?? 0)}</td>
              <td className="py-1 text-right">{formatDuration(o.volumeAfter[d] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-sm">
        Ratio de charge aiguë / chronique : {o.acwrBefore ?? "—"} → <strong>{o.acwrAfter ?? "—"}</strong>
        {o.acwrBefore == null && <span className="text-neutral-500"> (pas assez d&apos;historique)</span>}
      </p>

      {o.soft.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">Règles souples enfreintes (pénalité {o.penalty})</p>
          <ul className="list-disc pl-5 text-neutral-600 dark:text-neutral-400">
            {o.soft.map((v, i) => <li key={i}>{v.label} : {v.detail}</li>)}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Aucune règle souple enfreinte.</p>
      )}

      {o.alerts.map((a) => <p key={a} className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{a}</p>)}

      <button onClick={onChoose} disabled={disabled} className="h-12 rounded-md bg-foreground font-medium text-background disabled:opacity-50">
        Choisir cette option
      </button>
    </article>
  );
}
