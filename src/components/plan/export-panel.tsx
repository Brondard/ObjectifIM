"use client";

import { useState } from "react";
import { buildExport } from "@/domain/plan/export";
import { Field, inputClass } from "@/components/session-form";
import { useSync } from "@/lib/sync/provider";
import { addDays, nowIso, today, weekStart, type LocalDate } from "@/lib/time";

/** Export d'une période pour construire le bloc suivant : téléchargement JSON ou copie. */
export function ExportPanel() {
  const engine = useSync();
  const { db } = engine;
  const end = addDays(weekStart(today()), -1);
  const [from, setFrom] = useState<string>(addDays(end, -27));
  const [to, setTo] = useState<string>(end);
  const [json, setJson] = useState<string | null>(null);

  async function build() {
    const [planned, completed, niggles, entries, logs, rules, races] = await Promise.all([
      db.planned_sessions.where("date").between(from, to, true, true).toArray(),
      db.completed_sessions.where("local_date").between(addDays(from as LocalDate, -28), to, true, true).toArray(),
      db.niggles.toArray(),
      db.niggle_entries.toArray(),
      db.daily_logs.where("date").between(from, to, true, true).toArray(),
      db.engine_rules.where("rule_key").equals("planned_rpe_by_type").toArray(),
      db.races.toArray(),
    ]);
    const live = <T extends { deleted_at: string | null }>(r: T[]) => r.filter((x) => !x.deleted_at);
    const rp = (rules[0]?.params ?? {}) as { default_done_rpe?: number; by_type?: Record<string, number> };
    const out = buildExport({
      from, to, generatedAt: nowIso(),
      planned: live(planned),
      completed: live(completed).filter((c) => c.local_date >= from),
      completedForLoad: live(completed),
      niggles: live(niggles), niggleEntries: live(entries),
      notes: live(logs).map((l) => ({ date: l.date, note: l.note })),
      loadParams: { defaultRpe: rp.default_done_rpe ?? 4, rpeByType: rp.by_type ?? {} },
      raceDates: live(races).map((r) => r.date),
    });
    setJson(JSON.stringify(out, null, 2));
  }

  function download() {
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bilan-${from}-${to}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-neutral-500">
        Bilan factuel d&apos;une période (assiduité, volume, écarts d&apos;intensité, charge, gênes, ressentis, notes du jour), à transmettre à qui
        construit le bloc suivant.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
      </div>
      <button onClick={() => void build()} className="h-11 self-start rounded-md bg-foreground px-4 font-medium text-background">Préparer l&apos;export</button>
      {json && (
        <>
          <div className="flex gap-3 text-sm">
            <button onClick={download} className="underline">Télécharger le JSON</button>
            <button onClick={() => void navigator.clipboard.writeText(json)} className="underline">Copier</button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{json}</pre>
        </>
      )}
    </section>
  );
}
