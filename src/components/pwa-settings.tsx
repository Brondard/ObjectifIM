"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { v5 as uuidv5 } from "uuid";
import { useSync, useSyncStatus } from "@/lib/sync/provider";
import { nowIso } from "@/lib/time";

type InstallEvent = Event & { prompt: () => Promise<void> };

/** Clé publique VAPID (base64url) → octets attendus par pushManager.subscribe. */
function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Installation, hors ligne, notifications et agenda : ce qui rend l'app utilisable au bord de la piscine. */
export function PwaSettings() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Téléphone et agenda</h2>
      <InstallAndOffline />
      <Notifications />
      <CalendarFeed />
    </section>
  );
}

function InstallAndOffline() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [standalone] = useState(() => window.matchMedia("(display-mode: standalone)").matches);
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration().then((r) => setOfflineReady(!!r?.active));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <p>
        {standalone ? "Application installée." : "Pas encore installée sur cet appareil."}{" "}
        {offlineReady ? "Disponible hors ligne : les écrans et tes données sont gardés sur l'appareil." : "Le hors ligne s'active après une première visite de l'app déployée."}
      </p>
      {!standalone && (installEvent ? (
        <button onClick={() => void installEvent.prompt().then(() => setInstallEvent(null))} className="h-10 self-start rounded-md bg-foreground px-4 text-background">
          Installer l&apos;application
        </button>
      ) : (
        <p className="text-neutral-500">Sur Android avec Chrome : menu ⋮ → « Installer l&apos;application » (ou « Ajouter à l&apos;écran d&apos;accueil »).</p>
      ))}
    </div>
  );
}

function Notifications() {
  const engine = useSync();
  const { online } = useSyncStatus();
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const rule = useLiveQuery(async () => (await engine.db.engine_rules.where("rule_key").equals("notifications").toArray()).find((r) => !r.deleted_at) ?? null, [engine.db]);
  const prefs = { evening_preview: true, evening_unmarked: true, weekly_review: true, ...((rule?.params ?? {}) as object) } as { evening_preview: boolean; evening_unmarked: boolean; weekly_review: boolean };

  useEffect(() => {
    if (!supported()) return;
    void navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => setEndpoint(s?.endpoint ?? null));
  }, []);

  if (!supported() || !publicKey) {
    return <p className="text-sm text-neutral-500">Notifications indisponibles sur ce navigateur{publicKey ? "" : " (clé VAPID non configurée)"}.</p>;
  }

  async function enable() {
    setMessage(null);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setMessage("Notifications refusées par le navigateur. Elles se réactivent dans les réglages du site.");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await engine.mutate("push_subscriptions", uuidv5(json.endpoint, engine.db.userId), {
      endpoint: json.endpoint,
      keys: json.keys,
      device_label: /Android/i.test(navigator.userAgent) ? "Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iOS" : "Ordinateur",
      deleted_at: null,
    });
    setEndpoint(json.endpoint);
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await engine.mutate("push_subscriptions", uuidv5(sub.endpoint, engine.db.userId), { deleted_at: nowIso() });
      await sub.unsubscribe();
    }
    setEndpoint(null);
  }

  const toggle = (k: "evening_preview" | "evening_unmarked" | "weekly_review") =>
    rule && void engine.mutate("engine_rules", rule.id, { params: { ...prefs, [k]: !prefs[k] } });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <p>Notifications du soir (vers 20 h l&apos;hiver, 21 h l&apos;été) : factuelles, jamais de relance culpabilisante.</p>
      {endpoint === undefined ? null : endpoint ? (
        <button onClick={() => void disable()} className="h-10 self-start rounded-md border border-neutral-300 px-4 dark:border-neutral-700">Désactiver sur cet appareil</button>
      ) : (
        <button onClick={() => void enable()} disabled={!online} className="h-10 self-start rounded-md bg-foreground px-4 text-background disabled:opacity-50">Activer sur cet appareil</button>
      )}
      {message && <p className="text-amber-700 dark:text-amber-400">{message}</p>}
      {rule && (
        <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.evening_preview} onChange={() => toggle("evening_preview")} className="h-5 w-5" /> La veille au soir : contenu précis de la séance du lendemain</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.evening_unmarked} onChange={() => toggle("evening_unmarked")} className="h-5 w-5" /> Le soir : séance du jour ni validée ni marquée manquée</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.weekly_review} onChange={() => toggle("weekly_review")} className="h-5 w-5" /> Le dimanche soir : revue de la semaine</label>
        </>
      )}
    </div>
  );
}

function CalendarFeed() {
  const engine = useSync();
  const { online } = useSyncStatus();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!online) return;
    void engine.supabase.rpc("ics_token").then(({ data }) => setToken((data as string | null) ?? null));
  }, [engine, online]);

  if (!online) return <p className="text-sm text-neutral-500">Lien d&apos;agenda : disponible avec du réseau.</p>;
  if (!token) return null;
  const url = `${window.location.origin}/api/ics/${token}.ics`;

  async function rotate() {
    if (!window.confirm("Générer un nouveau lien ? L'ancien cessera de fonctionner dans les agendas abonnés.")) return;
    const { data } = await engine.supabase.rpc("rotate_ics_token");
    setToken((data as string | null) ?? token);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <p>Agenda : abonne ton agenda à ce lien pour voir les séances prévues (mis à jour toutes les heures environ). Garde-le privé.</p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 rounded border border-neutral-300 bg-transparent px-2 font-mono text-xs dark:border-neutral-700" aria-label="Lien d'abonnement ICS" />
      <div className="flex flex-wrap gap-3">
        <button onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))} className="underline">{copied ? "Copié" : "Copier le lien"}</button>
        <a href={url.replace(/^https?:/, "webcal:")} className="underline">S&apos;abonner</a>
        <button onClick={() => void rotate()} className="text-neutral-500 underline">Nouveau lien</button>
      </div>
      <p className="text-xs text-neutral-500">Google Agenda : Autres agendas → « À partir de l&apos;URL » → coller le lien.</p>
    </div>
  );
}
