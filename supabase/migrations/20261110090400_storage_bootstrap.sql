-- Buckets privés et amorçage d'un nouvel utilisateur (profil, règles du moteur, bibliothèques).

insert into storage.buckets (id, name, public)
values ('streams', 'streams', false), ('gpx', 'gpx', false), ('photos', 'photos', false)
on conflict (id) do nothing;

-- Chaque objet vit sous {user_id}/…
create policy own_objects on storage.objects for all to authenticated
  using (
    bucket_id in ('streams', 'gpx', 'photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id in ('streams', 'gpx', 'photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Valeurs par défaut d'un utilisateur. Idempotent : peut être rejoué sans doublon.
create function private.seed_user_defaults(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (uid) on conflict do nothing;

  -- Règles du moteur (cahier des charges, arbitrages 3 à 7).
  insert into public.engine_rules (user_id, rule_key, kind, weight, params, description)
  select uid, r.rule_key, r.kind, r.weight, r.params::jsonb, r.description
  from (values
    ('long_session_protected',       'hard', 1, '{}',
       'La sortie longue peut être déplacée dans la semaine, jamais supprimée ni coupée en deux.'),
    ('min_gap_key_same_discipline',  'hard', 1, '{"hours": 48}',
       'Écart minimum entre deux séances clés de la même discipline.'),
    ('no_leg_strength_before_key',   'hard', 1, '{"hours_before_key": 24, "days_before_a_race": 10}',
       'Pas de musculation des jambes avant une séance clé ni avant une course A.'),
    ('max_consecutive_run_days',     'hard', 1, '{"default": 2, "by_phase_type": {"base": 2, "return": 2, "build": 3}}',
       'Jours consécutifs de course à pied ; surchargé par phases.engine_params.'),
    ('a_race_week_frozen',           'hard', 1, '{}',
       'Aucune séance déplacée dans la semaine d''une course A.'),
    ('max_weekly_volume_increase',   'hard', 1, '{"pct": 10, "reference_weeks": 4}',
       'Volume proposé ≤ moyenne des 4 dernières semaines réalisées + 10 %. Alerte seule sur le plan existant.'),
    ('deload_week_not_catchup',      'hard', 1, '{}',
       'Une semaine allégée n''est jamais une semaine de rattrapage ; aucun déplacement ne franchit sa frontière.'),
    ('catchup_limit',                'hard', 1, '{"max_per_week": 1}',
       'On ne rattrape jamais plus d''une séance manquée par semaine calendaire.'),
    ('preserve_weekly_volume',       'soft', 3, '{"tolerance_pct": 15}',
       'Préserver le volume hebdomadaire total.'),
    ('preserve_discipline_split',    'soft', 2, '{}',
       'Préserver la répartition entre disciplines.'),
    ('long_session_weekend',         'soft', 2, '{"weekdays": [6, 7]}',
       'Garder la sortie longue le week-end.'),
    ('club_wednesday_evening',       'soft', 2, '{"weekday": 3}',
       'Garder la séance de club le mercredi soir.'),
    ('swim_morning',                 'soft', 1, '{"time": "07:30"}',
       'Garder la natation le matin.'),
    ('max_move_days',                'soft', 1, '{"days": 2}',
       'Éviter de déplacer une séance de plus de 2 jours.'),
    ('prefer_drop_optional',         'soft', 2, '{}',
       'Préférer supprimer une séance optionnelle plutôt que comprimer le reste.'),
    ('intensity_judgement',          'config', 1,
       '{"hr_skip_first_s": 180, "hr_above_ceiling_alert_pct": 15, "heat_correction_from_c": 20,
         "by_session_type": {"endurance": "hr", "long": "hr", "recovery": "hr",
                             "short_reps": "pace", "vo2": "pace",
                             "threshold": "pace_then_hr", "tempo": "pace_then_hr", "race_pace": "both"},
         "swim": "swim_pace", "bike": "power_else_hr"}',
       'Critère de jugement de l''intensité par type de séance (arbitrage 7).'),
    ('load_ratio',                   'config', 1,
       '{"acute_days": 7, "chronic_days": 28, "high": 1.5, "low": 0.8}',
       'Ratio charge aiguë / chronique.')
  ) as r (rule_key, kind, weight, params, description)
  where not exists (
    select 1 from public.engine_rules e
    where e.user_id = uid and e.rule_key = r.rule_key and e.deleted_at is null);

  -- Bibliothèque Push / Pull / Legs ; loads_legs alimente la règle des 24 h.
  insert into public.strength_exercises (user_id, name, muscle_groups, is_unilateral, loads_legs, default_rest_s)
  select uid, x.name, x.groups, x.unilateral, x.legs, x.rest
  from (values
    ('Développé couché',            array['pectoraux', 'triceps', 'épaules'], false, false, 120),
    ('Développé militaire',         array['épaules', 'triceps'],              false, false, 120),
    ('Dips',                        array['pectoraux', 'triceps'],            false, false, 90),
    ('Pompes',                      array['pectoraux', 'triceps'],            false, false, 60),
    ('Élévations latérales',        array['épaules'],                         false, false, 60),
    ('Extension triceps poulie',    array['triceps'],                         false, false, 60),
    ('Tractions',                   array['dos', 'biceps'],                   false, false, 120),
    ('Tirage vertical',             array['dos', 'biceps'],                   false, false, 90),
    ('Rowing barre',                array['dos', 'biceps'],                   false, false, 120),
    ('Rowing haltère',              array['dos', 'biceps'],                   true,  false, 90),
    ('Face pull',                   array['épaules', 'haut du dos'],          false, false, 60),
    ('Curl biceps',                 array['biceps'],                          false, false, 60),
    ('Rotation externe élastique',  array['coiffe des rotateurs'],            true,  false, 45),
    ('Squat',                       array['quadriceps', 'fessiers'],          false, true,  150),
    ('Soulevé de terre roumain',    array['ischios', 'fessiers', 'lombaires'],false, true,  150),
    ('Fentes bulgares',             array['quadriceps', 'fessiers'],          true,  true,  90),
    ('Presse à cuisses',            array['quadriceps', 'fessiers'],          false, true,  120),
    ('Hip thrust',                  array['fessiers', 'ischios'],             false, true,  90),
    ('Step-up',                     array['quadriceps', 'fessiers'],          true,  true,  90),
    ('Leg curl',                    array['ischios'],                         false, true,  60),
    ('Mollets debout',              array['mollets'],                         false, true,  60),
    ('Gainage',                     array['sangle abdominale'],               false, false, 45),
    ('Gainage latéral',             array['obliques'],                        true,  false, 45),
    ('Pallof press',                array['sangle abdominale', 'obliques'],   true,  false, 45)
  ) as x (name, groups, unilateral, legs, rest)
  where not exists (
    select 1 from public.strength_exercises s
    where s.user_id = uid and lower(s.name) = lower(x.name) and s.deleted_at is null);

  -- Table de correspondance du mode déplacement (modifiable dans les réglages).
  if not exists (select 1 from public.substitutions where user_id = uid) then
    insert into public.substitutions
      (user_id, from_discipline, from_session_type, to_discipline, to_session_type, to_label, duration_ratio, loss_note)
    values
      (uid, 'bike', 'endurance', 'run', 'endurance', 'Course à pied en Z2', 0.75,
       'Impact plus élevé, aucun travail de pédalage ni de position.'),
      (uid, 'bike', 'endurance', 'other', 'endurance', 'Marche rapide', 1.25,
       'Stimulus cardio plus faible, aucun travail spécifique vélo.'),
      (uid, 'swim', 'technique', 'strength', 'strength_core', 'Gainage et élastiques épaules', 1.0,
       'Aucune sensation d''eau ni travail technique de nage.'),
      (uid, 'swim', 'endurance', 'strength', 'strength_core', 'Élastiques épaules + gainage', 0.75,
       'Perte de l''endurance spécifique natation.'),
      (uid, 'run', 'endurance', 'bike', 'endurance', 'Vélo d''appartement en Z2', 1.3,
       'Moins d''impact : la tolérance mécanique de la course ne progresse pas.');
  end if;
end $$;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_user_defaults(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
