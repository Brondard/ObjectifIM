# Schéma de données — proposition v0 (à valider avant migrations)

Postgres 15 (Supabase). Ce document est la base de discussion du jalon 1 : rien n'est encore écrit en migration.

## 1. Conventions communes à toutes les tables

```sql
-- Colonnes présentes partout
id          uuid primary key default gen_random_uuid(),  -- en pratique UUID v7 généré côté client (hors ligne)
user_id     uuid not null default auth.uid() references auth.users on delete cascade,
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),
deleted_at  timestamptz,           -- suppression logique : une suppression hors ligne doit se propager
_rev        bigint not null        -- numéro de révision global, posé par trigger (séquence sync_rev)
```

- **`_rev` plutôt que `updated_at` pour la synchro descendante.** Le client demande « tout ce qui a `_rev > curseur` ». Une séquence est monotone ; une horloge ne l'est pas.
- **`_field_ts jsonb`** (horodatage client par champ) uniquement sur les tables modifiables hors ligne : `planned_sessions`, `completed_sessions`, `strength_sets`, `daily_logs`, `niggles`, `niggle_entries`, `checklist_items`. Les écritures arrivent par une RPC `apply_mutations(jsonb)` qui applique la dernière écriture gagnante champ par champ. **Conflit réel** = le champ a été modifié côté serveur après la valeur de base connue du client, et les deux nouvelles valeurs diffèrent. Il est renvoyé au client, jamais tranché.
- **RLS** : activée sur toutes les tables, une politique unique par table :
  ```sql
  create policy own_rows on <table> for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  ```
  Index `(user_id, …)` en tête de tous les index composés.
