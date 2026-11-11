/**
 * Musculation : pré-remplissage des séries (saisir une charge entre deux séries en trois secondes) et
 * progression des charges par exercice. Fonctions pures.
 */

export type SetLike = {
  id: string;
  completed_session_id: string;
  exercise_id: string;
  set_index: number;
  side: string | null;
  load_kg: number | null;
  reps: number | null;
  rir: number | null;
  is_warmup: boolean;
  created_at?: string;
  deleted_at?: string | null;
};

export type SessionDate = { id: string; local_date: string };

const live = <T extends { deleted_at?: string | null }>(r: T[]) => r.filter((x) => !x.deleted_at);

/** Séries de la dernière séance (avant la séance en cours) pour un exercice. */
export function previousSets(sets: SetLike[], sessions: SessionDate[], exerciseId: string, currentSessionId: string): SetLike[] {
  const dateOf = new Map(sessions.map((s) => [s.id, s.local_date]));
  const current = dateOf.get(currentSessionId) ?? "9999-12-31";
  const candidates = live(sets).filter((s) => s.exercise_id === exerciseId && s.completed_session_id !== currentSessionId && (dateOf.get(s.completed_session_id) ?? "") <= current);
  if (!candidates.length) return [];
  const last = candidates.reduce((a, b) => ((dateOf.get(b.completed_session_id) ?? "") > (dateOf.get(a.completed_session_id) ?? "") ? b : a));
  return candidates.filter((s) => s.completed_session_id === last.completed_session_id).sort((a, b) => a.set_index - b.set_index);
}

/**
 * Série suivante pré-remplie : la série précédente de la séance en cours ; sinon la série de même rang
 * de la séance précédente ; sinon vide.
 */
export function nextSetPrefill(current: SetLike[], previous: SetLike[]) {
  const mine = live(current).filter((s) => !s.is_warmup).sort((a, b) => a.set_index - b.set_index);
  const index = (live(current).reduce((m, s) => Math.max(m, s.set_index), 0)) + 1;
  const source = mine.at(-1) ?? previous.filter((s) => !s.is_warmup)[mine.length] ?? previous.filter((s) => !s.is_warmup).at(-1);
  return { set_index: index, load_kg: source?.load_kg ?? null, reps: source?.reps ?? null, rir: source?.rir ?? null, side: source?.side ?? null };
}

/** 1RM estimé (Epley), seulement jusqu'à 12 répétitions où l'estimation reste raisonnable. */
export function e1rm(load: number | null, reps: number | null): number | null {
  if (!load || !reps || reps > 12) return null;
  return Math.round(load * (1 + reps / 30) * 10) / 10;
}

export type ProgressPoint = { date: string; top_kg: number | null; e1rm: number | null; volume_kg: number; sets: number };

/** Progression d'un exercice, séance par séance : charge maximale, 1RM estimé, tonnage (échauffement exclu). */
export function exerciseProgress(sets: SetLike[], sessions: SessionDate[], exerciseId: string): ProgressPoint[] {
  const dateOf = new Map(sessions.map((s) => [s.id, s.local_date]));
  const bySession = new Map<string, SetLike[]>();
  for (const s of live(sets).filter((x) => x.exercise_id === exerciseId && !x.is_warmup)) {
    bySession.set(s.completed_session_id, [...(bySession.get(s.completed_session_id) ?? []), s]);
  }
  return [...bySession.entries()]
    .filter(([id]) => dateOf.has(id))
    .map(([id, list]) => {
      const loads = list.map((s) => s.load_kg ?? 0);
      const e1s = list.map((s) => e1rm(s.load_kg, s.reps)).filter((v): v is number => v != null);
      return {
        date: dateOf.get(id)!,
        top_kg: loads.length ? Math.max(...loads) : null,
        e1rm: e1s.length ? Math.max(...e1s) : null,
        volume_kg: Math.round(list.reduce((a, s) => a + (s.load_kg ?? 0) * (s.reps ?? 0), 0)),
        sets: list.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Exercices proposés selon le type de séance (rotation Push / Pull / Jambes). */
export function exercisesForType(exercises: { id: string; name: string; muscle_groups: string[]; loads_legs: boolean }[], sessionType: string) {
  const PUSH = ["pectoraux", "épaules", "triceps"];
  const PULL = ["dos", "biceps", "haut du dos", "coiffe des rotateurs"];
  const matches = (e: { muscle_groups: string[]; loads_legs: boolean }) =>
    sessionType === "strength_legs" ? e.loads_legs
      : sessionType === "strength_push" ? !e.loads_legs && e.muscle_groups.some((g) => PUSH.includes(g))
        : sessionType === "strength_pull" ? !e.loads_legs && e.muscle_groups.some((g) => PULL.includes(g))
          : sessionType === "strength_core" ? e.muscle_groups.some((g) => g.includes("abdominale") || g === "obliques")
            : true;
  return [...exercises].sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name));
}
