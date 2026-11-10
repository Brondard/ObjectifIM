"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { LocalDb } from "./db";
import { SyncEngine } from "./engine";

const SyncContext = createContext<SyncEngine | null>(null);

/** Ouvre la base locale du compte connecté et démarre la synchronisation. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let current: SyncEngine | null = null;
    let cancelled = false;
    // getSession lit le cookie local : fonctionne sans réseau.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }
      current = new SyncEngine(new LocalDb(data.session.user.id), supabase);
      current.start();
      setEngine(current);
    });
    return () => {
      cancelled = true;
      current?.stop();
      current?.db.close();
    };
  }, [router]);

  if (!engine) return <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Chargement…</div>;
  return <SyncContext value={engine}>{children}</SyncContext>;
}

export function useSync(): SyncEngine {
  const engine = use(SyncContext);
  if (!engine) throw new Error("useSync doit être utilisé sous <SyncProvider>");
  return engine;
}

export function useSyncStatus() {
  const engine = useSync();
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
}
