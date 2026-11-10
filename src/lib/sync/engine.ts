import type { SupabaseClient } from "@supabase/supabase-js";
import { v7 as uuidv7 } from "uuid";
import type { Database, Json } from "@/lib/supabase/database.types";
import { now } from "@/lib/time";
import {
  PULL_PAGE,
  PULL_TABLES,
  compactOutbox,
  isRejection,
  maxRev,
  overlayPending,
  pullFrom,
  type CompactedMutation,
  type Fields,
  type MutationResult,
  type WritableTable,
} from "./core";
import type { LocalDb } from "./db";

export type SyncStatus = {
  online: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
};

const PUSH_CHUNK = 50;
const INTERVAL_MS = 60_000;

/**
 * Écritures locales immédiates + file d'attente envoyée au serveur dès que le réseau le permet.
 * Toute écriture de l'interface passe par `mutate` : jamais d'appel direct à Supabase.
 */
export class SyncEngine {
  private status: SyncStatus = { online: true, syncing: false, lastSyncAt: null, error: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private stops: (() => void)[] = [];

  constructor(
    readonly db: LocalDb,
    private supabase: SupabaseClient<Database>,
  ) {}

  // ─── État observable (useSyncExternalStore) ──────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = () => this.status;

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ─── Cycle de vie ────────────────────────────────────────────────────────

  start() {
    const onOnline = () => {
      this.setStatus({ online: true });
      void this.sync();
    };
    const onOffline = () => this.setStatus({ online: false });
    const onVisible = () => document.visibilityState === "visible" && void this.sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => void this.sync(), INTERVAL_MS);
    this.stops.push(
      () => window.removeEventListener("online", onOnline),
      () => window.removeEventListener("offline", onOffline),
      () => document.removeEventListener("visibilitychange", onVisible),
      () => clearInterval(interval),
    );
    this.setStatus({ online: navigator.onLine });
    void this.sync();
  }

  stop() {
    this.stops.forEach((s) => s());
    this.stops = [];
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }

  // ─── Écriture ────────────────────────────────────────────────────────────

  /** Écrit localement tout de suite, puis met le patch en file d'attente. */
  mutate(table: WritableTable, id: string, fields: Fields) {
    return this.mutateMany([{ table, id, fields }]);
  }

  /** Plusieurs écritures dans une même transaction locale (ex. séance faite + réalisé créé). */
  async mutateMany(items: { table: WritableTable; id: string; fields: Fields }[]) {
    await this.db.transaction("rw", [this.db.outbox, ...new Set(items.map((i) => this.db.rows(i.table)))], async () => {
      for (const item of items) {
        const ts = now().getTime();
        const rows = this.db.rows(item.table);
        const current = await rows.get(item.id);
        const base: Fields = {};
        if (current) for (const k of Object.keys(item.fields)) base[k] = current[k] ?? null;
        await rows.put({ ...(current ?? { id: item.id, deleted_at: null }), ...item.fields, id: item.id });
        await this.db.outbox.add({ mutation_id: uuidv7(), table: item.table, id: item.id, fields: item.fields, base, ts });
      }
    });
    this.schedulePush();
  }

