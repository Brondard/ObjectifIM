import { DISCIPLINES, PHASE_TYPES, PRIORITIES, SESSION_TYPES } from "@/domain/labels";
import { requireUser } from "@/lib/supabase/server";
import { today } from "@/lib/time";
import { createPhase, createPlannedSession, createSeason, signOut } from "./actions";

/**
 * Jalon 1 : écran technique minimal pour vérifier le schéma de bout en bout
 * (saison → phase → séance). Remplacé au jalon 2 par les vues Aujourd'hui et Semaine.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { error } = await searchParams;
  const { supabase } = await requireUser();
  const day = today();

  const [seasons, phases, sessions] = await Promise.all([
    supabase.from("seasons").select("id, name, start_date, end_date, goal").is("deleted_at", null).order("start_date"),
    supabase.from("phases").select("id, name, type, start_date, end_date, season_id").is("deleted_at", null).order("start_date"),
    supabase
      .from("planned_sessions")
      .select("id, date, discipline, session_type, priority, status, target_duration_s, title")
      .is("deleted_at", null)
      .gte("date", day)
      .order("date")
      .limit(30),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ObjectifIM</h1>
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
            <Field label="Type"><Select name="type" options={PHASE_TYPES} /></Field>
            <Field label="Nom"><input name="name" required className={inputClass} /></Field>
            <Field label="Début"><input name="start_date" type="date" required className={inputClass} /></Field>
            <Field label="Fin"><input name="end_date" type="date" required className={inputClass} /></Field>
            <Submit>Créer la phase</Submit>
          </form>
        ) : (
          <p className="text-sm text-neutral-500">Crée d&apos;abord une saison.</p>
        )}
      </Section>

      <Section title="Séances à venir">
        <List
          items={sessions.data ?? []}
          render={(s) =>
            `${s.date} · ${DISCIPLINES[s.discipline as keyof typeof DISCIPLINES]} · ${
              SESSION_TYPES[s.session_type as keyof typeof SESSION_TYPES]
            } · ${PRIORITIES[s.priority as keyof typeof PRIORITIES]} · ${Math.round((s.target_duration_s ?? 0) / 60)} min${
              s.title ? ` · ${s.title}` : ""
            }`
          }
        />
        <form action={createPlannedSession} className={formClass}>
          <Field label="Date"><input name="date" type="date" required defaultValue={day} className={inputClass} /></Field>
          <Field label="Discipline"><Select name="discipline" options={DISCIPLINES} /></Field>
          <Field label="Type"><Select name="session_type" options={SESSION_TYPES} /></Field>
          <Field label="Priorité"><Select name="priority" options={PRIORITIES} defaultValue="secondary" /></Field>
          <Field label="Durée (min)">
            <input name="duration_min" type="number" inputMode="numeric" min={1} required className={inputClass} />
          </Field>
          <Field label="Titre"><input name="title" className={inputClass} /></Field>
          <Submit>Créer la séance</Submit>
        </form>
      </Section>
    </main>
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

function Select({ name, options, defaultValue }: { name: string; options: Record<string, string>; defaultValue?: string }) {
  return (
    <select name={name} required defaultValue={defaultValue} className={inputClass}>
      {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
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
