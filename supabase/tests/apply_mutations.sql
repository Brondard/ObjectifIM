-- Test de la RPC apply_mutations, exécuté sur la base distante sans rien y laisser :
-- le bloc se termine toujours par une exception, ce qui annule toutes ses écritures.
--
--   npx supabase db query --remote --yes -f supabase/tests/apply_mutations.sql
--
-- Résultat attendu : une erreur « TESTS OK ». Toute autre erreur est un échec.
do $$
declare
  uid  uuid := (select id from auth.users order by created_at limit 1);
  sid  uuid := gen_random_uuid();
  r    jsonb;
  ok   int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. Création
  r := public.apply_mutations(jsonb_build_array(jsonb_build_object(
    'table', 'planned_sessions', 'id', sid, 'ts', 1000,
    'fields', jsonb_build_object('date', '2030-01-07', 'discipline', 'run', 'session_type', 'endurance',
                                 'target_duration_s', 3600))));
  assert r->0->>'status' = 'applied', 'création : ' || r::text;
  assert r->0->'row'->>'user_id' = uid::text, 'user_id posé par défaut';
  assert (r->0->'row'->'_field_ts'->>'date')::bigint = 1000, 'horodatage par champ';
  ok := ok + 1;

  -- 2. Modification avec une base à jour
  r := public.apply_mutations(jsonb_build_array(jsonb_build_object(
    'table', 'planned_sessions', 'id', sid, 'ts', 2000,
    'fields', jsonb_build_object('target_duration_s', 4500),
    'base', jsonb_build_object('target_duration_s', 3600))));
  assert r->0->>'status' = 'applied' and (r->0->'row'->>'target_duration_s')::int = 4500, 'mise à jour : ' || r::text;
  ok := ok + 1;

  -- 3. Base périmée et valeur différente : conflit, rien n'est écrasé
  r := public.apply_mutations(jsonb_build_array(jsonb_build_object(
    'table', 'planned_sessions', 'id', sid, 'ts', 3000,
    'fields', jsonb_build_object('target_duration_s', 3000, 'priority', 'key'),
    'base', jsonb_build_object('target_duration_s', 3600, 'priority', 'secondary'))));
  assert r->0->>'status' = 'conflict', 'conflit attendu : ' || r::text;
  assert r->0->'conflicts'->0->>'field' = 'target_duration_s', 'champ en conflit';
  assert (r->0->'row'->>'target_duration_s')::int = 4500, 'valeur serveur conservée';
  assert r->0->'row'->>'priority' = 'key', 'le champ sans conflit est appliqué';
  ok := ok + 1;

  -- 4. Écriture plus ancienne sans base : la plus récente gagne
  r := public.apply_mutations(jsonb_build_array(jsonb_build_object(
    'table', 'planned_sessions', 'id', sid, 'ts', 1500,
    'fields', jsonb_build_object('target_duration_s', 1200))));
  assert (r->0->'row'->>'target_duration_s')::int = 4500, 'dernière écriture gagnante : ' || r::text;
  ok := ok + 1;

  -- 5. Même valeur que le serveur malgré une base périmée : pas de conflit
  r := public.apply_mutations(jsonb_build_array(jsonb_build_object(
    'table', 'planned_sessions', 'id', sid, 'ts', 4000,
    'fields', jsonb_build_object('target_duration_s', 4500),
    'base', jsonb_build_object('target_duration_s', 1))));
  assert r->0->>'status' = 'applied', 'valeur identique : ' || r::text;
  ok := ok + 1;

  -- 6. Suppression logique et réalisé lié, en un seul appel
  r := public.apply_mutations(jsonb_build_array(
    jsonb_build_object('table', 'completed_sessions', 'id', gen_random_uuid(), 'ts', 5000,
      'fields', jsonb_build_object('planned_session_id', sid, 'local_date', '2030-01-07', 'discipline', 'run',
                                   'rpe', 4, 'match_status', 'confirmed')),
    jsonb_build_object('table', 'planned_sessions', 'id', sid, 'ts', 5000,
      'fields', jsonb_build_object('status', 'completed'))));
  assert r->0->>'status' = 'applied' and r->1->'row'->>'status' = 'completed', 'lot : ' || r::text;
  ok := ok + 1;

  -- 7. Table hors liste, colonne inconnue, valeur hors domaine : refusées
  begin
    perform public.apply_mutations('[{"table":"profiles","id":"00000000-0000-0000-0000-000000000001","ts":1,"fields":{}}]');
    assert false, 'table hors liste acceptée';
  exception when invalid_parameter_value then ok := ok + 1;
  end;
  begin
    perform public.apply_mutations(jsonb_build_array(jsonb_build_object(
      'table', 'planned_sessions', 'id', sid, 'ts', 6000, 'fields', jsonb_build_object('nope', 1))));
    assert false, 'colonne inconnue acceptée';
  exception when undefined_column then ok := ok + 1;
  end;
  begin
    perform public.apply_mutations(jsonb_build_array(jsonb_build_object(
      'table', 'planned_sessions', 'id', sid, 'ts', 6000, 'fields', jsonb_build_object('status', 'moved'))));
    assert false, 'statut retiré accepté';
  exception when check_violation then ok := ok + 1;
  end;

  -- 8. Un autre utilisateur ne voit pas la ligne et ne peut pas l'écraser
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.apply_mutations(jsonb_build_array(jsonb_build_object(
      'table', 'planned_sessions', 'id', sid, 'ts', 9000, 'fields', jsonb_build_object('target_duration_s', 60))));
    assert false, 'écriture sur la ligne d''un autre utilisateur acceptée';
  -- La ligne est invisible : la RPC tente une création, qui échoue (champs requis absents ou id déjà pris).
  exception when unique_violation or not_null_violation or insufficient_privilege then ok := ok + 1;
  end;

  raise exception 'TESTS OK (% / 10)', ok;
end $$;
