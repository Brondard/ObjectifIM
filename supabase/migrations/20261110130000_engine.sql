-- Jalon 5 : moteur de replanification.
-- Règles et table de substitutions modifiables depuis l'app (réglages), règles souples ajoutées,
-- paramètres complétés.

create or replace function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models', 'engine_rules', 'substitutions']
$$;

create function private.seed_engine_v2(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, r.rule_key, r.kind, r.weight, r.params::jsonb, r.description
  from (values
    ('avoid_same_day_sessions', 'soft', 1, '{}',
       'Éviter de créer des jours à deux séances.'),
    ('avoid_consecutive_hard', 'soft', 2, '{}',
       'Éviter d''enchaîner deux jours durs (séance clé ou de qualité).'),
    ('planned_rpe_by_type', 'config', 1,
       '{"default_done_rpe": 4, "by_type": {"recovery": 2, "endurance": 3, "technique": 3, "long": 4, "tempo": 6,
         "race_pace": 6, "threshold": 7, "vo2": 8, "short_reps": 8, "race": 9, "strength_push": 5,
         "strength_pull": 5, "strength_legs": 6, "strength_core": 4, "other": 4}}',
       'RPE estimé d''une séance prévue selon son type, pour le ratio de charge.')
  ) as r (rule_key, kind, weight, params, description)
  where not exists (
    select 1 from public.engine_rules e
    where e.user_id = uid and e.rule_key = r.rule_key and e.deleted_at is null);

  -- Paramètres complétés, sans écraser une valeur déjà réglée.
  update public.engine_rules set params = '{"session_types": ["long"]}'::jsonb || params
   where user_id = uid and rule_key = 'long_session_protected';
  update public.engine_rules set params = '{"detect_ratio": 0.75}'::jsonb || params
   where user_id = uid and rule_key = 'deload_week_not_catchup';
end $$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_target_defaults(new.id);
  perform private.seed_engine_v2(new.id);
  return new;
end $$;

select private.seed_engine_v2(id) from auth.users;
