-- Synchronisation montante (docs/decisions.md D2).
--
-- Le client envoie des patchs : {table, id, fields, base, ts}
--   fields : les champs modifiés et leur nouvelle valeur
--   base   : la valeur de ces champs telle que le client la connaissait avant de les modifier
--   ts     : horodatage client (ms) de la modification
--
-- Pour chaque champ :
--   - valeur identique côté serveur        → rien à faire
--   - base connue et différente du serveur → quelqu'un d'autre a modifié ce champ entre-temps :
--                                             CONFLIT, renvoyé au client, rien n'est écrasé
--   - sinon, dernière écriture gagnante     → appliqué si ts ≥ horodatage serveur du champ
--
-- security invoker : la RLS s'applique, la fonction ne voit et n'écrit que les lignes de l'appelant.

create function public.apply_mutations(mutations jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  writable  constant text[] := array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes'];
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

revoke execute on function public.apply_mutations(jsonb) from public, anon;
grant execute on function public.apply_mutations(jsonb) to authenticated;
