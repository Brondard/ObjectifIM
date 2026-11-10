/** Affichage des grandeurs : toujours avec leur unité. */

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Natation en mètres, le reste en kilomètres. */
export function formatDistance(meters: number | null | undefined, discipline?: string): string {
  if (meters == null || meters === 0) return "";
  if (discipline === "swim") return `${new Intl.NumberFormat("fr-FR").format(Math.round(meters))} m`;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export function formatDelta(ratio: number | null): string {
  if (ratio == null) return "";
  const pct = Math.round(ratio * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)} %`;
}
