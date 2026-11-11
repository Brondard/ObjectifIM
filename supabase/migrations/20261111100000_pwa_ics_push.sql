-- Jalon 8 : flux ICS d'abonnement, notifications push.

-- Jeton secret du flux d'agenda : l'URL est la seule protection, il doit être long et renouvelable.
alter table public.profiles add column ics_token text not null default encode(extensions.gen_random_bytes(24), 'hex');
create unique index on public.profiles (ics_token);

-- Jeton de l'utilisateur courant (pour afficher l'URL dans les réglages).
create function public.ics_token() returns text
language sql security definer set search_path = '' as $$
  select ics_token from public.profiles where user_id = auth.uid();
$$;
revoke all on function public.ics_token() from public, anon;
grant execute on function public.ics_token() to authenticated;

-- Renouveler le jeton invalide l'ancienne URL (agenda partagé par erreur, téléphone perdu).
create function public.rotate_ics_token() returns text
language sql security definer set search_path = '' as $$
  update public.profiles set ics_token = encode(extensions.gen_random_bytes(24), 'hex')
   where user_id = auth.uid()
  returning ics_token;
$$;
revoke all on function public.rotate_ics_token() from public, anon;
grant execute on function public.rotate_ics_token() to authenticated;

-- Côté serveur : retrouver l'utilisateur d'un jeton (flux ICS, sans session).
create function public.ics_user(p_token text) returns uuid
language sql security definer set search_path = '' as $$
  select user_id from public.profiles where ics_token = p_token and deleted_at is null;
$$;
revoke all on function public.ics_user(text) from public, anon, authenticated;
grant execute on function public.ics_user(text) to service_role;

-- Abonnements push enregistrés depuis l'appareil (via la synchro).
create or replace function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models', 'engine_rules', 'substitutions',
    'races', 'race_plans', 'checklists', 'nutrition_products', 'nutrition_protocols', 'tolerance_logs',
    'push_subscriptions']
$$;

-- Préférences de notification, réglables comme les autres paramètres.
create function private.seed_notifications(uid uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, 'notifications', 'config', 1,
         '{"evening_preview": true, "evening_unmarked": true}'::jsonb,
         'Notifications du soir : contenu de la séance du lendemain, séance du jour non renseignée.'
  where not exists (
    select 1 from public.engine_rules where user_id = uid and rule_key = 'notifications' and deleted_at is null);
$$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_target_defaults(new.id);
  perform private.seed_engine_v2(new.id);
  perform private.seed_checklists(new.id);
  perform private.seed_notifications(new.id);
  return new;
end $$;

select private.seed_notifications(id) from auth.users;
