-- Jalon 9a : construire le plan depuis l'app. Saisons, phases, séances types, motifs de semaine et
-- lots d'import deviennent modifiables hors ligne ; bibliothèque de séances types pré-remplie.

create or replace function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models', 'engine_rules', 'substitutions',
    'races', 'race_plans', 'checklists', 'nutrition_products', 'nutrition_protocols', 'tolerance_logs',
    'push_subscriptions',
    'seasons', 'phases', 'session_templates', 'week_templates', 'week_template_items', 'import_batches']
$$;

create function private.seed_session_templates(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.session_templates where user_id = uid) then
    return;
  end if;
  insert into public.session_templates (user_id, name, discipline, session_type, default_duration_s, target_intensity, structure, instructions, tags)
  values
    (uid, 'Footing Z2', 'run', 'endurance', 2700, '{"basis":"hr","zone":2}', null, 'Aisance respiratoire, on peut parler.', '{course}'),
    (uid, 'Sortie longue', 'run', 'long', 5400, '{"basis":"hr","zone":2}', null, 'Régulier, ravitaillement testé à partir de 60 min.', '{course}'),
    (uid, 'Récupération', 'run', 'recovery', 1800, '{"basis":"hr","zone":1}', null, 'Très facile, court.', '{course}'),
    (uid, 'VMA 10 × 400 m', 'run', 'short_reps', 3600, null,
      '{"version":1,"steps":[{"kind":"warmup","duration_s":1200},{"kind":"repeat","times":10,"steps":[{"kind":"work","distance_m":400,"intensity":{"basis":"pace","zone":5}},{"kind":"recovery","duration_s":75}]},{"kind":"cooldown","duration_s":600}]}',
      'Allure de VMA, récupération trottinée.', '{course,qualité}'),
    (uid, 'Seuil 3 × 10 min', 'run', 'threshold', 3600, null,
      '{"version":1,"steps":[{"kind":"warmup","duration_s":1200},{"kind":"repeat","times":3,"steps":[{"kind":"work","duration_s":600,"intensity":{"basis":"pace","zone":4}},{"kind":"recovery","duration_s":120}]},{"kind":"cooldown","duration_s":600}]}',
      'Au seuil, contrôlé : la dernière répétition doit ressembler à la première.', '{course,qualité}'),
    (uid, 'Natation technique', 'swim', 'technique', 2700, '{"basis":"swim_pace","zone":1}', null, 'Éducatifs, respiration bilatérale.', '{natation}'),
    (uid, 'Natation endurance', 'swim', 'endurance', 2700, '{"basis":"swim_pace","zone":2}', null, 'Séries longues à allure régulière.', '{natation}'),
    (uid, 'Home trainer Z2', 'bike', 'endurance', 3600, '{"basis":"power","zone":2}', null, 'Cadence 85-95 tr/min.', '{vélo}'),
    (uid, 'Sortie vélo longue', 'bike', 'long', 10800, '{"basis":"power","zone":2}', null, 'Ravitaillement selon le protocole de course.', '{vélo}'),
    (uid, 'Muscu Push', 'strength', 'strength_push', 2700, null, null, 'Développé couché, militaire, dips, triceps.', '{musculation}'),
    (uid, 'Muscu Pull', 'strength', 'strength_pull', 2700, null, null, 'Tractions, rowing, face pull, biceps.', '{musculation}'),
    (uid, 'Muscu Jambes', 'strength', 'strength_legs', 2700, null, null, 'Squat, soulevé de terre roumain, fentes, mollets.', '{musculation}');
end $$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_target_defaults(new.id);
  perform private.seed_engine_v2(new.id);
  perform private.seed_checklists(new.id);
  perform private.seed_notifications(new.id);
  perform private.seed_session_templates(new.id);
  return new;
end $$;

select private.seed_session_templates(id) from auth.users;
