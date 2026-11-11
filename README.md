# ObjectifIM

Planification et suivi d'entraînement triathlon, objectif Ironman de Nice le 12 septembre 2027.
Next.js (App Router) · Supabase (Postgres, Auth, RLS, Storage) · Vercel.

- [docs/decisions.md](docs/decisions.md) : décisions d'architecture
- [docs/schema.md](docs/schema.md) : modèle de données et arbitrages
- [schemas/](schemas/) : JSON Schema publiés (générés depuis Zod), dont le format d'import des blocs ; exemple dans [schemas/examples](schemas/examples/)

## Démarrer

```bash
cp .env.example .env.local   # URL et clé publique du projet Supabase
npm install
npm run dev
```

## Scripts

| Script | Rôle |
|---|---|
| `npm test` | Tests de la logique métier pure (Vitest) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run db:push` | Applique les migrations de `supabase/migrations` au projet distant |
| `npm run gen:types` | Régénère `src/lib/supabase/database.types.ts` depuis la base |
| `npm run gen:schemas` | Régénère `schemas/*.json` depuis Zod (un test échoue s'ils divergent) |
| `npm run strava:subscribe -- <url>/api/strava/webhook` | Crée l’abonnement webhook Strava (une fois, app déployée) |
| `npx supabase db query --remote --yes -f supabase/tests/apply_mutations.sql` | Teste la RPC de synchro sur la base (tout est annulé ; attendu : « TESTS OK ») |

Le schéma ne se modifie **que** par une nouvelle migration versionnée, jamais dans l'interface Supabase.

## Organisation

```
src/domain/      logique métier pure et testée (aucun accès base ni réseau)
src/lib/time/    module unique de dates (fuseau Europe/Paris, changements d'heure)
src/lib/supabase clients Supabase et types générés
src/lib/sync/    copie locale (Dexie), file d'écritures, synchronisation
supabase/        configuration et migrations
```

## Avancement

| Jalon | Contenu | État |
|---|---|---|
| 1 | Schéma, migrations, RLS, types, auth | livré |
| 2 | Vues Aujourd'hui et Semaine, CRUD, validation en un geste | livré |
| 3 | Repères, zones, cibles | livré |
| 4 | Strava | livré (à brancher : app Strava + variables) |
| 5 | Moteur de replanification | livré |
| 6 | Analyse | livré |
| 7 | Courses | livré |
| 8 | PWA, hors ligne, notifications, ICS | livré |
| 9a | Construire le plan : import JSON/CSV/markdown idempotent, export, motifs de semaine, masse, rebours, séances types, vues Saison et Mois | livré |
| 9b | Musculation, matériel, météo, records, revue du dimanche, horaires piscine et club, check-in allégé | livré |
| 9 | Agenda personnel, heure de lever, soleil, « il y a un an », simulateur ; Samsung Health investigué ([docs/samsung-health.md](docs/samsung-health.md)) | livré |
