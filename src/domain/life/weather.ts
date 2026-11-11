/**
 * Météo (Open-Meteo, prévisions horaires à 7 jours, heures locales Europe/Paris) : conditions d'une
 * séance, proposition d'intervertir une séance extérieure sous la pluie, correction d'allure à la chaleur.
 */

export type Hourly = { time: string[]; temperature: number[]; precipitation: number[]; probability: number[]; wind: number[] };

/** Réponse d'Open-Meteo → séries horaires. */
export function parseOpenMeteo(json: { hourly?: Record<string, unknown[]> }): Hourly | null {
  const h = json.hourly;
  if (!h?.time) return null;
  return {
    time: h.time as string[],
    temperature: (h.temperature_2m ?? []) as number[],
    precipitation: (h.precipitation ?? []) as number[],
    probability: (h.precipitation_probability ?? []) as number[],
    wind: (h.wind_speed_10m ?? []) as number[],
  };
}

export const OPEN_METEO_URL = (lat: number, lng: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m&timezone=Europe%2FParis&forecast_days=7`;

export type SessionWeather = { temp_max: number; temp_avg: number; rain_mm: number; rain_probability: number; wind_max: number };

/** Conditions pendant la séance (heure prévue, sinon 8 h–20 h), sur sa durée. */
export function sessionWeather(h: Hourly, date: string, localTime: string | null, durationS: number | null): SessionWeather | null {
  const startHour = localTime ? Number(localTime.slice(0, 2)) : 8;
  const endHour = localTime ? Math.min(23, startHour + Math.max(1, Math.ceil((durationS ?? 3600) / 3600))) : 20;
  const idx = h.time.map((t, i) => [t, i] as const).filter(([t]) => t.startsWith(date) && Number(t.slice(11, 13)) >= startHour && Number(t.slice(11, 13)) < endHour).map(([, i]) => i);
  if (!idx.length) return null;
  const pick = (a: number[]) => idx.map((i) => a[i] ?? 0);
  const temps = pick(h.temperature);
  return {
    temp_max: Math.round(Math.max(...temps) * 10) / 10,
    temp_avg: Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10,
    rain_mm: Math.round(pick(h.precipitation).reduce((a, b) => a + b, 0) * 10) / 10,
    rain_probability: Math.max(...pick(h.probability)),
    wind_max: Math.round(Math.max(...pick(h.wind))),
  };
}

export type SwapSession = { id: string; date: string; local_time: string | null; target_duration_s: number | null; indoor: boolean; discipline: string; session_type: string; priority: string; status: string; title: string | null };
export type SwapSuggestion = { session: SwapSession; with: SwapSession; rain_mm: number; probability: number };

const outdoor = (s: SwapSession) => !s.indoor && (s.discipline === "run" || s.discipline === "bike");

/**
 * Grosse pluie sur une sortie longue ou une séance clé en extérieur : proposer de l'intervertir avec une
 * séance de la même semaine prévue un jour sec (jamais appliqué sans validation).
 */
export function rainSwaps(sessions: SwapSession[], h: Hourly, today: string, weekEnd: string, t: { rain_mm: number; probability: number }): SwapSuggestion[] {
  const open = sessions.filter((s) => s.status === "planned" && s.date >= today && s.date <= weekEnd);
  const wet = (s: SwapSession) => {
    const w = sessionWeather(h, s.date, s.local_time, s.target_duration_s);
    return w && (w.rain_mm >= t.rain_mm || w.rain_probability >= t.probability) ? w : null;
  };
  const out: SwapSuggestion[] = [];
  for (const s of open.filter((x) => outdoor(x) && (x.session_type === "long" || x.priority === "key"))) {
    const w = wet(s);
    if (!w) continue;
    const other = open.find((o) => o.id !== s.id && o.date !== s.date && !wet({ ...o, local_time: s.local_time, target_duration_s: s.target_duration_s }) && o.priority !== "key");
    if (other) out.push({ session: s, with: other, rain_mm: w.rain_mm, probability: w.rain_probability });
  }
  return out;
}

/**
 * Allure corrigée de la chaleur : au-delà du seuil, chaque degré ralentit l'allure cible de `pctPerC` %.
 * Plage en s/km ; la correction est rendue pour être affichée, jamais appliquée en silence.
 */
export function heatAdjust(range: { min: number | null; max: number | null }, tempC: number, fromC = 20, pctPerC = 0.4) {
  if (tempC <= fromC) return null;
  const pct = Math.round((tempC - fromC) * pctPerC * 10) / 10;
  const f = 1 + pct / 100;
  return { pct, min: range.min == null ? null : Math.round(range.min * f), max: range.max == null ? null : Math.round(range.max * f) };
}
