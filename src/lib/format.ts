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

/** 330 → « 5:30 ». */
export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** « 5:30 » ou « 5'30 » ou « 330 » → 330 secondes ; null si illisible. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,2})\s*[:'’]\s*(\d{1,2})"?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}

const BASIS_UNIT: Record<string, string> = { hr: "bpm", power: "W", pace: "/km", swim_pace: "/100 m" };

/** Plage absolue avec son unité ; pour une allure, du plus rapide au plus lent. */
export function formatRange(basis: string, min: number | null, max: number | null): string {
  const isPace = basis === "pace" || basis === "swim_pace";
  const v = (n: number) => (isPace ? formatClock(n) : String(Math.round(n)));
  const unit = BASIS_UNIT[basis] ?? "";
  if (min != null && max != null) return `${v(min)}–${v(max)} ${unit}`;
  if (min != null) return isPace ? `plus vite que ${v(min)} ${unit}` : `≥ ${v(min)} ${unit}`;
  if (max != null) return isPace ? `plus lent que ${v(max)} ${unit}` : `≤ ${v(max)} ${unit}`;
  return "";
}

/** Valeur d'un repère avec son unité (allures en min:s). */
export function formatMetric(kind: string, value: number): string {
  switch (kind) {
    case "threshold_pace":
      return `${formatClock(value)} /km`;
    case "css":
      return `${formatClock(value)} /100 m`;
    case "vma":
      return `${value} km/h`;
    case "ftp":
      return `${value} W`;
    case "weight":
      return `${value} kg`;
    case "vo2max":
      return `${value} ml/kg/min`;
    default:
      return `${value} bpm`;
  }
}

/** 12345 → « 3:25:45 » (heures, minutes, secondes). */
export function formatHms(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** « 3:25:45 », « 3h25 », « 45:30 » → secondes ; null si illisible. */
export function parseHms(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  const hm = /^(\d+)h(\d{1,2})?$/.exec(t);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2] ?? 0) * 60;
  const parts = t.split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
