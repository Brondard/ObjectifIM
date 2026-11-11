/**
 * Module unique de gestion des dates (cf. docs/decisions.md, D3).
 *
 * Deux notions qui ne se mélangent jamais :
 * - LocalDate ('YYYY-MM-DD') : un jour du calendrier, sans fuseau. C'est la date d'une séance prévue.
 * - Instant (Date) : un moment réel, stocké en UTC. C'est le début d'une activité.
 *
 * Aucun `new Date()` ailleurs dans le code : tout passe par ici.
 */
import { TZDate } from "@date-fns/tz";

export const APP_TZ = "Europe/Paris";

export type LocalDate = string & { readonly __brand: "LocalDate" };
export type LocalTime = string; // 'HH:MM' ou 'HH:MM:SS'

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): value is LocalDate {
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function localDate(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error(`Date calendaire invalide : ${value}`);
  return value;
}

function parts(d: LocalDate): [number, number, number] {
  const [y, m, day] = d.split("-").map(Number);
  return [y, m, day];
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function fromUtcMidnight(ms: number): LocalDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` as LocalDate;
}

/** L'instant présent. Seul point d'entrée sur l'horloge système. */
export function now(): Date {
  return new Date();
}

/** Le jour calendaire d'un instant, dans le fuseau donné. */
export function localDateOf(instant: Date | string, tz: string = APP_TZ): LocalDate {
  const z = new TZDate(typeof instant === "string" ? Date.parse(instant) : instant.getTime(), tz);
  return `${pad(z.getFullYear(), 4)}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}` as LocalDate;
}

export function today(tz: string = APP_TZ): LocalDate {
  return localDateOf(now(), tz);
}

/**
 * L'instant UTC correspondant à une date et une heure locales. Gère les changements d'heure :
 * le 25 octobre 2026 à 08:00 à Paris vaut 07:00 UTC, la veille 06:00 UTC.
 */
export function zonedInstant(date: LocalDate, time: LocalTime, tz: string = APP_TZ): Date {
  const [y, m, d] = parts(date);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, ss, tz).getTime());
}

/** Arithmétique calendaire pure : un jour = un jour, quel que soit le changement d'heure. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = parts(date);
  return fromUtcMidnight(Date.UTC(y, m - 1, d + days));
}

export function diffDays(later: LocalDate, earlier: LocalDate): number {
  const [y1, m1, d1] = parts(later);
  const [y0, m0, d0] = parts(earlier);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y0, m0 - 1, d0)) / 86_400_000);
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: LocalDate): number {
  const [y, m, d] = parts(date);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Le lundi de la semaine qui contient la date. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Les sept jours (lundi → dimanche) de la semaine qui contient la date. */
export function weekDays(date: LocalDate): LocalDate[] {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Libellé français d'un jour calendaire (« mardi 10 novembre »), sans effet de fuseau. */
export function formatLocalDate(date: LocalDate, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  const [y, m, d] = parts(date);
  return new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Jour d'une heure locale « naïve » (ex. start_date_local de Strava, « 2026-10-25T08:30:00Z » dont le Z
 * est trompeur : c'est l'heure du lieu, pas de l'UTC).
 */
export function localDateFromLocalIso(value: string): LocalDate {
  return localDate(value.slice(0, 10));
}

/** Instant décalé d'un nombre de secondes (fin d'un événement). */
export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

/** Instant ISO d'un horodatage Unix en secondes (jetons OAuth). */
export function isoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Instant présent au format ISO (horodatages techniques : suppression logique, etc.). */
export function nowIso(): string {
  return now().toISOString();
}