- **Énumérations en `text` + `check`**, pas en `enum` Postgres. Un `enum` ne permet pas de retirer une valeur (le cas de `moved` l'a montré) ; Zod reste la source côté TypeScript.
- **Dates calendaires en `date`**, instants réels en `timestamptz` (UTC). Le jour local d'une activité (`local_date`) est calculé par l'application via le module de dates et stocké : `timezone()` n'est pas immuable, donc pas de colonne générée.
- Unités en base : **secondes, mètres, kg, bpm, watts, s/km (allure), s/100 m (natation)**. Le formatage est un problème d'affichage.
- Extension `btree_gist` pour les contraintes d'exclusion de chevauchement de dates.

## 2. Profil et repères physiologiques

**`profiles`** — `id = auth.users.id`
`display_name`, `birth_date date`, `timezone text default 'Europe/Paris'`, `home_lat`, `home_lng` (météo, soleil), `prefs jsonb` (affichage uniquement : tout est métrique).

**`metrics`** — repères historisés, ajout seul, jamais écrasés
| Colonne | Type | Notes |
|---|---|---|
| kind | text | `hr_max`, `hr_rest`, `lthr`, `vma` (km/h), `ftp` (W), `css` (s/100 m), `threshold_pace` (s/km), `vo2max`, `weight` (kg) |
| value | numeric | |
| measured_on | date | |
| source | text | `manual`, `strava`, `samsung`, `test`, `race` |
| note | text | |

Index `(user_id, kind, measured_on desc)`. Valeur à une date = dernière mesure `measured_on <= date`. Le poids du profil vit ici (historisé).

**`zone_models`** (remplace `zones`) — *arbitrage* : les bornes absolues ne sont **pas stockées**, elles sont recalculées par une fonction pure à partir du modèle et des repères valides à la date de la séance. On stocke ce qui ne se recalcule pas : la méthode et les pourcentages.
| Colonne | Type | Notes |
|---|---|---|
| discipline | text | `run`, `bike`, `swim` |
| basis | text | `hr`, `pace`, `power` |
| method | text | `pct_hrmax` (= Samsung), `karvonen`, `pct_lthr`, `pct_ftp`, `pct_vma`, `pct_css` |
| bounds | jsonb | `[{zone:1, lo:0.50, hi:0.60}, …]`, en fractions de la référence |
| overrides | jsonb null | bornes absolues forcées à la main, si besoin |
| valid_from | date | historise aussi les changements de méthode |

Unique `(user_id, discipline, basis, valid_from)`.

## 3. Saison, phases, courses

**`seasons`** — `name`, `start_date`, `end_date`, `goal text`, `main_race_id` (FK différée vers `races`). `check (end_date > start_date)`.

**`phases`**
| Colonne | Type | Notes |
|---|---|---|
| season_id | uuid FK | cascade |
| type | text | `base`, `build`, `specific`, `taper`, `recovery`, `return` (reprise) |
| name | text | |
| start_date, end_date | date | exclusion : pas de chevauchement dans une saison |
| targets | jsonb | volume cible hebdo par discipline : `{swim:{min,km}, bike:{…}, run:{…}, strength:{min}}` |
| engine_params | jsonb | paramètres du moteur par phase, ex. `{max_consecutive_run_days: 2}` (règle 4, arbitrage 5) |

**`races`**
`season_id` (nullable), `date`, `start_time time`, `name`, `sport` (`run`, `tri`, `bike`, `swim`), `format` (`10k`, `half`, `marathon`, `sprint`, `olympic`, `l`, `70.3`, `140.6`, `other`), `distance_m`, `priority` (`A`/`B`/`C`), `goals jsonb` (`{a:{time_s}, b:{…}, c:{…}}`), `location`, `lat`, `lng`, `registration_url`, `gpx_path` (Storage), `result jsonb` (temps, splits, classement), `debrief jsonb`.

## 4. Construire le plan

**`session_templates`** — `name`, `discipline`, `session_type`, `default_duration_s`, `default_distance_m`, `target_intensity jsonb`, `structure jsonb`, `instructions`, `tags text[]`.

**`week_templates`** — `phase_id` (nullable), `name`, `notes`.

**`week_template_items`** — une ligne du motif de semaine
| Colonne | Type | Notes |
|---|---|---|
| week_template_id | uuid FK | cascade |
| weekday | smallint | 1 = lundi … 7 = dimanche (ISO) |
| local_time | time null | 07:30 pour la natation |
| session_template_id | uuid FK null | ou champs en ligne ci-dessous |
| discipline, session_type, duration_s, distance_m, structure | | |
| priority | text | **la priorité vit ici** (arbitrage 8) : le club est `key` en base, `secondary` en spécifique |
| progression | jsonb | `{duration_step_s: 600, every_weeks: 1, max_duration_s: …}` |

L'application d'un motif sur une plage (avec semaine allégée tous les N semaines à X %) est une action : ses paramètres sont journalisés dans `plan_changes`, les séances générées portent `source = 'pattern'`.

**`import_batches`** — `format_version`, `kind` (`json`, `csv`, `md`), `period_start`, `period_end`, `phase_id`, `file_sha256`, `summary jsonb`, `payload jsonb` (le fichier d'origine, pour pouvoir le relire).

**`planned_sessions`** — le cœur
| Colonne | Type | Notes |
|---|---|---|
| date | date | jour calendaire (arbitrage 1) |
| local_time | time null | |
| original_date | date null | date avant tout déplacement (arbitrage 2) |
| discipline | text | `swim`, `bike`, `run`, `strength`, `other` |
| session_type | text | `endurance`, `long`, `recovery`, `tempo`, `threshold`, `vo2`, `short_reps`, `race_pace`, `technique`, `strength_push`, `strength_pull`, `strength_legs`, `race`, `other` |
| priority | text | `key`, `secondary`, `optional` |
| status | text | `planned`, `completed`, `partial`, `skipped_choice`, `skipped_life`, `skipped_injury` |
| skip_note | text | |
| target_duration_s, target_distance_m | int null | |
| target_intensity | jsonb | `{basis:'hr', zone:2}` ou `{basis:'pace', min:330, max:340}` ; résolu en absolu à l'affichage |
| structure | jsonb | schéma Zod `SessionStructure` (§ 8) |
| instructions | text | |
| indoor | boolean | home trainer, tapis : météo et mode déplacement |
| template_id | uuid FK null | |
| source | text | `manual`, `pattern`, `import`, `engine` |
| import_batch_id | uuid FK null | |
| import_key | text null | clé stable fournie par le fichier d'import ; unique `(user_id, import_key)` |
| _field_ts | jsonb | |

Index `(user_id, date)`, `(user_id, status, date)`. La « sortie longue » de la règle 1 est `session_type = 'long'`.

## 5. Le réalisé

**`completed_sessions`**
| Colonne | Type | Notes |
|---|---|---|
| planned_session_id | uuid FK null | `on delete set null` ; plusieurs réalisations par séance prévue autorisées |
| match_status | text | `standalone`, `suggested`, `confirmed` (rapprochement Strava) |
| started_at | timestamptz | UTC |
| local_date | date | jour Europe/Paris, calculé par l'application |
| discipline, sport_type | text | `sport_type` = valeur brute Strava |
| elapsed_s, moving_s, distance_m, elevation_gain_m | | |
| avg_hr, max_hr, avg_cadence, avg_power, np_power, avg_speed_mps | | |
| relative_effort | int | Strava, secondaire |
| rpe | smallint | 1–10, `check` |
| feeling | text | une ligne |
| comment | text | |
| hr_reliable | boolean null | forcé à `false` quand la FC est aberrante → l'allure et le RPE reprennent la main |
| equipment_id | uuid FK null | chaussures, vélo |
| weather | jsonb | température utilisée pour la correction de chaleur |
| source | text | `manual`, `strava`, `samsung` |
| strava_activity_id | bigint null | unique `(user_id, strava_activity_id)` |
| streams_path | text null | objet Storage `streams/{user_id}/{activity_id}.json.gz` |
| analysis | jsonb | **cache** recalculable : temps par zone, dérive cardiaque, cadence, écart d'intensité, version de l'algorithme |
| _field_ts | jsonb | |

Index `(user_id, local_date)`, `(user_id, planned_session_id)`.

**`strength_exercises`** — `name`, `muscle_groups text[]`, `is_unilateral`, **`loads_legs boolean`** (règle 3), `default_rest_s`, `archived_at`. Pré-remplie avec une bibliothèque Push / Pull / Legs.

**`strength_sets`**
`completed_session_id` FK cascade, `exercise_id` FK, `set_index smallint`, `side` (`L`, `R`, null), `load_kg numeric(6,2)`, `reps smallint`, `rir smallint null`, `tempo text null`, `is_warmup boolean`, `_field_ts`.
Unique `(completed_session_id, exercise_id, set_index, side)`. Index `(user_id, exercise_id, created_at desc)` : pré-remplissage avec la dernière série en une lecture d'index.

## 6. Forme, gênes, matériel, nutrition

**`daily_logs`** — *arbitrage* : le check-in et la note du jour partagent la même clé (un jour) ; une seule table, une ligne par jour, tous champs facultatifs.
`date` (unique par utilisateur), `sleep_h`, `sleep_quality` 1–5, `hr_rest`, `freshness` 1–5, `mood` 1–5, `soreness` 1–5, `motivation` 1–5, `note text`, `sources jsonb` (source par champ : `{hr_rest:'samsung', sleep_h:'manual'}`), `_field_ts`.

**`niggles`** — `body_zone text` (code de la carte du corps : `knee`, `achilles`, `it_band`…), `side` (`left`, `right`, `both`, `center`), `started_on`, `context`, `resolved_on`, `_field_ts`.
**`niggle_entries`** — l'évolution : `niggle_id` FK, `date`, `intensity` 0–10, `note`, `_field_ts`.
Récurrence = plusieurs `niggles` sur le même `(body_zone, side)` dans une fenêtre paramétrable.

**`equipment`** — `kind` (`shoes`, `bike`, `wetsuit`, `other`), `name`, `brand`, `purchased_on`, `initial_km`, `alert_km`, `retired_on`, `strava_gear_id`, `default_for_discipline`.
Kilométrage cumulé = **vue** `v_equipment_usage` (`initial_km + somme des distances`), jamais stocké.
**`equipment_maintenance`** — `equipment_id`, `component` (`chain`, `tires`, `pads`, `fitting`…), `done_on`, `at_km`, `interval_km`, `note`, `photo_path`.

**`nutrition_products`** — `name`, `brand`, `kind`, `carbs_g`, `sodium_mg`, `caffeine_mg`.
**`nutrition_protocols`** — `name`, `carbs_per_h`, `items jsonb` (`[{product_id, every_min}]`), `context`.
**`tolerance_logs`** — `date`, `product_id`, `completed_session_id` ou `race_id`, `gi_rating` 1–5, `note`.

## 7. Courses, moteur, intégrations

**`race_plans`** — `race_id`, `name`, `target_time_s`, `splits jsonb`, `hr_caps jsonb`, `nutrition jsonb`, `morning_timeline jsonb`, `protocol_id`.
**`checklists`** — `name`, `is_template`, `race_id` null. **`checklist_items`** — `checklist_id`, `label`, `position`, `checked_at`, `_field_ts`.

**`engine_rules`** — les règles comme données (la logique reste en code testé, les paramètres sont ici)
`rule_key` (unique par utilisateur, ex. `min_gap_key_same_discipline`), `kind` (`hard`, `soft`), `enabled`, `weight numeric` (règles souples), `params jsonb` (ex. `{hours: 48}`). Initialisée avec les 7 règles dures et 7 souples du cahier des charges, et la table de jugement de l'intensité (arbitrage 7) sous la clé `intensity_judgement`.

**`substitutions`** — `from_discipline`, `from_session_type`, `to_discipline`, `to_session_type`, `duration_ratio`, `loss_note` (« ce que la substitution fait perdre »).

**`venues`** + **`venue_slots`** — piscine, club : `weekday`, `start_time`, `end_time`, `valid_from`, `valid_to`. Le moteur n'utilise que des créneaux réels.

**`plan_changes`** — journal
`occurred_at`, `trigger` (`unavailable`, `move`, `sick`, `short_time`, `travel`, `missed_key`, `bulk_edit`, `import`, `pattern_apply`), `reason`, `input jsonb`, `options jsonb` (**instantané des options proposées**, pour pouvoir rejouer et auditer le moteur), `chosen_option`, `affected jsonb` (avant/après par séance), `engine_version`.

**Schéma `private`** (aucun accès depuis le client, rôle de service uniquement)
- `private.strava_tokens` — `user_id`, `athlete_id`, `access_token`, `refresh_token`, `expires_at`, `scopes`. *Arbitrage* : les jetons ne doivent jamais être lisibles avec la clé publique, même avec RLS.
- `private.strava_events` — file du webhook : `object_id`, `aspect`, `received_at`, `processed_at`, `attempts`, `error`.

**`push_subscriptions`** (jalon 8) — `endpoint`, `keys jsonb`, `device_label`.

**Storage** : buckets `streams`, `gpx`, `photos`, privés, politique sur `storage.objects` limitée au dossier `{user_id}/`.

## 8. Structure d'une séance (JSONB, Zod)

```ts
type Intensity =
  | { basis: 'hr' | 'pace' | 'power' | 'swim_pace'; zone: number }        // résolu avec les zones à la date
  | { basis: 'hr' | 'pace' | 'power' | 'swim_pace'; min: number; max: number }
  | { basis: 'rpe'; min: number; max: number };

type Step = {
  kind: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'rest';
  duration_s?: number; distance_m?: number;   // exactement un des deux
  intensity?: Intensity;
  note?: string;
};
type Repeat = { kind: 'repeat'; times: number; steps: (Step | Repeat)[] };
type SessionStructure = { version: 1; steps: (Step | Repeat)[] };
```

« échauffement + 2 × (200/600/200 récup 36"/1'/35") + 400 » :
`[warmup, {repeat 2: [work 200m, recovery 36s, work 600m, recovery 60s, work 200m, recovery 35s]}, work 400m]`.
Le JSON Schema publié dans `schemas/` est **généré** depuis Zod, et l'intégration continue échoue s'il diverge.

## 9. Ce qui est volontairement calculé, pas stocké

Bornes de zones, kilométrage du matériel, volumes hebdomadaires, charge (RPE × durée), ratio aigu/chronique, monotonie : tout est dérivé par `src/domain/`, fonctions pures testées. Seul `completed_sessions.analysis` met en cache les calculs coûteux sur les flux, avec la version de l'algorithme pour l'invalider.

## 10. Questions ouvertes

1. **Portée de l'import idempotent.** Je recommande : le fichier fait foi sur sa période. Les séances qui portent une `import_key` présente dans le fichier sont **mises à jour** (même `id`, donc pas de lien cassé). Celles de la période **non réalisées** et absentes du fichier sont supprimées, **y compris les séances ajoutées à la main**. Les séances réalisées, partielles ou liées à une réalisation ne sont jamais touchées. L'aperçu affiche ces trois listes avant de valider.
2. **`daily_logs`** : la fusion du check-in et de la note du jour te convient-elle ?
3. **`zone_models`** : es-tu d'accord pour ne pas stocker les bornes absolues des zones ?
