"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useConflicts, usePendingCount, useRejections } from "@/lib/sync/queries";
import { useSync, useSyncStatus } from "@/lib/sync/provider";

const NAV = [
  { href: "/", label: "Aujourd'hui" },
  { href: "/semaine", label: "Semaine" },
  { href: "/seance/nouvelle", label: "Ajouter" },
  { href: "/analyse", label: "Analyse" },
  { href: "/reglages", label: "Réglages" },
];

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <SyncBar />
      <ConflictPanel />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex h-14 items-center justify-center text-xs sm:text-sm ${active ? "font-semibold" : "text-neutral-500"}`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** État de la synchronisation, factuel et discret. */
function SyncBar() {
  const status = useSyncStatus();
  const pending = usePendingCount();
  const engine = useSync();
  let text: string | null = null;
  if (!status.online) text = pending ? `Hors ligne · ${pending} modification(s) en attente` : "Hors ligne";
  else if (status.error) text = `Synchro en échec : ${status.error}`;
  else if (pending) text = `${pending} modification(s) en attente`;
  if (!text) return null;
  return (
    <button
      onClick={() => void engine.sync()}
      className="w-full bg-neutral-100 px-4 py-1.5 text-center text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
    >
      {text}
    </button>
  );
}

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "vide";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Les conflits ne sont jamais tranchés en silence : on demande. */
function ConflictPanel() {
  const engine = useSync();
  const conflicts = useConflicts();
  const rejections = useRejections();
  if (!conflicts.length && !rejections.length) return null;
  return (
    <div className="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-2 px-4">
      {conflicts.map((c) => (
        <div key={c.key} className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <p>
            Conflit sur <strong>{c.field}</strong> ({c.table}) : modifié ailleurs pendant que tu modifiais ici.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void engine.resolveConflict(c.key, "mine")} className="rounded border px-2 py-1">
              Garder la mienne : {show(c.client)}
            </button>
            <button onClick={() => void engine.resolveConflict(c.key, "server")} className="rounded border px-2 py-1">
              Garder l&apos;autre : {show(c.server)}
            </button>
          </div>
        </div>
      ))}
      {rejections.map((r) => (
        <div key={r.mutation_id} className="rounded-md border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950">
          <p>Modification refusée par le serveur ({r.table}) : {r.message}</p>
          <button onClick={() => void engine.db.rejections.delete(r.mutation_id)} className="mt-2 rounded border px-2 py-1">
            Compris
          </button>
        </div>
      ))}
    </div>
  );
}
