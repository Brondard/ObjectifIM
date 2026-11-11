-- Jalon 9 : agenda personnel en lecture seule (adresse secrète iCal), heure de lever.

-- L'adresse secrète donne accès à tout l'agenda : elle reste côté serveur, jamais renvoyée au client.
create table private.calendar_feeds (
  user_id    uuid primary key references auth.users on delete cascade,
  url        text not null check (url ~ '^https://'),
  updated_at timestamptz not null default now()
);
alter table private.calendar_feeds enable row level security;
revoke all on private.calendar_feeds from public, anon, authenticated;

-- Enregistrer ou retirer l'adresse (l'utilisateur courant uniquement).
create function public.calendar_set_url(p_url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_url is null or p_url = '' then
    delete from private.calendar_feeds where user_id = auth.uid();
  else
    insert into private.calendar_feeds (user_id, url) values (auth.uid(), p_url)
    on conflict (user_id) do update set url = excluded.url, updated_at = now();
  end if;
end $$;
revoke all on function public.calendar_set_url(text) from public, anon;
grant execute on function public.calendar_set_url(text) to authenticated;

-- L'écran sait seulement si un agenda est branché.
create function public.calendar_connected() returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from private.calendar_feeds where user_id = auth.uid());
$$;
revoke all on function public.calendar_connected() from public, anon;
grant execute on function public.calendar_connected() to authenticated;

-- Côté serveur : l'adresse de l'utilisateur, pour lire l'agenda.
create function public.calendar_url(p_user uuid) returns text
language sql security definer set search_path = '' as $$
  select url from private.calendar_feeds where user_id = p_user;
$$;
revoke all on function public.calendar_url(uuid) from public, anon, authenticated;
grant execute on function public.calendar_url(uuid) to service_role;

create function private.seed_wake(uid uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, 'wake', 'config', 1, '{"prep_min": 30, "morning_before": "10:00"}'::jsonb,
         'Heure de lever : départ de la séance moins la préparation et le trajet vers le lieu.'
  where not exists (select 1 from public.engine_rules where user_id = uid and rule_key = 'wake' and deleted_at is null);
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
  return new;
end $$;

select private.seed_wake(id) from auth.users;
