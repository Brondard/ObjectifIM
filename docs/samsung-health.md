# Samsung Health : investigation (jalon 9)

Investigation limitée à une demi-journée, comme demandé. Objectif : importer automatiquement sommeil, FC de repos et zones depuis la montre Samsung.

## Constat (novembre 2026)

| Voie | Ce qu'elle permet | Utilisable par une application web ? |
|---|---|---|
| **Samsung Health Data SDK** | Lecture des données Samsung Health (dont le sommeil) par une application Android qui intègre le SDK, sur le téléphone | Non : bibliothèque Android, exécutée sur l'appareil |
| **API web Samsung** | Aucune API web publique documentée par Samsung pour les données personnelles ; le forum développeurs de Samsung l'indique aussi | Non |
| **Health Connect (Android)** | Samsung Health y publie une partie de ses données ; lecture par une application Android disposant des permissions | Non : API Android, sur l'appareil |
| **Intermédiaires (Sahha, Terra, Thryve…)** | API serveur, alimentée par leur SDK installé dans une application Android | Non sans application Android, et service tiers payant qui reçoit les données de santé |
| **Export manuel** (Samsung Health → Paramètres → Télécharger les données personnelles) | Archive de fichiers CSV | Oui, mais par un import manuel et ponctuel, pas automatique |

Strava ne reçoit de la montre que les activités : ni le sommeil, ni la FC de repos.

## Conclusion

**Aucune voie propre n'existe pour une application web** : toutes passent par une application Android native, qui fait partie des non-objectifs du cahier des charges. Comme prévu dans ce cas, **la saisie manuelle du check-in matinal reste la voie retenue** (sommeil, FC de repos : une dizaine de secondes).

Le modèle de données est prêt pour un import futur sans migration : chaque champ du check-in porte sa source (`daily_logs.sources`, par exemple `{"hr_rest": "samsung"}`), et les repères ont une colonne `source`.

## Si l'on veut aller plus loin

1. **Import de l'export CSV** : faisable dans l'app (lecture du ZIP dans le navigateur, sommeil et FC rattachés au jour). À construire sur un vrai fichier d'export, dont le format n'est pas documenté publiquement.
2. **Petite application Android compagnon** : lit Health Connect et envoie à l'API de l'app. Seule voie automatique, hors périmètre actuel.

## Zones cardiaques

Samsung calcule les zones en pourcentage simple de la FC max. La méthode « % FC max (comme Samsung) » est disponible dans Réglages → Zones, et la méthode utilisée est affichée à côté de chaque cible.

## Sources

- [Samsung Health Data SDK : présentation](https://developer.samsung.com/health/data/overview.html)
- [Samsung Health Data SDK : introduction](https://developer.samsung.com/health/data/guide/introduction.html)
- [Nouveaux types de données du SDK (blog Samsung)](https://developer.samsung.com/health/blog/en/new-health-data-type-support-in-samsung-health-data-sdk)
- [Forum Samsung : accès depuis une application web](https://forum.developer.samsung.com/t/how-to-access-apis-for-fetching-samsung-wearables-data-in-a-web-app/36907)
- [Sahha : intégration Samsung Health](https://sahha.ai/integrations/samsung-health/)
- [Terra : accès développeurs Samsung Health](https://tryterra.co/blog/samsung-health-medicare-app-library-developer-access)
