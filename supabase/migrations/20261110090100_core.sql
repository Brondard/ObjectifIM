-- Profil, repères physiologiques, saison, courses, construction du plan, prévu et réalisé.
-- Chaque table porte les colonnes communes (id, user_id, created_at, updated_at, deleted_at, _rev).
-- Les clés étrangères entre tables métier sont composites (x_id, user_id) : une ligne ne peut
-- référencer que des lignes du même utilisateur, même en écriture directe.

-- ─── Profil ────────────────────────────────────────────────────────────────

create table public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text,
  birth_date   date,
  timezone     text not null default 'Europe/Paris',
  home_lat     double precision,
  home_lng     double precision,
  prefs        jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  _rev         bigint not null default 0
);
select private.apply_conventions('public.profiles');

-- ─── Repères physiologiques (ajout seul) ───────────────────────────────────

create table public.metrics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  kind        text not null check (kind in (
                'hr_max', 'hr_rest', 'lthr', 'vma', 'ftp', 'css', 'threshold_pace', 'vo2max', 'weight')),
  value       numeric not null check (value > 0),
  measured_on date not null,
  source      public.data_source not null default 'manual',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0
);
select private.apply_conventions('public.metrics');
create index on public.metrics (user_id, kind, measured_on desc) where deleted_at is null;

-- Méthode et pourcentages ; les bornes absolues sont recalculées à la date de la séance.
create table public.zone_models (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  discipline  public.discipline not null check (discipline in ('swim', 'bike', 'run')),
  basis       text not null check (basis in ('hr', 'pace', 'power', 'swim_pace')),
  method      text not null check (method in (
                'pct_hrmax', 'karvonen', 'pct_lthr', 'pct_ftp', 'pct_vma', 'pct_threshold_pace', 'pct_css')),
  bounds      jsonb not null,
  overrides   jsonb,
  valid_from  date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0
);
select private.apply_conventions('public.zone_models');
create unique index on public.zone_models (user_id, discipline, basis, valid_from) where deleted_at is null;

-- ─── Saisons, courses, phases ──────────────────────────────────────────────

create table public.seasons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  goal         text,
  main_race_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  _rev         bigint not null default 0,
  unique (id, user_id),
  check (end_date > start_date)
);
select private.apply_conventions('public.seasons');

create table public.races (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  season_id        uuid,
  date             date not null,
  start_time       time,
  name             text not null,
  sport            text not null check (sport in ('run', 'tri', 'bike', 'swim', 'other')),
  format           text not null check (format in (
                     '5k', '10k', 'half', 'marathon', 'trail', 'sprint', 'olympic', 'l', '70.3', '140.6', 'other')),
  distance_m       integer check (distance_m > 0),
  priority         text not null check (priority in ('A', 'B', 'C')),
  goals            jsonb not null default '{}',
  location         text,
  lat              double precision,
  lng              double precision,
  registration_url text,
  gpx_path         text,
  result           jsonb,
  debrief          jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  _rev             bigint not null default 0,
  unique (id, user_id),
  foreign key (season_id, user_id) references public.seasons (id, user_id) on delete set null (season_id)
);
select private.apply_conventions('public.races');
create index on public.races (user_id, date) where deleted_at is null;

alter table public.seasons
  add foreign key (main_race_id, user_id) references public.races (id, user_id)
  on delete set null (main_race_id) deferrable initially deferred;

create table public.phases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  season_id     uuid not null,
  type          text not null check (type in ('base', 'build', 'specific', 'taper', 'recovery', 'return')),
  name          text not null,
  start_date    date not null,
  end_date      date not null,
  targets       jsonb not null default '{}',
  engine_params jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  _rev          bigint not null default 0,
  unique (id, user_id),
  check (end_date >= start_date),
  foreign key (season_id, user_id) references public.seasons (id, user_id) on delete cascade,
  -- Deux phases actives d'une même saison ne se chevauchent pas.
  exclude using gist (season_id with =, daterange(start_date, end_date, '[]') with &&) where (deleted_at is null)
);
select private.apply_conventions('public.phases');

-- ─── Construction du plan ──────────────────────────────────────────────────

create table public.session_templates (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  name               text not null,
  discipline         public.discipline not null,
  session_type       public.session_type not null,
  default_duration_s integer check (default_duration_s > 0),
  default_distance_m integer check (default_distance_m > 0),
  target_intensity   jsonb,
  structure          jsonb,
  instructions       text,
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  _rev               bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.session_templates');

create table public.week_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  phase_id   uuid,
  name       text not null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  _rev       bigint not null default 0,
  unique (id, user_id),
  foreign key (phase_id, user_id) references public.phases (id, user_id) on delete set null (phase_id)
);
select private.apply_conventions('public.week_templates');

-- La priorité d'une séance récurrente vit ici (arbitrage 8), pas sur la séance type.
create table public.week_template_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  week_template_id    uuid not null,
  weekday             smallint not null check (weekday between 1 and 7),
  local_time          time,
  position            smallint not null default 0,
  session_template_id uuid,
  discipline          public.discipline not null,
  session_type        public.session_type not null,
  priority            public.session_priority not null default 'secondary',
  duration_s          integer check (duration_s > 0),
  distance_m          integer check (distance_m > 0),
  target_intensity    jsonb,
  structure           jsonb,
  instructions        text,
  progression         jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  _rev                bigint not null default 0,
  foreign key (week_template_id, user_id) references public.week_templates (id, user_id) on delete cascade,
  foreign key (session_template_id, user_id) references public.session_templates (id, user_id)
    on delete set null (session_template_id)
);
select private.apply_conventions('public.week_template_items');

