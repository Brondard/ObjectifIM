"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { Field, inputClass } from "@/components/session-form";
import type { NutritionProduct, NutritionProtocol } from "@/lib/sync/db";
import { useSync } from "@/lib/sync/provider";
import { nowIso, today } from "@/lib/time";

const KINDS = { gel: "Gel", drink: "Boisson", bar: "Barre", chew: "Pâte de fruit", food: "Aliment", other: "Autre" } as const;
const GI = ["", "Très mal toléré", "Mal toléré", "Moyen", "Bien toléré", "Parfait"];

export default function NutritionPage() {
  const { db } = useSync();
  const data = useLiveQuery(async () => {
    const [products, protocols, logs] = await Promise.all([db.nutrition_products.toArray(), db.nutrition_protocols.toArray(), db.tolerance_logs.toArray()]);
    return {
      products: products.filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name)),
      protocols: protocols.filter((p) => !p.deleted_at),
      logs: logs.filter((l) => !l.deleted_at).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [db]);
  if (!data) return null;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Nutrition</h1>
        <Link href="/courses" className="text-sm underline">Courses</Link>
      </header>
      <Products products={data.products} logs={data.logs} />
      <Protocols protocols={data.protocols} products={data.products} />
      <Tolerance products={data.products} logs={data.logs} />
    </div>
  );
}

function Products({ products, logs }: { products: NutritionProduct[]; logs: { product_id: string; gi_rating: number }[] }) {
  const engine = useSync();
  const [f, setF] = useState({ name: "", brand: "", kind: "gel", carbs_g: "", sodium_mg: "", caffeine_mg: "" });
  const num = (v: string) => (v === "" ? null : Number(v.replace(",", ".")));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Produits</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {products.map((p) => {
          const ratings = logs.filter((l) => l.product_id === p.id);
          const avg = ratings.length ? Math.round((ratings.reduce((a, l) => a + l.gi_rating, 0) / ratings.length) * 10) / 10 : null;
          return (
            <li key={p.id} className="flex justify-between gap-2 border-t border-neutral-200 py-1.5 dark:border-neutral-800">
              <span>
                {p.name}{p.brand ? ` (${p.brand})` : ""} · {KINDS[p.kind as keyof typeof KINDS]} · {p.carbs_g ?? "?"} g de glucides
                {p.caffeine_mg ? ` · ${p.caffeine_mg} mg de caféine` : ""}
                {avg != null && <span className={avg < 3 ? "text-red-700 dark:text-red-400" : "text-neutral-500"}> · tolérance {avg}/5 sur {ratings.length} essai(s)</span>}
              </span>
              <button onClick={() => window.confirm("Supprimer ce produit ?") && void engine.mutate("nutrition_products", p.id, { deleted_at: nowIso() })} className="text-neutral-500">×</button>
            </li>
          );
        })}
      </ul>
      <form
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name.trim()) return;
          void engine.mutate("nutrition_products", uuidv7(), {
            name: f.name.trim(), brand: f.brand.trim() || null, kind: f.kind, carbs_g: num(f.carbs_g), sodium_mg: num(f.sodium_mg), caffeine_mg: num(f.caffeine_mg),
          });
          setF({ name: "", brand: "", kind: "gel", carbs_g: "", sodium_mg: "", caffeine_mg: "" });
        }}
      >
        <Field label="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputClass} required /></Field>
        <Field label="Marque"><input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} className={inputClass} /></Field>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={inputClass}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Glucides (g)"><input inputMode="decimal" value={f.carbs_g} onChange={(e) => setF({ ...f, carbs_g: e.target.value })} className={inputClass} /></Field>
        <Field label="Sodium (mg)"><input inputMode="decimal" value={f.sodium_mg} onChange={(e) => setF({ ...f, sodium_mg: e.target.value })} className={inputClass} /></Field>
        <Field label="Caféine (mg)"><input inputMode="decimal" value={f.caffeine_mg} onChange={(e) => setF({ ...f, caffeine_mg: e.target.value })} className={inputClass} /></Field>
        <button className="col-span-2 h-11 rounded-md bg-foreground font-medium text-background sm:col-span-3">Ajouter le produit</button>
      </form>
    </section>
  );
}

type Item = { product_id: string; every_min: number; start_min?: number };

