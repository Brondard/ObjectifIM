-- Jalon 9b : musculation, matériel, lieux et créneaux, météo, check-in.

create or replace function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models', 'engine_rules', 'substitutions',
    'races', 'race_plans', 'checklists', 'nutrition_products', 'nutrition_protocols', 'tolerance_logs',
    'push_subscriptions',
    'seasons', 'phases', 'session_templates', 'week_templates', 'week_template_items', 'import_batches',
    'strength_exercises', 'equipment', 'equipment_maintenance', 'venues', 'venue_slots']
$$;

-- Lieu utilisé par une séance prévue (piscine, club) : le moteur ne la place que sur un créneau ouvert.
alter table public.planned_sessions add column venue_id uuid;
alter table public.planned_sessions
  add foreign key (venue_id, user_id) references public.venues (id, user_id) on delete set null (venue_id);

create function private.seed_life_quality(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Correction de chaleur : % d'allure par degré au-delà du seuil (arbitrage 7, affichée explicitement).
  update public.engine_rules set params = params || '{"heat_pct_per_c": 0.4}'::jsonb
   where user_id = uid and rule_key = 'intensity_judgement' and not params ? 'heat_pct_per_c';

  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, r.rule_key, r.kind, 1, r.params::jsonb, r.description
  from (values
    ('checkin_lighten', 'config',
     '{"bad_count": 2, "sleep_quality_max": 2, "freshness_max": 2, "mood_max": 2, "motivation_max": 2, "soreness_min": 4, "hr_rest_above_baseline": 7, "duration_ratio": 0.6}',
     'Check-in : à partir de deux indicateurs mauvais, proposer la version allégée de la séance du jour.'),
    ('weather', 'config',
     '{"rain_mm": 3, "rain_probability": 70, "home_lat": 43.6416, "home_lng": 7.0089}',
     'Météo : seuils de pluie pour proposer d''intervertir une séance extérieure ; lieu par défaut (Valbonne).'),
    ('equipment', 'config',
     '{"shoes_alert_km": 750}',
     'Matériel : seuil d''alerte par défaut des chaussures.'),
    ('pool_slots', 'hard',
     '{}',
     'Une séance rattachée à un lieu (piscine, club) n''est placée que sur un créneau ouvert de ce lieu.')
  ) as r (rule_key, kind, params, description)
  where not exists (select 1 from public.engine_rules e where e.user_id = uid and e.rule_key = r.rule_key and e.deleted_at is null);
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
  perform private.seed_life_quality(new.id);
  return new;
end $$;

select private.seed_life_quality(id) from auth.users;
