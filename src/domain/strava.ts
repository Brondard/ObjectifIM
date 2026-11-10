/**
 * Traduction d'une activité Strava (API v3) en séance réalisée. Fonctions pures.
 * Unités Strava : mètres, secondes, m/s, bpm, W ; dates en ISO.
 */
import { localDateFromLocalIso } from "@/lib/time";

/** Champs utiles d'une activité (SummaryActivity ou DetailedActivity). */
export type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string; // UTC
  start_date_local: string; // heure locale du lieu de l'activité, sans fuseau
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  average_speed?: number;
  suffer_score?: number | null;
  trainer?: boolean;
  gear_id?: string | null;
};

const BIKE = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const RUN = new Set(["Run", "TrailRun", "VirtualRun"]);
const SWIM = new Set(["Swim"]);
const STRENGTH = new Set(["WeightTraining", "Crossfit"]);

export function disciplineOf(sportType: string): "swim" | "bike" | "run" | "strength" | "other" {
  if (RUN.has(sportType)) return "run";
  if (BIKE.has(sportType)) return "bike";
  if (SWIM.has(sportType)) return "swim";
  if (STRENGTH.has(sportType)) return "strength";
  return "other";
}

const int = (v: number | undefined | null) => (v == null ? null : Math.round(v));

/** Champs d'une séance réalisée issus de Strava. Ne touche jamais au RPE, au ressenti ni au rattachement. */
export function completedFieldsFrom(a: StravaActivity) {
  return {
    strava_activity_id: a.id,
    source: "strava",
    name: a.name,
    sport_type: a.sport_type,
    discipline: disciplineOf(a.sport_type),
    started_at: a.start_date,
    // Le jour de l'activité là où elle a eu lieu (un footing à New York à 21 h reste ce jour-là).
    local_date: localDateFromLocalIso(a.start_date_local),
    elapsed_s: a.elapsed_time,
    moving_s: a.moving_time,
    distance_m: a.distance,
    elevation_gain_m: a.total_elevation_gain ?? null,
    avg_hr: int(a.average_heartrate),
    max_hr: int(a.max_heartrate),
    avg_cadence: a.average_cadence ?? null,
    avg_power: a.average_watts ?? null,
    np_power: a.weighted_average_watts ?? null,
    avg_speed_mps: a.average_speed ?? null,
    relative_effort: int(a.suffer_score),
  };
}

/** Flux demandés à Strava (GET /activities/{id}/streams). */
export const STREAM_KEYS = ["time", "distance", "heartrate", "velocity_smooth", "altitude", "cadence", "watts", "moving", "grade_smooth"] as const;
export type StreamKey = (typeof STREAM_KEYS)[number];
export type Streams = Partial<Record<StreamKey, number[] | boolean[]>> & { time: number[] };

/** Réponse Strava `key_by_type=true` → objet de tableaux. */
export function streamsFrom(raw: Record<string, { data: unknown[] }>): Streams | null {
  if (!raw.time?.data?.length) return null;
  const out: Record<string, unknown[]> = {};
  for (const k of STREAM_KEYS) if (raw[k]?.data) out[k] = raw[k].data;
  return out as Streams;
}