function Protocols({ protocols, products }: { protocols: NutritionProtocol[]; products: NutritionProduct[] }) {
  const engine = useSync();
  const add = () => void engine.mutate("nutrition_protocols", uuidv7(), { name: "Nouveau protocole", carbs_per_h: 60, items: [], context: null });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Protocoles</h2>
      <p className="text-sm text-neutral-500">Grammes de glucides par heure et produits utilisés, avec leur cadence. Utilisés pour les plans de course et les séances de plus de 90 min.</p>
      {protocols.map((p) => <ProtocolEditor key={p.id} protocol={p} products={products} />)}
      <button onClick={add} className="self-start text-sm underline">+ Ajouter un protocole</button>
    </section>
  );
}

function ProtocolEditor({ protocol, products }: { protocol: NutritionProtocol; products: NutritionProduct[] }) {
  const engine = useSync();
  const items = (protocol.items ?? []) as Item[];
  const save = (fields: Record<string, unknown>) => void engine.mutate("nutrition_protocols", protocol.id, fields);
  const perHour = items.reduce((a, it) => a + (Number(products.find((p) => p.id === it.product_id)?.carbs_g ?? 0) * 60) / it.every_min, 0);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <input defaultValue={protocol.name} onBlur={(e) => e.target.value !== protocol.name && save({ name: e.target.value })} className={inputClass} aria-label="Nom du protocole" />
        <label className="flex items-center gap-1">
          <input inputMode="numeric" defaultValue={Number(protocol.carbs_per_h)} onBlur={(e) => save({ carbs_per_h: Number(e.target.value) || 0 })} className={inputClass} aria-label="Glucides par heure" /> g/h
        </label>
      </div>
      <ul>
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2 py-1">
            <select value={it.product_id} onChange={(e) => save({ items: items.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)) })} className={`${inputClass} h-9`}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            toutes les
            <input inputMode="numeric" defaultValue={it.every_min} onBlur={(e) => save({ items: items.map((x, j) => (j === i ? { ...x, every_min: Math.max(5, Number(e.target.value) || 20) } : x)) })} className={`${inputClass} h-9 w-16`} aria-label="Minutes" />
            min
            <button onClick={() => save({ items: items.filter((_, j) => j !== i) })} className="text-neutral-500" aria-label="Retirer">×</button>
          </li>
        ))}
      </ul>
      {products.length > 0 ? (
        <button onClick={() => save({ items: [...items, { product_id: products[0].id, every_min: 20 }] })} className="self-start underline">+ Produit</button>
      ) : (
        <p className="text-neutral-500">Ajoute d&apos;abord des produits.</p>
      )}
      {items.length > 0 && (
        <p className={Math.abs(perHour - Number(protocol.carbs_per_h)) > 10 ? "text-amber-700 dark:text-amber-400" : "text-neutral-500"}>
          Cadence prévue : {Math.round(perHour)} g/h pour {Number(protocol.carbs_per_h)} g/h visés.
        </p>
      )}
      <textarea placeholder="Contexte de test : séance, chaleur, ce qui a été toléré…" defaultValue={protocol.context ?? ""} onBlur={(e) => save({ context: e.target.value || null })} rows={2} className="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" />
    </div>
  );
}

function Tolerance({ products, logs }: { products: NutritionProduct[]; logs: { id: string; date: string; product_id: string; gi_rating: number; note: string | null }[] }) {
  const engine = useSync();
  const [f, setF] = useState({ product_id: "", gi_rating: 0, note: "", date: today() as string });
  if (!products.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Journal de tolérance digestive</h2>
      <form className="flex flex-col gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!f.product_id || !f.gi_rating) return;
        void engine.mutate("tolerance_logs", uuidv7(), { date: f.date, product_id: f.product_id, gi_rating: f.gi_rating, note: f.note.trim() || null });
        setF({ ...f, gi_rating: 0, note: "" });
      }}>
        <div className="grid grid-cols-2 gap-2">
          <select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })} className={inputClass} required>
            <option value="" disabled>Produit…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputClass} />
        </div>
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Tolérance de 1 à 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={f.gi_rating === n} onClick={() => setF({ ...f, gi_rating: n })}
              className={`h-11 rounded text-xs ${f.gi_rating === n ? "bg-foreground text-background" : "border border-neutral-300 dark:border-neutral-700"}`}>
              {n} · {GI[n]}
            </button>
          ))}
        </div>
        <input placeholder="Note (chaleur, intensité, quantité…)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputClass} />
        <button className="h-11 rounded-md bg-foreground font-medium text-background">Noter</button>
      </form>
      <ul className="text-sm">
        {logs.slice(0, 20).map((l) => (
          <li key={l.id} className="border-t border-neutral-200 py-1 dark:border-neutral-800">
            {l.date} · {products.find((p) => p.id === l.product_id)?.name} · {l.gi_rating}/5 {GI[l.gi_rating]}{l.note ? ` · ${l.note}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