  private schedulePush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync(), 400);
  }

  // ─── Synchronisation ─────────────────────────────────────────────────────

  /** Envoie la file puis récupère les changements. Un seul cycle à la fois. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      if (!navigator.onLine) {
        this.setStatus({ online: false });
        return;
      }
      this.setStatus({ syncing: true });
      try {
        do {
          this.again = false;
          await this.push();
          await this.pull();
        } while (this.again);
        this.setStatus({ syncing: false, lastSyncAt: now().getTime(), error: null, online: true });
      } catch (e) {
        this.setStatus({ syncing: false, error: e instanceof Error ? e.message : String(e) });
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async push() {
    const entries = await this.db.outbox.orderBy("seq").toArray();
    const batch = compactOutbox(entries);
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const chunk = batch.slice(i, i + PUSH_CHUNK);
      const { data, error } = await this.rpc(chunk);
      if (!error) {
        await this.applyResults(chunk, data);
        continue;
      }
      if (!isRejection(error)) throw new Error(`Synchro interrompue : ${error.message}`);
      // Un patch du lot est refusé par la base : on les renvoie un par un pour isoler le fautif.
      for (const m of chunk) {
        const single = await this.rpc([m]);
        if (!single.error) await this.applyResults([m], single.data);
        else if (isRejection(single.error)) await this.reject(m, single.error.message);
        else throw new Error(`Synchro interrompue : ${single.error.message}`);
      }
    }
  }

  private rpc(mutations: CompactedMutation[]) {
    const payload = mutations.map(({ mutation_id, table, id, fields, base, ts }) => ({ mutation_id, table, id, fields, base, ts }));
    return this.supabase.rpc("apply_mutations", { mutations: payload as unknown as Json }) as unknown as Promise<{
      data: MutationResult[] | null;
      error: { code?: string; message: string } | null;
    }>;
  }

  private async applyResults(chunk: CompactedMutation[], results: MutationResult[] | null) {
    const tables = [...new Set(chunk.map((m) => this.db.rows(m.table)))];
    await this.db.transaction("rw", [this.db.outbox, this.db.conflicts, ...tables], async () => {
      for (const [i, m] of chunk.entries()) {
        const r = results?.[i];
        await this.db.outbox.bulkDelete(m.seqs);
        if (!r) continue;
        const pending = await this.db.outbox.where({ table: m.table, id: m.id }).toArray();
        await this.db.rows(m.table).put(overlayPending(r.row, pending) as never);
        for (const c of r.conflicts) {
          await this.db.conflicts.put({
            key: `${m.table}:${m.id}:${c.field}`,
            table: m.table,
            id: m.id,
            field: c.field,
            server: c.server,
            client: c.client,
            at: now().getTime(),
          });
        }
      }
    });
  }

  /** Patch refusé par la base : retiré de la file, ligne locale ramenée à l'état serveur. */
  private async reject(m: CompactedMutation, message: string) {
    const { data } = await this.supabase.from(m.table).select("*").eq("id", m.id).maybeSingle();
    await this.db.transaction("rw", [this.db.outbox, this.db.rejections, this.db.rows(m.table)], async () => {
      await this.db.outbox.bulkDelete(m.seqs);
      await this.db.rejections.put({
        mutation_id: m.mutation_id, table: m.table, id: m.id, fields: m.fields, message, at: now().getTime(),
      });
      if (data) await this.db.rows(m.table).put(data as never);
      else await this.db.rows(m.table).delete(m.id);
    });
  }

  private async pull() {
    for (const table of PULL_TABLES) {
      const key = `cursor:${table}`;
      let cursor = ((await this.db.meta.get(key))?.value as number | undefined) ?? 0;
      for (;;) {
        const { data, error } = await this.supabase
          .from(table)
          .select("*")
          .gt("_rev", pullFrom(cursor))
          .order("_rev")
          .limit(PULL_PAGE);
        if (error) throw new Error(`Lecture ${table} : ${error.message}`);
        const rows = data as unknown as (Fields & { id: string; _rev: number })[];
        if (rows.length) {
          await this.db.transaction("rw", [this.db.outbox, this.db.meta, this.db.rows(table)], async () => {
            const pending = await this.db.outbox.where("table").equals(table).toArray();
            await this.db
              .rows(table)
              .bulkPut(rows.map((r) => overlayPending(r, pending.filter((e) => e.id === r.id))));
            cursor = maxRev(rows, cursor);
            await this.db.meta.put({ key, value: cursor });
          });
        }
        if (rows.length < PULL_PAGE) break;
      }
    }
  }

  // ─── Conflits ────────────────────────────────────────────────────────────

  async resolveConflict(key: string, keep: "mine" | "server") {
    const c = await this.db.conflicts.get(key);
    if (!c) return;
    await this.db.conflicts.delete(key);
    // La ligne locale porte déjà la valeur serveur : réécrire la mienne avec cette base passe sans conflit.
    if (keep === "mine") await this.mutate(c.table as WritableTable, c.id, { [c.field]: c.client });
  }
}
