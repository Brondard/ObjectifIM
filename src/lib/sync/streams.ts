"use client";

import { useEffect, useState } from "react";
import { analyzeIntensity, ANALYSIS_VERSION, EASY_TYPES, type IntensityAnalysis } from "@/domain/intensity";
import { parseIntensity } from "@/domain/session-structure";
import type { Streams } from "@/domain/strava";
import { resolveTargets, type TargetContext } from "@/domain/targets";
import type { CompletedSession, PlannedSession } from "./db";
import type { SyncEngine } from "./engine";
import { useSync } from "./provider";
import { useTargetContext } from "./queries";

/**
 * Flux d'une séance importée : cache local d'abord, sinon Storage (après téléchargement
 * depuis Strava par le serveur si besoin). Null hors ligne ou sans activité Strava.
 */
export async function loadStreams(engine: SyncEngine, c: CompletedSession): Promise<Streams | null> {
  const cached = await engine.db.streams.get(c.id);
  if (cached) return cached.data;
  if (!c.strava_activity_id || !navigator.onLine) return null;

  let path = c.streams_path;
  if (!path) {
    const res = await fetch("/api/strava/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed_id: c.id }),
    });
    if (!res.ok) return null;
    path = (await res.json()).path;
    if (!path) return null;
  }
  const { data: blob, error } = await engine.supabase.storage.from("streams").download(path);
  if (error || !blob) return null;
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const data = JSON.parse(text) as Streams;
  await engine.db.streams.put({ id: c.id, data });
  return data;
}

type Inputs = { judged: string; reason?: string };

/**
 * Cible absolue sur laquelle juger la séance, selon l'arbitrage 7. Si la FC est déclarée aberrante,
 * l'allure reprend la main quand elle a une cible ; sinon seul le RPE reste.
 */
export function analysisTarget(planned: PlannedSession, completion: CompletedSession, ctx: TargetContext) {
  const targets = resolveTargets(planned, ctx, parseIntensity).filter((t) => t.status === "ok");
  const usable = completion.hr_reliable === false ? targets.filter((t) => t.basis !== "hr") : targets;
  const t = usable[0];
  return t && t.status === "ok" ? { basis: t.basis, min: t.min, max: t.max } : null;
}

/**
 * Analyse d'intensité d'une séance réalisée rattachée : calculée sur les flux, puis mise en cache
 * dans completed_sessions.analysis (synchronisée) pour les vues qui n'ont pas les flux.
 */
export function useIntensityAnalysis(planned: PlannedSession | null | undefined, completion: CompletedSession | null) {
  const engine = useSync();
  const ctx = useTargetContext();
  const [state, setState] = useState<{ analysis: IntensityAnalysis | null; info: Inputs } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!planned || !completion || !ctx) return;
      const target = analysisTarget(planned, completion, ctx);
      if (!target) return setState({ analysis: null, info: { judged: "", reason: "aucune cible exploitable" } });
      const streams = await loadStreams(engine, completion);
      if (cancelled) return;
      if (!streams) return setState({ analysis: null, info: { judged: target.basis, reason: "flux indisponibles" } });
      const analysis = analyzeIntensity(streams, target, EASY_TYPES.has(planned.session_type), ctx.rules.intensity);
      setState({ analysis, info: { judged: target.basis } });
      if (analysis && JSON.stringify(analysis) !== JSON.stringify(completion.analysis)) {
        await engine.mutate("completed_sessions", completion.id, { analysis });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // Recalcul si la cible, les repères ou le statut de la FC changent.
  }, [engine, planned, completion?.id, completion?.hr_reliable, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

export const storedAnalysis = (c: CompletedSession | null): IntensityAnalysis | null => {
  const a = c?.analysis as IntensityAnalysis | null | undefined;
  return a?.version === ANALYSIS_VERSION ? a : null;
};
