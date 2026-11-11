"use client";

import { useState } from "react";
import { blockMinutes, parseAnyBlock, type ImportPlan, type PlanBlock } from "@/domain/plan/block";
import { DISCIPLINES, SESSION_TYPES } from "@/domain/labels";
import { formatDuration } from "@/lib/format";
import { useSync } from "@/lib/sync/provider";
import { applyImport, previewImport } from "@/lib/sync/plan-import";
import { formatLocalDate, type LocalDate } from "@/lib/time";

const fr = (d: string) => formatLocalDate(d as LocalDate, { weekday: "short", day: "numeric", month: "short" });

/** Aperçu de ce qu'un import ou un motif va changer, avant toute écriture. */
export function ImportPreview({ block, plan, onApply, onCancel, busy }: { block: PlanBlock; plan: ImportPlan; onApply: () => void; onCancel: () => void; busy: boolean }) {
  const line = (s: { date: string; discipline: string; session_type: string; title?: string | null; duration_min?: number }) =>
    `${fr(s.date)} · ${s.title ?? SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES] ?? s.session_type} · ${DISCIPLINES[s.discipline as keyof typeof DISCIPLINES] ?? s.discipline}${s.duration_min ? ` · ${formatDuration(s.duration_min * 60)}` : ""}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <p className="font-medium">
        Du {fr(block.period.start)} au {fr(block.period.end)} : {block.sessions.length} séance(s), {formatDuration(blockMinutes(block) * 60)} au total
        {block.phase ? ` · phase « ${block.phase.name} »` : ""}
      </p>
      {block.phase?.objectives && <p className="text-neutral-600 dark:text-neutral-400">Objectifs : {block.phase.objectives}</p>}
      <Group title={`${plan.creates.length} à créer`} items={plan.creates.map((c) => line(c.session))} />
      <Group title={`${plan.updates.length} à mettre à jour (même séance, liens conservés)`} items={plan.updates.map((u) => line(u.session))} />
      <Group title={`${plan.deletes.length} à supprimer (prévues, non réalisées, absentes du fichier)`} items={plan.deletes.map((d) => `${fr(d.date)} · ${d.title ?? DISCIPLINES[d.discipline as keyof typeof DISCIPLINES]}`)} tone="warn" />
      <Group title={`${plan.kept.length} réalisée(s) ou marquée(s) : jamais touchées`} items={plan.kept.map((d) => `${fr(d.date)} · ${d.title ?? DISCIPLINES[d.discipline as keyof typeof DISCIPLINES]}`)} />
      {plan.skipped.length > 0 && <Group title={`${plan.skipped.length} ligne(s) du fichier ignorée(s)`} items={plan.skipped.map((s) => `${line(s.session)} : ${s.reason}`)} tone="warn" />}
      <div className="flex gap-2">
        <button onClick={onApply} disabled={busy} className="h-11 flex-1 rounded-md bg-foreground font-medium text-background disabled:opacity-50">Appliquer</button>
        <button onClick={onCancel} className="h-11 px-3 text-neutral-500">Annuler</button>
      </div>
    </div>
  );
}

function Group({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  if (!items.length) return <p className="text-neutral-500">{title}</p>;
  return (
    <details open={items.length <= 8}>
      <summary className={`cursor-pointer ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>{title}</summary>
      <ul className="mt-1 list-disc pl-5 text-neutral-600 dark:text-neutral-400">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </details>
  );
}

/** Import d'un bloc : fichier JSON (format v1), CSV ou markdown, ou texte collé. */
export function ImportPanel() {
  const engine = useSync();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ block: PlanBlock; plan: ImportPlan; kind: "json" | "csv" | "md" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function analyse(content: string, name: string | null) {
    setDone(null);
    const r = parseAnyBlock(name ?? "", content);
    if (!r.ok) {
      setErrors(r.errors);
      setPreview(null);
      return;
    }
    setErrors([]);
    const kind = content.trimStart().startsWith("{") ? "json" : name?.endsWith(".csv") ? "csv" : "md";
    setPreview({ block: r.block, plan: await previewImport(engine, r.block, "import"), kind });
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    await applyImport(engine, preview.block, preview.plan, { kind: preview.kind, source: "import", fileName, payload: preview.kind === "json" ? JSON.parse(text) : { text } });
    setBusy(false);
    setDone(`Bloc importé : ${preview.plan.creates.length} créée(s), ${preview.plan.updates.length} mise(s) à jour, ${preview.plan.deletes.length} supprimée(s).`);
    setPreview(null);
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-neutral-500">
        Format JSON v1 (contrat publié dans <code>schemas/plan-block.v1.json</code>, exemple dans <code>schemas/examples</code>), ou CSV
        (<code>date;discipline;type;durée;titre;priorité</code>), ou une liste markdown (<code>- 2026-11-17 · vélo · endurance · 60 min</code>).
        Réimporter un bloc corrigé remplace les séances prévues de la période, sans doublon ; le réalisé n&apos;est jamais touché.
      </p>
      <input
        type="file"
        accept=".json,.csv,.md,.txt,application/json,text/csv,text/markdown"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const content = await f.text();
          setFileName(f.name);
          setText(content);
          await analyse(content, f.name);
        }}
        className="text-sm"
      />
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="…ou colle le contenu ici" className="rounded-md border border-neutral-300 bg-transparent p-2 font-mono text-xs dark:border-neutral-700" />
      <button onClick={() => void analyse(text, fileName)} disabled={!text.trim()} className="h-11 self-start rounded-md border border-neutral-300 px-4 disabled:opacity-50 dark:border-neutral-700">Voir l&apos;aperçu</button>
      {errors.length > 0 && (
        <ul className="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {preview && <ImportPreview block={preview.block} plan={preview.plan} onApply={() => void apply()} onCancel={() => setPreview(null)} busy={busy} />}
      {done && <p className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{done}</p>}
    </section>
  );
}
