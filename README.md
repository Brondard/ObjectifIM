# ObjectifIM

Planification et suivi d'entraînement triathlon, objectif Ironman de Nice le 12 septembre 2027.
Next.js (App Router) · Supabase (Postgres, Auth, RLS, Storage) · Vercel.

- [docs/decisions.md](docs/decisions.md) : décisions d'architecture
- [docs/schema.md](docs/schema.md) : modèle de données et arbitrages
- [schemas/](schemas/) : JSON Schema publiés (générés depuis Zod)

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

Le schéma ne se modifie **que** par une nouvelle migration versionnée, jamais dans l'interface Supabase.

## Organisation

```
src/domain/      logique métier pure et testée (aucun accès base ni réseau)
src/lib/time/    module unique de dates (fuseau Europe/Paris, changements d'heure)
src/lib/supabase clients Supabase et types générés
supabase/        configuration et migrations
```

## Avancement

| Jalon | Contenu | État |
|---|---|---|
| 1 | Schéma, migrations, RLS, types, auth | livré |
| 2 | Vues Aujourd'hui et Semaine, CRUD, validation en un geste | |
| 3 | Repères, zones, cibles | |
| 4 | Strava | |
| 5 | Moteur de replanification | |
| 6 | Analyse | |
| 7 | Courses | |
| 8 | PWA, hors ligne, notifications, ICS | |
| 9 | Fonctionnalités reportées | |
