"use client";

import { useEffect, useState } from "react";
import { SESSION_ANALYSIS_VERSION, type SessionAnalysis } from "@/domain/analysis/rigor";
import { analyzeSession, contextKey } from "@/domain/analysis/session";
import type { IntensityAnalysis } from "@/domain/intensity";
import type { Streams } from "@/domain/strava";
import type { TargetContext } from "@/domain/targets";
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
    if (res.status === 502) throw new Error((await res.json().catch(() => ({}))).error ?? "Strava indisponible");
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

/** Analyse en cache sur la séance (version courante uniquement). */
export const storedSessionAnalysis = (c: CompletedSession | null): SessionAnalysis | null => {
  const a = c?.analysis as SessionAnalysis | null | undefined;
  return a?.version === SESSION_ANALYSIS_VERSION ? a : null;
};

/** Analyse absente, d'une ancienne version, ou calculée avec d'autres repères ou zones. */
export const isStale = (c: CompletedSession, ctx: TargetContext) => storedSessionAnalysis(c)?.ctx_key !== contextKey(ctx);

export const storedAnalysis = (c: CompletedSession | null): IntensityAnalysis | null => storedSessionAnalysis(c)?.intensity ?? null;

/** Calcule l'analyse d'une séance à partir de ses flux et la garde sur la séance (synchronisée). */
export async function analyzeAndStore(
  engine: SyncEngine,
  c: CompletedSession,
  planned: PlannedSession | null,
  ctx: TargetContext,
): Promise<{ analysis: SessionAnalysis | null; reason?: string }> {
  const streams = await loadStreams(engine, c);
  if (!streams) return { analysis: null, reason: c.strava_activity_id ? "flux indisponibles (hors ligne ?)" : "séance saisie à la main, sans flux" };
  const analysis = analyzeSession(c, planned, streams, ctx);
  if (JSON.stringify(analysis) !== JSON.stringify(c.analysis)) {
    await engine.mutate("completed_sessions", c.id, { analysis });
  }
  return { analysis };
}

/** Analyse d'une séance affichée : recalculée si la cible, les repères ou la fiabilité de la FC changent. */
export function useSessionAnalysis(planned: PlannedSession | null | undefined, completion: CompletedSession | null) {
  const engine = useSync();
  const ctx = useTargetContext();
  const [state, setState] = useState<{ analysis: SessionAnalysis | null; reason?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!completion || !ctx || planned === undefined) return;
    analyzeAndStore(engine, completion, planned, ctx)
      .then((r) => !cancelled && setState(r))
      .catch((e) => !cancelled && setState({ analysis: null, reason: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [engine, planned, completion?.id, completion?.hr_reliable, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

/** Téléchargements Strava par lot : 100 lectures autorisées par quart d'heure, on en garde pour le webhook. */
export const BATCH_LIMIT = 60;

/**
 * Prépare en lot les analyses manquantes ou périmées (séances avec activité Strava). Un recalcul à partir
 * de flux déjà téléchargés ne coûte rien ; seuls les nouveaux téléchargements sont limités par lot.
 * Séquentiel, s'arrête à la première erreur Strava (limite atteinte) ; relançable sans perte.
 */
export async function prepareAnalyses(
  engine: SyncEngine,
  items: { completion: CompletedSession; planned: PlannedSession | null }[],
  ctx: TargetContext,
  onProgress: (done: number, total: number) => void,
): Promise<{ analysed: number; skipped: number; stoppedOn?: string }> {
  const todo = items.filter((i) => i.completion.strava_activity_id && isStale(i.completion, ctx));
  let analysed = 0;
  let downloads = 0;
  for (const [k, item] of todo.entries()) {
    onProgress(k, todo.length);
    const needsStrava = !item.completion.streams_path && !(await engine.db.streams.get(item.completion.id));
    if (needsStrava && downloads >= BATCH_LIMIT) {
      return { analysed, skipped: todo.length - k, stoppedOn: `${BATCH_LIMIT} téléchargements Strava atteints pour ce lot` };
    }
    if (needsStrava) downloads++;
    try {
      const r = await analyzeAndStore(engine, item.completion, item.planned, ctx);
      if (r.analysis) analysed++;
    } catch (e) {
      return { analysed, skipped: todo.length - k, stoppedOn: e instanceof Error ? e.message : String(e) };
    }
  }
  onProgress(todo.length, todo.length);
  return { analysed, skipped: 0 };
}
