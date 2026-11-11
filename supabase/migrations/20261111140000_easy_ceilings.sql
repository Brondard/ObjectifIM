-- Plafonds de footing en bpm absolus, par type de séance (et non une borne de zone).
-- Sortie longue : plafond relevé sur le dernier tiers.
create function private.seed_easy_ceilings(uid uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, 'easy_hr_ceilings', 'config', 1,
         '{"by_type": {"endurance": 150, "recovery": 150, "long": 150}, "long_end": 155, "long_end_from_pct": 67}'::jsonb,
         'Plafond de FC des séances faciles de course, en bpm, par type de séance. Sortie longue : long_end bpm à partir de long_end_from_pct % de la séance.'
  where not exists (select 1 from public.engine_rules where user_id = uid and rule_key = 'easy_hr_ceilings' and deleted_at is null);
$$;

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
  perform private.seed_wake(new.id);
  perform private.seed_easy_ceilings(new.id);
  return new;
end $$;

select private.seed_easy_ceilings(id) from auth.users;
