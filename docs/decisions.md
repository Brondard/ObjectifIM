# Décisions d'architecture

Journal des décisions validées. Le cahier des charges complet et ses arbitrages restent la référence fonctionnelle ; ce fichier fixe les choix techniques.

## Validées le 2026-11-10

| # | Sujet | Décision |
|---|---|---|
| D1 | Hors ligne | Couche de données côté client (TanStack Query + IndexedDB via Dexie + file d'écritures) posée dès le jalon 2. Les RSC servent à la structure des pages et aux réglages. |
| D2 | Synchronisation | UUID v7 générés côté client. Écritures par patchs via la RPC `apply_mutations`, dernière écriture gagnante par champ (`_field_ts`), conflits renvoyés à l'utilisateur. Synchro descendante par `_rev` (séquence). |
| D3 | Dates | Séance prévue = `date` + `time` local optionnel. Instants réels en `timestamptz` UTC. Un seul module `src/lib/time`. |
| D4 | Zones | Repères historisés (`metrics`), zones recalculées par fonction pure à la date de la séance. Méthode affichée partout. |
| D5 | Prévu / réalisé | Une séance prévue peut avoir plusieurs réalisations ; une réalisation ne couvre qu'une séance prévue. |
| D6 | Structure de séance | Zod source unique, JSON Schema généré et versionné dans `schemas/`. |
| D7 | Règles du moteur | Logique en code testé, paramètres en base (`engine_rules`, `phases.engine_params`). |
| D8 | Logique métier | TypeScript pur dans `src/domain/`, Vitest, exécutable côté client. Une seule application, pas de monorepo. |
| D9 | Charge | Charge principale = RPE × durée (Foster). Relative Effort Strava en secondaire. |
| D10 | Strava | Routes Next sur Vercel pour OAuth et webhook. Flux compressés dans Supabase Storage. Jetons dans le schéma `private`. |
| D11 | Outillage | npm, Vitest, Open-Meteo, Vercel Cron. Connexion par lien magique, inscriptions désactivées. Pas de Docker : migrations poussées sur le projet Supabase distant avec `supabase db push`. |
| D13 | Lecture côté client | Les écrans lisent la copie locale Dexie via `useLiveQuery`, réactive aux écritures locales comme aux synchros. TanStack Query n'est pas utilisé : il ferait doublon avec Dexie. Il reste disponible pour les appels purement réseau (Strava, météo). |
| D14 | Next 16 | `cacheComponents` désactivé : données pilotées côté client, et chaque lecture de session imposerait une frontière `<Suspense>`. |
| D15 | Écritures | Toute écriture de l'interface passe par `SyncEngine.mutate` (local d'abord, file d'attente, RPC `apply_mutations`). Seuls les écrans Saisons, non encore réécrits, passent par des Server Actions. |
| D16 | Cibles d’intensité | Une séance sans cible saisie prend la zone par défaut de son type (règle `default_intensity_by_type`), sur la grandeur qui juge ce type (règle `intensity_judgement`). Les bornes absolues sont recalculées à la date de la séance, avec la méthode et les repères affichés. Si un modèle ou un repère manque, l’écran le dit au lieu d’inventer. |
| D17 | Tables synchronisables | Liste tenue par `public.sync_writable_tables()` (lecture seule, sans risque) ; l’étendre ne demande plus de réécrire `apply_mutations`. Le schéma `private` reste fermé aux utilisateurs. |
| D18 | Strava côté serveur | Jetons et file du webhook dans `private`, lus par des fonctions `strava_*` réservées au rôle de service (clé secrète Supabase, serveur uniquement). Le client ne voit que `strava_status()`, sans jeton. Le webhook acquitte tout de suite et traite après la réponse (`after`) ; les échecs sont retentés chaque nuit (Vercel Cron). |
| D19 | Rapprochement | L’import propose (même jour, même discipline, durée la plus proche) ; l’utilisateur confirme toujours. Confirmer reprend RPE et ressenti d’une saisie manuelle et la retire pour ne pas compter deux fois le volume. |
| D20 | Flux | Téléchargés une fois depuis Strava (à la création via webhook, sinon à la demande), compressés dans Storage, mis en cache dans IndexedDB. L’analyse d’intensité tourne côté client et son résultat est gardé dans `completed_sessions.analysis` (versionné). |
| D21 | Moteur : périmètre | Une replanification ne déplace jamais une séance hors de sa semaine calendaire. Ordre de placement : sortie longue, séances clés, secondaires, optionnelles ; si aucun jour n’est valide, le moteur libère un jour en déplaçant (option A) ou en retirant (B, C) une ou deux séances secondaires, jamais une clé. |
| D22 | Rattrapage | « Rattraper » = replacer une séance déjà manquée. Anticiper une indisponibilité (« je pars ce week-end ») n’est pas un rattrapage. Limite : une par semaine calendaire, jamais en semaine allégée. |
| D23 | Maladie, blessure | Aucune compression ni rattrapage, pas même la sortie longue : la santé prime sur la règle 1. Deux options : reprise douce (première séance dure raccourcie de 30 %) ou reprise du plan. |
| D24 | Règle des +10 % | Une replanification dans la semaine n’ajoute jamais de volume : la règle ne peut donc pas éliminer d’option, elle s’affiche en alerte quand le plan dépasse déjà la référence. |
| D25 | Séance supprimée | Une séance retirée par le moteur passe en statut manqué (vie, blessure ou choix) avec une note, jamais supprimée : l’assiduité reste mesurable. Chaque choix est journalisé avec l’instantané de toutes les options proposées. |
| D26 | « Est-ce que je cours trop vite ? » | Deux mesures, jamais mélangées : la part des footings prévus faciles jugés trop intenses (règle FC), et la part du temps de course au-dessus de Z2 (zones de FC, séances prévues ou non). Sur 4 semaines. |
| D27 | Analyse par séance | Version 2 dans `completed_sessions.analysis` : verdict d’intensité, temps par zone, dérive cardiaque et décrochage de cadence (séances régulières d’une heure ou plus), blocs d’allure (structure entièrement chiffrée seulement, alignement approximatif). Calcul côté client, par lot de 60 au plus pour ménager la limite Strava. |
| D28 | Charge | RPE × minutes ; sans RPE saisi, RPE estimé selon le type prévu, sinon 4, et la part estimée est affichée. Ratio 7 j / 28 j quotidien, monotonie et contrainte de Foster par semaine. |
| D29 | GPX | Lu dans le navigateur (aucun envoi nécessaire au calcul) ; fichier gardé dans Storage. Dénivelé par hystérésis de 5 m après lissage sur ~100 m, profil tous les 100 m (200 m à vélo), montées de 30 m et 400 m minimum. Un profil par portion dans `races.course`. |
| D30 | Pacing | Course : coût de Minetti selon la pente à effort constant, facteur borné à [0,8 ; 3]. Vélo : puissance constante, modèle physique (masse, CdA, roulement, vitesse max 65 km/h) à recaler sur tes sorties. Plafonds de FC par paliers de la FC au seuil (90 % jusqu'à mi-course, 94 % jusqu'à 85 %, libre ensuite). |
| D31 | Plans de course | Un plan par portion (`race_plans.leg`) à identifiant déterministe par course et portion, plus un plan « full » pour le déroulé du matin. Tout est synchronisé localement : le mode course fonctionne sans réseau. |
| D32 | Hors ligne | Les données sont dans IndexedDB depuis le jalon 2 ; le service worker (`public/sw.js`) ne met en cache que l'application : fichiers statiques en cache d'abord, pages et requêtes RSC en réseau d'abord avec repli sur le cache. Écrans principaux mis en cache à l'installation ; fiches des séances d'hier à J+7 et des courses à venir (mode course compris) envoyées au service worker par l'app. Une redirection vers /login n'est jamais gardée. Enregistré en production seulement. |
| D33 | Notifications | Web Push (VAPID), une tâche Vercel Cron à 19:00 UTC, soit 20 h l'hiver et 21 h l'été à Paris (Vercel ne planifie qu'en UTC). Deux messages au plus, factuels : contenu de la séance de demain avec sa cible, séances du jour non renseignées. Préférences dans la règle `notifications`. Abonnement expiré (404/410) retiré. |
| D34 | Agenda ICS | Flux d'abonnement sur une URL à jeton secret de 48 caractères, renouvelable ; séances avec heure en UTC, sans heure sur la journée, manquées annulées. |
| D35 | Import de blocs | Format JSON v1 (contrat : `schemas/plan-block.v1.json`, Zod à l'import, aperçu avant écriture), CSV et markdown sommaires. Le fichier fait foi sur sa période : clé de séance (fournie, sinon date + discipline + rang) mise à jour sans changer d'identifiant, séances non réalisées absentes supprimées (ajouts à la main compris), réalisé jamais touché. |
| D36 | Motifs de semaine | Un motif appliqué produit un bloc, importé par le même mécanisme : réappliquer remplace au lieu de doubler. Progression par séance (+N min toutes les K semaines de charge, plafond) ; semaine allégée toutes les 3 ou 4 semaines à un pourcentage, où les séances clés passent secondaires et les structures sont retirées. |
| D37 | Rebours | Base, construction (30 %), spécifique (25 %), affûtage (2 semaines, 3 au-delà de 20) ; semaines du lundi au dimanche, dernière semaine = semaine de course. |
| D38 | Météo | Open-Meteo, sans clé, gardé en local 3 h (relu hors ligne), lieu dans la règle `weather` (Valbonne par défaut). Correction de chaleur : +0,4 % d'allure par degré au-delà de 20 °C, affichée à côté de la cible, jamais appliquée en silence. Pluie sur une séance longue ou clé extérieure : inversion proposée avec une séance d'un jour sec, appliquée seulement sur validation. |
| D39 | Matériel Strava | Importé depuis le profil Strava : son kilométrage du jour devient le départ, seules les activités suivantes s'y ajoutent (pas de double compte). Rattachement automatique par l'équipement de l'activité. |
| D40 | Records | Meilleurs efforts calculés sur les flux (temps sur 1, 5, 10 km, semi, marathon ; puissance 5, 20, 60 min), dans l'analyse de séance (version 3). |
| D41 | Check-in | Deux indicateurs mauvais (seuils dans la règle `checkin_lighten`, FC de repos comparée à sa médiane des 3 semaines) : version allégée proposée (60 % de la durée, zone 1 ou 2, sans structure), appliquée seulement sur validation et journalisée. |
| D12 | Musculation | Pas de détail des séries dans Strava (vérifié le 2026-11-10). Saisie dans l'app : « + Série » recopie la série précédente ou celle de la dernière séance ; progression par exercice (charge max, 1RM estimé d'Epley jusqu'à 12 répétitions). |

## Jugement de l'intensité (arbitrage 7)

Critère par type de séance : voir la table du cahier des charges. Précisions pour les séances jugées à la FC :

- Les **3 premières minutes** sont écartées (stabilisation, capteur optique à froid).
- On juge le **pourcentage de temps au-dessus du plafond de zone**, pas la moyenne. Seuil d'alerte par défaut : **15 %** (paramètre de `engine_rules.intensity_judgement`).
- Si la FC est aberrante (décrochage, incohérence avec l'allure), `hr_reliable = false` : l'allure et le RPE reprennent la main, et l'écran l'indique.
- Corrections de pente et de chaleur (> 20 °C) affichées explicitement, jamais appliquées en silence.

## Règle des +10 % (arbitrage 3)

Référence = **moyenne des 4 dernières semaines réalisées**. Contrainte dure sur les propositions du moteur, simple alerte sur le plan existant.
