/** Types du moteur de replanification (docs/decisions.md D7 : logique en code, paramètres en base). */

export type EngineSession = {
  id: string;
  date: string;
  local_time: string | null;
  discipline: string;
  session_type: string;
  priority: string;
  status: string;
  title: string | null;
  target_duration_s: number | null;
  original_date?: string | null;
  indoor?: boolean;
  deleted_at?: string | null;
};

export type DoneSession = {
  local_date: string;
  discipline: string;
  moving_s: number | null;
  elapsed_s: number | null;
  rpe: number | null;
  deleted_at?: string | null;
};

export type RuleConfig = {
  rule_key: string;
  kind: string;
  enabled: boolean;
  weight: number;
  params: Record<string, unknown>;
};

export type Substitution = {
  from_discipline: string;
  from_session_type: string | null;
  to_discipline: string;
  to_session_type: string;
  to_label: string;
  duration_ratio: number;
  loss_note: string;
};

export type EngineContext = {
  today: string;
  /** Séances prévues couvrant au moins la semaine concernée et les 7 jours autour. */
  sessions: EngineSession[];
  /** Réalisé des 5 semaines précédant la semaine concernée, et de la semaine elle-même. */
  done: DoneSession[];
  rules: RuleConfig[];
  /** Type de la phase en cours (base, build…) et ses paramètres de moteur. */
  phaseType: string | null;
  phaseParams: Record<string, unknown>;
  aRaceDates: string[];
  substitutions: Substitution[];
  /** Rattrapages déjà faits dans la semaine (journal plan_changes). */
  catchupsThisWeek: number;
};

export type Trigger =
  | { kind: "unavailable"; from: string; to: string; reason?: string }
  | { kind: "sick"; from: string; days: number; injury?: boolean }
  | { kind: "move"; sessionId: string; to?: string }
  | { kind: "short_time"; sessionId: string; minutes: number }
  | { kind: "travel"; from: string; to: string; noBike: boolean; noPool: boolean }
  | { kind: "missed"; sessionId: string };

export type Change =
  | { kind: "move"; id: string; from: string; to: string; reopen?: boolean }
  | { kind: "drop"; id: string; status: "skipped_life" | "skipped_injury" | "skipped_choice"; note: string }
  | { kind: "shorten"; id: string; from_s: number | null; to_s: number }
  | { kind: "substitute"; id: string; to_discipline: string; to_session_type: string; label: string; duration_s: number | null; loss: string };

export type Violation = { rule: string; label: string; detail: string; penalty?: number };

export type Option = {
  key: string;
  title: string;
  explanation: string;
  changes: Change[];
  /** Durée prévue de la semaine par discipline, avant et après (secondes). */
  volumeBefore: Record<string, number>;
  volumeAfter: Record<string, number>;
  soft: Violation[];
  penalty: number;
  acwrBefore: number | null;
  acwrAfter: number | null;
  alerts: string[];
};

export type Proposal = {
  trigger: Trigger;
  weekStart: string;
  options: Option[];
  eliminated: { key: string; title: string; reasons: Violation[] }[];
  notes: string[];
};

export const ENGINE_VERSION = "1";
