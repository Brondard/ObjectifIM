"use client";

import Link from "next/link";
import { BASES, METHODS, METRICS } from "@/domain/labels";
import { retestsDue } from "@/domain/retests";
import { parseIntensity } from "@/domain/session-structure";
import { resolveTargets, type ResolvedTarget, type SessionLike, type TargetContext } from "@/domain/targets";
import { formatMetric, formatRange } from "@/lib/format";
import { useMetrics, useRaces, useTargetContext } from "@/lib/sync/queries";
import { today } from "@/lib/time";

export function useTargets(session: SessionLike): ResolvedTarget[] | undefined {
  const ctx = useTargetContext();
  return ctx ? resolveTargets(session, ctx, parseIntensity) : undefined;
}

/** Libellé court : « Z2 · 116–136 bpm ». */
export function targetLabel(t: ResolvedTarget): string {
  const zone = t.zone != null ? `Z${t.zone} ` : "";
  if (t.status === "ok") {
    const end = t.max_end ? ` (${t.max_end} bpm sur le dernier ${t.end_from_pct && t.end_from_pct >= 60 && t.end_from_pct <= 70 ? "tiers" : `${100 - (t.end_from_pct ?? 67)} %`})` : "";
    return `${zone}${t.zone != null ? "· " : ""}${formatRange(t.basis, t.min, t.max)}${end}`;
  }
  return zone.trim();
}

/** Le contexte qui donne son sens au chiffre : méthode et repères à la date de la séance. */
function targetContext(t: ResolvedTarget): string {
  const origin = t.source === "ceiling" ? "plafond de footing (Réglages → règle easy_hr_ceilings)" : t.source === "default" ? "cible par défaut du type de séance" : "cible de la séance";
  if (t.status === "no_model") return `${origin} · zones ${BASES[t.basis]} non configurées`;
  if (t.status === "missing_metrics") return `${origin} · repère manquant : ${t.missing.map((k) => METRICS[k].label).join(", ")}`;
  if (!t.method) return origin;
  const refs = t.references.map((r) => `${METRICS[r.kind].label} ${formatMetric(r.kind, r.value)} du ${r.measured_on}`).join(", ");
  return `${origin} · ${METHODS[t.method]}${refs ? ` · ${refs}` : ""}`;
}

/** Cibles d'une séance en valeurs absolues, avec leur contexte. */
export function TargetLines({ session, compact = false }: { session: SessionLike; compact?: boolean }) {
  const targets = useTargets(session);
  if (!targets?.length) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {targets.map((t) => (
        <li key={t.basis} className="text-sm">
          <span className={t.status === "ok" ? "font-medium" : "text-amber-700 dark:text-amber-400"}>
            {BASES[t.basis]} {targetLabel(t)}
          </span>
          {!compact && <span className="block text-xs text-neutral-500">{targetContext(t)}</span>}
          {t.status !== "ok" && !compact && (
            <Link href="/reglages" className="text-xs underline">Configurer</Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Étiquette de zone pour la vue Semaine (« Z2 »). */
export function ZoneTag({ session }: { session: SessionLike }) {
  const t = useTargets(session)?.[0];
  if (!t || t.zone == null) return null;
  return <span className="text-neutral-500">Z{t.zone}</span>;
}

/** Résout une cible d'étape de structure avec le même contexte. */
export function resolveStep(session: SessionLike, intensity: unknown, ctx: TargetContext | undefined) {
  const parsed = parseIntensity(intensity);
  if (!parsed || !ctx) return null;
  return resolveTargets({ ...session, target_intensity: parsed }, ctx, parseIntensity)[0] ?? null;
}

/** Retests à faire : rappel factuel, pas d'injonction. */
export function RetestList({ includeMissing = true }: { includeMissing?: boolean }) {
  const metrics = useMetrics();
  const races = useRaces();
  if (!metrics || !races) return null;
  const due = retestsDue(metrics.map((m) => ({ ...m, value: Number(m.value) })), races, today()).filter(
    (r) => includeMissing || !r.key.endsWith(":none"),
  );
  if (!due.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {due.map((r) => (
        <li key={r.key} className="rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
          {r.message} <Link href="/reglages" className="underline">Repères</Link>
        </li>
      ))}
    </ul>
  );
}
