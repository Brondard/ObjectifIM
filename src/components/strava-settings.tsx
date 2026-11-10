"use client";

import { useCallback, useEffect, useState } from "react";
import { useSync, useSyncStatus } from "@/lib/sync/provider";

type Status = {
  athlete_id: number;
  scopes: string[];
  connected_at: string;
  last_import_at: string | null;
  last_event_at: string | null;
  failed_events: number;
};

const RETURN_MESSAGES: Record<string, string> = {
  ok: "Strava est connecté. Les nouvelles activités arriveront seules ; importe l'historique une fois.",
  refus: "Autorisation refusée sur Strava.",
  portee: "Strava n'a pas accordé la lecture de toutes les activités : coche « Voir les données de vos activités privées » et recommence.",
  etat: "Le retour de Strava n'a pas pu être vérifié. Recommence la connexion.",
  erreur: "La connexion à Strava a échoué. Recommence plus tard.",
};

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(Date.parse(iso)) : "jamais";

/** Connexion Strava, import de l'historique et état du webhook. Nécessite le réseau. */
export function StravaSettings() {
  const engine = useSync();
  const { online } = useSyncStatus();
  const [status, setStatus] = useState<Status | null | undefined>(undefined);
  // Retour de /api/strava/callback (?strava=ok|refus|…). Rendu côté client uniquement, sous SyncProvider.
  const [message, setMessage] = useState<string | null>(
    () => RETURN_MESSAGES[new URLSearchParams(window.location.search).get("strava") ?? ""] ?? null,
  );
  const [importing, setImporting] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void engine.supabase.rpc("strava_status").then(({ data, error }) => {
      if (!cancelled) setStatus(error ? undefined : ((data?.[0] as Status | undefined) ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [engine, online, version]);

  async function importHistory() {
    for (let page = 1; ; page++) {
      setImporting(`Import en cours : page ${page}…`);
      const res = await fetch(`/api/strava/import?page=${page}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImporting(null);
        setMessage(`Import interrompu : ${json.error ?? res.status}. Relance-le, il reprend sans doublon.`);
        break;
      }
      if (json.done) {
        setImporting(null);
        setMessage(`Historique importé (${(page - 1) * 100 + json.imported} activités au plus). Les flux se chargent à l'ouverture d'une séance.`);
        break;
      }
    }
    await engine.sync();
    refresh();
  }

  async function disconnect() {
    if (!window.confirm("Déconnecter Strava ? Les séances déjà importées sont conservées.")) return;
    await fetch("/api/strava/disconnect", { method: "POST" });
    refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Strava</h2>
      {message && <p className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{message}</p>}
      {!online ? (
        <p className="text-sm text-neutral-500">Hors ligne : état Strava indisponible.</p>
      ) : status === undefined ? null : status === null ? (
        <a href="/api/strava/connect" className="flex h-11 items-center justify-center rounded-md bg-[#fc4c02] font-medium text-white">
          Connecter Strava
        </a>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Connecté (athlète {status.athlete_id}) depuis le {fmt(status.connected_at)}.
          </p>
          <p className="text-neutral-500">
            Dernier événement reçu : {fmt(status.last_event_at)} · Import de l&apos;historique : {fmt(status.last_import_at)}
          </p>
          {status.failed_events > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {status.failed_events} événement(s) en échec, retentés automatiquement chaque nuit.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void importHistory()}
              disabled={!!importing}
              className="h-10 rounded-md border border-neutral-300 px-3 disabled:opacity-50 dark:border-neutral-700"
            >
              {importing ?? "Importer l'historique"}
            </button>
            <button onClick={() => void disconnect()} className="h-10 px-3 text-neutral-500 underline">
              Déconnecter
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
