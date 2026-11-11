"use client";

import { useState } from "react";
import { BulkPanel } from "@/components/plan/bulk-panel";
import { ExportPanel } from "@/components/plan/export-panel";
import { ImportPanel } from "@/components/plan/import-panel";
import { PatternsPanel } from "@/components/plan/patterns-panel";
import { TemplatesPanel } from "@/components/plan/templates-panel";

const TABS = {
  patterns: "Motifs de semaine",
  import: "Importer un bloc",
  bulk: "En masse",
  export: "Exporter",
  templates: "Séances types",
} as const;

/** Construire et réviser le plan par blocs, sans saisir les séances une par une. */
export default function PlanPage() {
  const [tab, setTab] = useState<keyof typeof TABS>("patterns");
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Construire le plan</h1>
      <div className="flex flex-wrap gap-1" role="tablist">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-10 rounded-md px-3 text-sm ${tab === k ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {TABS[k]}
          </button>
        ))}
      </div>
      {tab === "patterns" && <PatternsPanel />}
      {tab === "import" && <ImportPanel />}
      {tab === "bulk" && <BulkPanel />}
      {tab === "export" && <ExportPanel />}
      {tab === "templates" && <TemplatesPanel />}
    </div>
  );
}
