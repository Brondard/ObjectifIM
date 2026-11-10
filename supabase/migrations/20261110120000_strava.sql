-- Jalon 4 : Strava.
-- Les jetons et la file du webhook vivent dans le schéma private, non exposé par l'API.
-- Le serveur (route Next, clé secrète Supabase) y accède par des fonctions réservées au rôle de service ;
-- le client ne voit qu'un état de connexion sans jeton.

alter table private.strava_tokens add column connected_at timestamptz not null default now();
alter table private.strava_tokens add column last_import_at timestamptz;

create function public.strava_save_connection(
  p_user uuid, p_athlete bigint, p_access text, p_refresh text, p_expires timestamptz, p_scopes text[]
) returns void
language sql security definer set search_path = '' as $$
  insert into private.strava_tokens (user_id, athlete_id, access_token, refresh_token, expires_at, scopes)
  values (p_user, p_athlete, p_access, p_refresh, p_expires, p_scopes)
  on conflict (user_id) do update set
    athlete_id = excluded.athlete_id, access_token = excluded.access_token,
    refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
    scopes = excluded.scopes, updated_at = now();
$$;

create function public.strava_update_tokens(p_user uuid, p_access text, p_refresh text, p_expires timestamptz) returns void
language sql security definer set search_path = '' as $$
  update private.strava_tokens
     set access_token = p_access, refresh_token = p_refresh, expires_at = p_expires, updated_at = now()
   where user_id = p_user;
$$;

create function public.strava_connection(p_user uuid default null, p_athlete bigint default null)
returns table (user_id uuid, athlete_id bigint, access_token text, refresh_token text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.user_id, t.athlete_id, t.access_token, t.refresh_token, t.expires_at
    from private.strava_tokens t
   where (p_user is not null and t.user_id = p_user) or (p_athlete is not null and t.athlete_id = p_athlete);
$$;

create function public.strava_delete_connection(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.strava_tokens where user_id = p_user;
$$;

create function public.strava_mark_import(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update private.strava_tokens set last_import_at = now() where user_id = p_user;
$$;

create function public.strava_enqueue_event(p jsonb) returns bigint
language sql security definer set search_path = '' as $$
  insert into private.strava_events (athlete_id, object_type, object_id, aspect_type, payload)
  values ((p->>'owner_id')::bigint, p->>'object_type', (p->>'object_id')::bigint, p->>'aspect_type', p)
  returning id;
$$;

create function public.strava_finish_event(p_id bigint, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update private.strava_events
     set processed_at = case when p_error is null then now() else processed_at end,
         attempts = attempts + 1, error = p_error
   where id = p_id;
$$;

create function public.strava_pending_events(p_limit int default 20)
returns setof private.strava_events
language sql security definer set search_path = '' as $$
  select * from private.strava_events
   where processed_at is null and attempts < 5
   order by received_at
   limit p_limit;
$$;

-- Réservées au serveur.
do $$
declare f text;
begin
  foreach f in array array[
    'strava_save_connection(uuid, bigint, text, text, timestamptz, text[])',
    'strava_update_tokens(uuid, text, text, timestamptz)',
    'strava_connection(uuid, bigint)',
    'strava_delete_connection(uuid)',
    'strava_mark_import(uuid)',
    'strava_enqueue_event(jsonb)',
    'strava_finish_event(bigint, text)',
    'strava_pending_events(int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Pour l'écran Réglages : état de la connexion de l'utilisateur courant, sans aucun jeton.
create function public.strava_status()
returns table (athlete_id bigint, scopes text[], connected_at timestamptz, last_import_at timestamptz,
               last_event_at timestamptz, failed_events bigint)
language sql security definer set search_path = '' as $$
  select t.athlete_id, t.scopes, t.connected_at, t.last_import_at,
         (select max(e.received_at) from private.strava_events e where e.athlete_id = t.athlete_id),
         (select count(*) from private.strava_events e
           where e.athlete_id = t.athlete_id and e.processed_at is null and e.attempts > 0)
    from private.strava_tokens t
   where t.user_id = auth.uid();
$$;
revoke all on function public.strava_status() from public, anon;
grant execute on function public.strava_status() to authenticated;
