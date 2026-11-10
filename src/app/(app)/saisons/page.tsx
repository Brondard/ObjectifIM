import { PHASE_TYPES } from "@/domain/labels";
import { requireUser } from "@/lib/supabase/server";
import { createPhase, createSeason, signOut } from "./actions";

/**
 * Saisons et phases : saisie minimale en attendant la vue Saison
 * (frise des phases, courses, courbe de volume).
 */
export default async function SeasonsPage({ searchParams }: PageProps<"/saisons">) {
  const { error } = await searchParams;
  const { supabase } = await requireUser();

  const [seasons, phases] = await Promise.all([
    supabase.from("seasons").select("id, name, start_date, end_date, goal").is("deleted_at", null).order("start_date"),
    supabase.from("phases").select("id, name, type, start_date, end_date").is("deleted_at", null).order("start_date"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Saisons</h1>
        <form action={signOut}>
          <button className="text-sm underline">Se déconnecter</button>
        </form>
      </header>

      {error && <p className="rounded-md bg-red-100 p-3 text-sm text-red-800">{String(error)}</p>}

      <Section title="Saisons">
        <List
          items={seasons.data ?? []}
          render={(s) => `${s.name} · ${s.start_date} → ${s.end_date}${s.goal ? ` · ${s.goal}` : ""}`}
        />
        <form action={createSeason} className={formClass}>
          <Field label="Nom"><input name="name" required className={inputClass} /></Field>
          <Field label="Début"><input name="start_date" type="date" required className={inputClass} /></Field>
          <Field label="Fin"><input name="end_date" type="date" required className={inputClass} /></Field>
          <Field label="Objectif"><input name="goal" className={inputClass} /></Field>
          <Submit>Créer la saison</Submit>
        </form>
      </Section>

      <Section title="Phases">
        <List
          items={phases.data ?? []}
          render={(p) => `${p.name} (${PHASE_TYPES[p.type as keyof typeof PHASE_TYPES]}) · ${p.start_date} → ${p.end_date}`}
        />
        {seasons.data?.length ? (
          <form action={createPhase} className={formClass}>
            <Field label="Saison">
              <select name="season_id" required className={inputClass}>
                {seasons.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select name="type" required className={inputClass}>
                {Object.entries(PHASE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Nom"><input name="name" required className={inputClass} /></Field>
            <Field label="Début"><input name="start_date" type="date" required className={inputClass} /></Field>
            <Field label="Fin"><input name="end_date" type="date" required className={inputClass} /></Field>
            <Submit>Créer la phase</Submit>
          </form>
        ) : (
          <p className="text-sm text-neutral-500">Crée d&apos;abord une saison.</p>
        )}
      </Section>
    </div>
  );
}

const formClass = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const inputClass =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2.5 dark:border-neutral-700";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-md bg-foreground px-3 py-2.5 font-medium text-background sm:col-span-2">{children}</button>
  );
}

function List<T extends { id: string }>({ items, render }: { items: T[]; render: (item: T) => string }) {
  if (!items.length) return <p className="text-sm text-neutral-500">Aucune pour l&apos;instant.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item) => <li key={item.id} className="rounded-md bg-neutral-100 px-3 py-2 dark:bg-neutral-900">{render(item)}</li>)}
    </ul>
  );
}
