-- Jalon 3 : repères et zones modifiables depuis le client, cible par défaut par type de séance.

-- La liste des tables synchronisables devient une fonction : l'étendre ne demande plus
-- de réécrire apply_mutations.
create function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models']
$$;
revoke all on function public.sync_writable_tables() from public, anon;
grant execute on function public.sync_writable_tables() to authenticated;

create or replace function public.apply_mutations(mutations jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  writable  constant text[] := public.sync_writable_tables();
  system    constant text[] := array['id', 'user_id', 'created_at', 'updated_at', '_rev', '_field_ts'];
  m         jsonb;
  tbl       text;
  rid       uuid;
  fields    jsonb;
  base      jsonb;
  ts        bigint;
  allowed   text[];
  has_fts   boolean;
  cur       jsonb;
  field_ts  jsonb;
  applied   jsonb;
  conflicts jsonb;
  k         text;
  v         jsonb;
  cols      text;
  row_out   jsonb;
  results   jsonb := '[]';
begin
  if auth.uid() is null then
    raise exception 'non authentifié' using errcode = '42501';
  end if;

  for m in select value from jsonb_array_elements(mutations) loop
    tbl    := m->>'table';
    rid    := (m->>'id')::uuid;
    fields := coalesce(m->'fields', '{}') - system;
    base   := coalesce(m->'base', '{}');
    ts     := (m->>'ts')::bigint;

    if not tbl = any (writable) then
      raise exception 'table non synchronisable : %', tbl using errcode = '22023';
    end if;

    select array_agg(column_name::text), bool_or(column_name = '_field_ts')
      into allowed, has_fts
      from information_schema.columns
     where table_schema = 'public' and table_name = tbl;

    for k in select jsonb_object_keys(fields) loop
      if not k = any (allowed) then
        raise exception 'colonne inconnue : %.%', tbl, k using errcode = '42703';
      end if;
    end loop;

    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', tbl) into cur using rid;

    applied   := '{}';
    conflicts := '[]';

    if cur is null then
      -- Création : tous les champs s'appliquent.
      applied  := fields;
      field_ts := coalesce((select jsonb_object_agg(key, ts) from jsonb_object_keys(fields) key), '{}');
    else
      field_ts := coalesce(cur->'_field_ts', '{}');
      for k, v in select key, value from jsonb_each(fields) loop
        continue when cur->k = v;
        if base ? k and (base->k) is distinct from (cur->k) then
          conflicts := conflicts || jsonb_build_object('field', k, 'server', cur->k, 'client', v, 'base', base->k);
        elsif coalesce((field_ts->>k)::bigint, 0) <= ts then
          applied  := applied || jsonb_build_object(k, v);
          field_ts := field_ts || jsonb_build_object(k, ts);
        end if;
      end loop;
    end if;

    if applied <> '{}' or cur is null then
      if not has_fts then
        field_ts := null;
      end if;
      select string_agg(format('%I', key), ', ') into cols from jsonb_object_keys(applied) key;

      if cur is null then
        execute format(
          'insert into public.%1$I (id%2$s%3$s) select $1%4$s%3$s from jsonb_populate_record(null::public.%1$I, $3)',
          tbl,
          case when has_fts then ', _field_ts' else '' end,
          coalesce(', ' || cols, ''),
          case when has_fts then ', $2' else '' end)
        using rid, field_ts, applied;
      else
        execute format(
          'update public.%1$I set (%2$s%3$s) = (select %2$s%4$s from jsonb_populate_record(null::public.%1$I, $3)) where id = $1',
          tbl, cols,
          case when has_fts then ', _field_ts' else ', updated_at' end,
          case when has_fts then ', $2' else ', now()' end)
        using rid, field_ts, applied;
      end if;
    end if;

    execute format('select to_jsonb(t) from public.%I t where id = $1', tbl) into row_out using rid;

    results := results || jsonb_build_object(
      'mutation_id', m->'mutation_id',
      'table', tbl,
      'id', rid,
      'status', case when jsonb_array_length(conflicts) = 0 then 'applied' else 'conflict' end,
      'conflicts', conflicts,
      'row', row_out);
  end loop;

  return results;
end $$;

-- Cible par défaut quand une séance n'en porte pas : zone par type de séance.
-- La grandeur jugée (FC, allure, puissance) vient de la règle intensity_judgement.
create function private.seed_target_defaults(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, 'default_intensity_by_type', 'config', 1,
    '{"endurance": 2, "long": 2, "recovery": 1, "tempo": 3, "threshold": 4, "vo2": 5,
      "short_reps": 5, "race_pace": null, "technique": 1, "race": null, "other": null}'::jsonb,
    'Zone cible par défaut d''une séance sans cible saisie, selon son type.'
  where not exists (
    select 1 from public.engine_rules e
    where e.user_id = uid and e.rule_key = 'default_intensity_by_type' and e.deleted_at is null);
end $$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_target_defaults(new.id);
  return new;
end $$;

select private.seed_target_defaults(id) from auth.users;
