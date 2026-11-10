-- Forme du jour, gênes, entretien du matériel, nutrition.

-- Check-in et note du jour partagent la même clé (un jour) : une ligne par jour, tout facultatif.
create table public.daily_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  date          date not null,
  sleep_h       numeric(3, 1) check (sleep_h between 0 and 24),
  sleep_quality public.rating5,
  hr_rest       smallint check (hr_rest between 25 and 120),
  freshness     public.rating5,
  mood          public.rating5,
  soreness      public.rating5,
  motivation    public.rating5,
  note          text,
  sources       jsonb not null default '{}',  -- source par champ : {"hr_rest": "samsung"}
  _field_ts     jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  _rev          bigint not null default 0
);
select private.apply_conventions('public.daily_logs');
create unique index on public.daily_logs (user_id, date) where deleted_at is null;

create table public.niggles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  body_zone   text not null,
  side        public.side not null,
  started_on  date not null,
  context     text,
  resolved_on date,
  _field_ts   jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0,
  unique (id, user_id),
  check (resolved_on is null or resolved_on >= started_on)
);
select private.apply_conventions('public.niggles');
create index on public.niggles (user_id, body_zone, side, started_on) where deleted_at is null;

create table public.niggle_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  niggle_id  uuid not null,
  date       date not null,
  intensity  smallint not null check (intensity between 0 and 10),
  note       text,
  _field_ts  jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  _rev       bigint not null default 0,
  foreign key (niggle_id, user_id) references public.niggles (id, user_id) on delete cascade
);
select private.apply_conventions('public.niggle_entries');

create table public.equipment_maintenance (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  equipment_id uuid not null,
  component    text not null,
  done_on      date not null,
  at_km        numeric check (at_km >= 0),
  interval_km  numeric check (interval_km > 0),
  note         text,
  photo_path   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  _rev         bigint not null default 0,
  foreign key (equipment_id, user_id) references public.equipment (id, user_id) on delete cascade
);
select private.apply_conventions('public.equipment_maintenance');

-- Kilométrage cumulé : calculé, jamais stocké.
create view public.v_equipment_usage with (security_invoker = true) as
select
  e.id as equipment_id,
  e.user_id,
  e.initial_km + coalesce(sum(c.distance_m) / 1000.0, 0) as total_km,
  count(c.id) as session_count,
  max(c.local_date) as last_used_on
from public.equipment e
left join public.completed_sessions c
  on c.equipment_id = e.id and c.user_id = e.user_id and c.deleted_at is null
where e.deleted_at is null
group by e.id, e.user_id, e.initial_km;

create table public.nutrition_products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  brand       text,
  kind        text not null check (kind in ('gel', 'drink', 'bar', 'chew', 'food', 'other')),
  carbs_g     numeric check (carbs_g >= 0),
  sodium_mg   numeric check (sodium_mg >= 0),
  caffeine_mg numeric check (caffeine_mg >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.nutrition_products');

create table public.nutrition_protocols (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  carbs_per_h numeric not null check (carbs_per_h >= 0),
  items       jsonb not null default '[]',  -- [{product_id, every_min}]
  context     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  _rev        bigint not null default 0,
  unique (id, user_id)
);
select private.apply_conventions('public.nutrition_protocols');

create table public.tolerance_logs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users on delete cascade,
  date                 date not null,
  product_id           uuid not null,
  completed_session_id uuid,
  race_id              uuid,
  gi_rating            public.rating5 not null,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  _rev                 bigint not null default 0,
  foreign key (product_id, user_id) references public.nutrition_products (id, user_id) on delete cascade,
  foreign key (completed_session_id, user_id) references public.completed_sessions (id, user_id)
    on delete set null (completed_session_id),
  foreign key (race_id, user_id) references public.races (id, user_id) on delete set null (race_id)
);
select private.apply_conventions('public.tolerance_logs');
