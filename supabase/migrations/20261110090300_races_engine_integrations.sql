-- Plans de course, checklists, moteur de replanification, lieux, journal, intégrations.

create table public.race_plans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  race_id          uuid not null,
  name             text not null,
  target_time_s    integer check (target_time_s > 0),
  splits           jsonb not null default '[]',
  hr_caps          jsonb not null default '[]',
  nutrition        jsonb not null default '[]',
  morning_timeline jsonb not null default '[]',
  protocol_id      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  _rev             bigint not null default 0,
  foreign key (race_id, user_id) references public.races (id, user_id) on delete cascade,
  foreign key (protocol_id, user_id) references public.nutrition_protocols (id, user_id)
    on delete set null (protocol_id)
);
select private.apply_conventions('public.race_plans');

create table public.checklists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  is_template boolean not null default false,
  race_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0,
  unique (id, user_id),
  foreign key (race_id, user_id) references public.races (id, user_id) on delete cascade
);
select private.apply_conventions('public.checklists');

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  checklist_id uuid not null,
  label        text not null,
  position     smallint not null default 0,
  checked_at   timestamptz,
  _field_ts    jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  _rev         bigint not null default 0,
  foreign key (checklist_id, user_id) references public.checklists (id, user_id) on delete cascade
);
select private.apply_conventions('public.checklist_items');

-- ─── Moteur ────────────────────────────────────────────────────────────────

-- La logique des règles est en code testé ; leurs paramètres sont ici, modifiables sans redéployer.
create table public.engine_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  rule_key    text not null,
  kind        text not null check (kind in ('hard', 'soft', 'config')),
  enabled     boolean not null default true,
  weight      numeric not null default 1 check (weight >= 0),
  params      jsonb not null default '{}',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0
);
select private.apply_conventions('public.engine_rules');
create unique index on public.engine_rules (user_id, rule_key) where deleted_at is null;

create table public.substitutions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  from_discipline   public.discipline not null,
  from_session_type public.session_type,
  to_discipline     public.discipline not null,
  to_session_type   public.session_type not null,
  to_label          text not null,
  duration_ratio    numeric not null check (duration_ratio > 0),
  loss_note         text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  _rev              bigint not null default 0
);
select private.apply_conventions('public.substitutions');

create table public.venues (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('pool', 'club', 'track', 'gym', 'other')),
  address    text,
  lat        double precision,
  lng        double precision,
  travel_min smallint check (travel_min >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  _rev       bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.venues');

create table public.venue_slots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  venue_id   uuid not null,
  weekday    smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time   time not null,
  label      text,
  valid_from date,
  valid_to   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  _rev       bigint not null default 0,
  check (end_time > start_time),
  foreign key (venue_id, user_id) references public.venues (id, user_id) on delete cascade
);
select private.apply_conventions('public.venue_slots');

create table public.plan_changes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  occurred_at    timestamptz not null default now(),
  trigger        text not null check (trigger in (
                   'unavailable', 'move', 'sick', 'short_time', 'travel', 'missed_key',
                   'bulk_edit', 'import', 'pattern_apply', 'manual')),
  reason         text,
  input          jsonb not null default '{}',
  options        jsonb not null default '[]',  -- instantané des options proposées (rejouable)
  chosen_option  text,
  affected       jsonb not null default '[]',  -- avant / après par séance
  engine_version text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  _rev           bigint not null default 0
);
select private.apply_conventions('public.plan_changes');
create index on public.plan_changes (user_id, occurred_at desc);

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint     text not null,
  keys         jsonb not null,
  device_label text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  _rev         bigint not null default 0
);
select private.apply_conventions('public.push_subscriptions');
create unique index on public.push_subscriptions (user_id, endpoint) where deleted_at is null;

-- ─── Intégrations : schéma privé, rôle de service uniquement ───────────────

create table private.strava_tokens (
  user_id       uuid primary key references auth.users on delete cascade,
  athlete_id    bigint not null unique,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scopes        text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

create table private.strava_events (
  id           bigint generated always as identity primary key,
  athlete_id   bigint not null,
  object_type  text not null,
  object_id    bigint not null,
  aspect_type  text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  attempts     smallint not null default 0,
  error        text
);
create index on private.strava_events (received_at) where processed_at is null;

alter table private.strava_tokens enable row level security;
alter table private.strava_events enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
