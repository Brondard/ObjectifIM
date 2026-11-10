-- Fondations : extensions, schéma privé, conventions communes (synchro, RLS), domaines métier.
-- Voir docs/schema.md § 1.

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Numéro de révision global : la synchro descendante demande « tout ce qui a _rev > curseur ».
create sequence private.sync_rev;

-- Posé sur chaque table : révision, updated_at, user_id immuable.
-- security definer car le rôle appelant n'a pas accès au schéma private (nextval).
create function private.touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new._rev := nextval('private.sync_rev');
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id is immutable';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Applique les conventions à une table : RLS + politique « mes lignes », trigger touch, index de synchro.
create function private.apply_conventions(t regclass) returns void
language plpgsql as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format(
    'create policy own_rows on %s for all to authenticated
       using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  execute format('create trigger touch before insert or update on %s for each row execute function private.touch()', t);
  execute format('create index on %s (user_id, _rev)', t);
end $$;

-- Énumérations : domaines text + check, modifiables sans recréer de type (cf. docs/schema.md § 1).
create domain public.discipline as text
  check (value in ('swim', 'bike', 'run', 'strength', 'other'));

create domain public.session_type as text
  check (value in (
    'endurance', 'long', 'recovery', 'tempo', 'threshold', 'vo2', 'short_reps', 'race_pace',
    'technique', 'strength_push', 'strength_pull', 'strength_legs', 'strength_core', 'race', 'other'));

create domain public.session_priority as text
  check (value in ('key', 'secondary', 'optional'));

create domain public.planned_status as text
  check (value in ('planned', 'completed', 'partial', 'skipped_choice', 'skipped_life', 'skipped_injury'));

create domain public.data_source as text
  check (value in ('manual', 'strava', 'samsung', 'test', 'race', 'pattern', 'import', 'engine'));

create domain public.side as text
  check (value in ('left', 'right', 'both', 'center'));

create domain public.rating5 as smallint
  check (value between 1 and 5);