create table public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  format_version text not null,
  kind           text not null check (kind in ('json', 'csv', 'md')),
  period_start   date not null,
  period_end     date not null,
  phase_id       uuid,
  file_sha256    text,
  summary        jsonb not null default '{}',
  payload        jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  _rev           bigint not null default 0,
  unique (id, user_id),
  check (period_end >= period_start),
  foreign key (phase_id, user_id) references public.phases (id, user_id) on delete set null (phase_id)
);
select private.apply_conventions('public.import_batches');

-- ─── Prévu ─────────────────────────────────────────────────────────────────

create table public.planned_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  date              date not null,
  local_time        time,
  original_date     date,
  discipline        public.discipline not null,
  session_type      public.session_type not null,
  priority          public.session_priority not null default 'secondary',
  status            public.planned_status not null default 'planned',
  skip_note         text,
  title             text,
  target_duration_s integer check (target_duration_s > 0),
  target_distance_m integer check (target_distance_m > 0),
  target_intensity  jsonb,
  structure         jsonb,
  instructions      text,
  indoor            boolean not null default false,
  template_id       uuid,
  source            public.data_source not null default 'manual'
                      check (source in ('manual', 'pattern', 'import', 'engine')),
  import_batch_id   uuid,
  import_key        text,
  _field_ts         jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  _rev              bigint not null default 0,
  unique (id, user_id),
  foreign key (template_id, user_id) references public.session_templates (id, user_id)
    on delete set null (template_id),
  foreign key (import_batch_id, user_id) references public.import_batches (id, user_id)
    on delete set null (import_batch_id)
);
select private.apply_conventions('public.planned_sessions');
create index on public.planned_sessions (user_id, date) where deleted_at is null;
create unique index on public.planned_sessions (user_id, import_key)
  where import_key is not null and deleted_at is null;

-- ─── Matériel (référencé par le réalisé) ───────────────────────────────────

create table public.equipment (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users on delete cascade,
  kind                   text not null check (kind in ('shoes', 'bike', 'wetsuit', 'other')),
  name                   text not null,
  brand                  text,
  purchased_on           date,
  initial_km             numeric not null default 0 check (initial_km >= 0),
  alert_km               numeric check (alert_km > 0),
  retired_on             date,
  strava_gear_id         text,
  default_for_discipline public.discipline,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  _rev                   bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.equipment');

-- ─── Réalisé ───────────────────────────────────────────────────────────────

create table public.completed_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  planned_session_id uuid,
  match_status       text not null default 'standalone'
                       check (match_status in ('standalone', 'suggested', 'confirmed')),
  started_at         timestamptz,
  local_date         date not null,
  discipline         public.discipline not null,
  sport_type         text,
  name               text,
  elapsed_s          integer check (elapsed_s >= 0),
  moving_s           integer check (moving_s >= 0),
  distance_m         numeric check (distance_m >= 0),
  elevation_gain_m   numeric check (elevation_gain_m >= 0),
  avg_hr             smallint check (avg_hr between 25 and 250),
  max_hr             smallint check (max_hr between 25 and 250),
  avg_cadence        numeric,
  avg_power          numeric,
  np_power           numeric,
  avg_speed_mps      numeric,
  relative_effort    integer,
  rpe                smallint check (rpe between 1 and 10),
  feeling            text,
  comment            text,
  hr_reliable        boolean,
  equipment_id       uuid,
  weather            jsonb,
  source             public.data_source not null default 'manual'
                       check (source in ('manual', 'strava', 'samsung')),
  strava_activity_id bigint,
  streams_path       text,
  analysis           jsonb,
  _field_ts          jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  _rev               bigint not null default 0,
  unique (id, user_id),
  foreign key (planned_session_id, user_id) references public.planned_sessions (id, user_id)
    on delete set null (planned_session_id),
  foreign key (equipment_id, user_id) references public.equipment (id, user_id)
    on delete set null (equipment_id)
);
select private.apply_conventions('public.completed_sessions');
create index on public.completed_sessions (user_id, local_date) where deleted_at is null;
create index on public.completed_sessions (user_id, planned_session_id) where planned_session_id is not null;
create unique index on public.completed_sessions (user_id, strava_activity_id)
  where strava_activity_id is not null;

-- ─── Musculation ───────────────────────────────────────────────────────────

create table public.strength_exercises (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  name           text not null,
  muscle_groups  text[] not null default '{}',
  is_unilateral  boolean not null default false,
  loads_legs     boolean not null default false,  -- utilisé par la règle des 24 h avant une séance clé
  default_rest_s integer check (default_rest_s >= 0),
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  _rev           bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.strength_exercises');
create unique index on public.strength_exercises (user_id, lower(name)) where deleted_at is null;

create table public.strength_sets (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users on delete cascade,
  completed_session_id uuid not null,
  exercise_id          uuid not null,
  set_index            smallint not null check (set_index >= 1),
  side                 text check (side in ('L', 'R')),
  load_kg              numeric(6, 2) check (load_kg >= 0),
  reps                 smallint check (reps >= 0),
  rir                  smallint check (rir between 0 and 10),
  tempo                text,
  is_warmup            boolean not null default false,
  _field_ts            jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  _rev                 bigint not null default 0,
  foreign key (completed_session_id, user_id) references public.completed_sessions (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.strength_exercises (id, user_id) on delete restrict
);
select private.apply_conventions('public.strength_sets');
create unique index on public.strength_sets (completed_session_id, exercise_id, set_index, coalesce(side, '-'))
  where deleted_at is null;
-- Pré-remplissage : dernière série d'un exercice en une lecture d'index.
create index on public.strength_sets (user_id, exercise_id, created_at desc) where deleted_at is null;
