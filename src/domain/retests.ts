/** Rappels de retest : FTP tous les deux mois, allures après chaque course. Fonctions pures. */
import { addDays, type LocalDate } from "@/lib/time";
import { metricAt, type Metric } from "./zones";

export type Retest = { key: string; message: string };

export type RaceLike = { id: string; name: string; date: string; sport: string; deleted_at?: string | null };

export const FTP_RETEST_DAYS = 60;
/** Fenêtre après une course pendant laquelle on propose de mettre à jour les allures. */
export const RACE_RETEST_WINDOW_DAYS = 21;

export function retestsDue(metrics: Metric[], races: RaceLike[], today: LocalDate): Retest[] {
  const due: Retest[] = [];

  const ftp = metricAt(metrics, "ftp", today);
  if (!ftp) {
    due.push({ key: "ftp:none", message: "Aucune FTP enregistrée : les zones de puissance ne peuvent pas être calculées." });
  } else if (addDays(ftp.measured_on as LocalDate, FTP_RETEST_DAYS) <= today) {
    due.push({
      key: `ftp:${ftp.measured_on}`,
      message: `Retest FTP : dernière mesure ${ftp.value} W le ${ftp.measured_on}, il y a plus de deux mois.`,
    });
  }

  const windowStart = addDays(today, -RACE_RETEST_WINDOW_DAYS);
  for (const race of races) {
    if (race.deleted_at || race.date > today || race.date < windowStart) continue;
    if (race.sport !== "run" && race.sport !== "tri") continue;
    const pace = [metricAt(metrics, "threshold_pace", today), metricAt(metrics, "vma", today)].filter(Boolean);
    const updatedSince = pace.some((m) => m!.measured_on >= race.date);
    if (!updatedSince) {
      due.push({ key: `race:${race.id}`, message: `Après ${race.name} (${race.date}) : mettre à jour l'allure seuil ou la VMA.` });
    }
  }
  return due;
}
