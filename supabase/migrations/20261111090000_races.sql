-- Jalon 7 : courses. Profil du parcours, plans de course par discipline, tables modifiables hors ligne,
-- modèles de checklist.

-- Profil calculé du GPX (distance, dénivelé, altitude rééchantillonnée, montées) : le fichier reste dans Storage.
alter table public.races add column course jsonb;

-- Un plan par portion (course à pied, vélo…) avec ses paramètres (objectif retenu, modèle vélo, paliers de FC).
alter table public.race_plans add column leg text not null default 'run' check (leg in ('swim', 'bike', 'run', 'full'));
alter table public.race_plans add column params jsonb not null default '{}';

create or replace function public.sync_writable_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'planned_sessions', 'completed_sessions', 'daily_logs', 'strength_sets',
    'niggles', 'niggle_entries', 'checklist_items', 'plan_changes',
    'metrics', 'zone_models', 'engine_rules', 'substitutions',
    'races', 'race_plans', 'checklists', 'nutrition_products', 'nutrition_protocols', 'tolerance_logs']
$$;

create function private.seed_checklists(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  tri uuid;
  run uuid;
begin
  if exists (select 1 from public.checklists where user_id = uid and is_template) then
    return;
  end if;
  insert into public.checklists (user_id, name, is_template) values (uid, 'Triathlon', true) returning id into tri;
  insert into public.checklists (user_id, name, is_template) values (uid, 'Course à pied', true) returning id into run;

  insert into public.checklist_items (user_id, checklist_id, label, position)
  select uid, tri, label, ord from unnest(array[
    'Licence ou certificat, pièce d''identité', 'Combinaison', 'Lunettes (2 paires) et bonnet', 'Trifonction',
    'Vélo révisé, pneus gonflés', 'Casque', 'Chaussures vélo', 'Bidons remplis', 'Kit réparation, CO2, chambre à air',
    'Chaussures de course, lacets rapides', 'Ceinture porte-dossard', 'Casquette, lunettes de soleil',
    'Gels et barres selon le plan', 'Crème solaire, anti-frottement', 'Montre chargée', 'Petit-déjeuner du matin'
  ]) with ordinality as t(label, ord);

  insert into public.checklist_items (user_id, checklist_id, label, position)
  select uid, run, label, ord from unnest(array[
    'Dossard et épingles', 'Chaussures de course', 'Tenue selon la météo', 'Gels selon le plan',
    'Anti-frottement', 'Montre chargée', 'Ceinture ou flasque', 'Petit-déjeuner du matin', 'Vêtement chaud jetable pour le départ'
  ]) with ordinality as t(label, ord);
end $$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_target_defaults(new.id);
  perform private.seed_engine_v2(new.id);
  perform private.seed_checklists(new.id);
  return new;
end $$;

select private.seed_checklists(id) from auth.users;
