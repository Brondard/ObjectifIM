/** Couleurs par discipline : une bordure gauche et une pastille, lisibles en clair comme en sombre. */
export const DISCIPLINE_STYLE: Record<string, { bar: string; dot: string; short: string }> = {
  swim: { bar: "border-l-sky-500", dot: "bg-sky-500", short: "Nat" },
  bike: { bar: "border-l-amber-500", dot: "bg-amber-500", short: "Vélo" },
  run: { bar: "border-l-emerald-500", dot: "bg-emerald-500", short: "CAP" },
  strength: { bar: "border-l-violet-500", dot: "bg-violet-500", short: "Muscu" },
  other: { bar: "border-l-neutral-400", dot: "bg-neutral-400", short: "Autre" },
};

export const disciplineStyle = (d: string) => DISCIPLINE_STYLE[d] ?? DISCIPLINE_STYLE.other;
