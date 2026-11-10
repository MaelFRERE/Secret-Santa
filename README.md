# Secret Santa Noël 2026 - version 1.3

## Corrections de cette version

Les sapins et la couche de neige du bas de page sont supprimés. Les flocons qui tombent, les couleurs de Noël et le budget de 10 à 15 euros (15 euros maximum) restent présents.

Les champs **Prénom** et **Nom**, l'un sous l'autre, restent visibles. L'ancienne version cachait tout le formulaire dès qu'un lien personnel était mémorisé dans le navigateur.

Avec une inscription existante, les champs sont préremplis. Le bouton **Enregistrer mes informations** permet de compléter ou corriger son prénom et son nom avant le tirage, sans ajouter un deuxième participant. Les inscriptions des anciennes versions qui contiennent seulement un prénom restent compatibles.

Un ancien lien invalide ne masque plus le formulaire : un message demande de vérifier l'inscription avec l'organisateur. Aucune inscription n'est supprimée automatiquement.

Après le tirage, les champs restent visibles mais ne sont plus modifiables. Les inscriptions restent fermées. Seul le code organisateur autorise le tirage ; chaque lien personnel donne accès au seul résultat de son titulaire.

## Mettre à jour un projet existant

**Avant toute modification du dépôt ou tout redéploiement, sauvegardez les données existantes en privé.** Le fichier `data.json` contient les noms, les liens secrets et les résultats : ne le publiez pas sur GitHub et ne le partagez pas avec les participants.

1. Décompressez le ZIP et ouvrez le dossier `secret-santa`.
2. Remplacez **ensemble** `index.html` et `server.js` dans votre dépôt, au même emplacement que les anciens fichiers. Ne créez pas un nouveau sous-dossier si les anciens fichiers sont à la racine.
3. Vous pouvez aussi remplacer `package.json`, `README.md` et ajouter `.gitignore`. Aucun fichier `data.json` n'est fourni et votre `ADMIN_CODE` n'est pas modifié par ce code.
4. Enregistrez les changements sur la branche connectée à Render. Utilisez le déploiement automatique s'il est activé, ou **Manual Deploy > Deploy latest commit**.
5. Quand le déploiement a réussi, rechargez la page de l'application.

Les deux fichiers de code doivent être mis à jour : la modification des noms utilise la nouvelle route `/api/profile` du serveur.

## Configuration du serveur

Cette application utilise un **Web Service Node.js**, pas un Static Site. Les commandes du projet restent :

- Build : `npm install`
- Start : `npm start`
- Variable obligatoire : `ADMIN_CODE`, avec votre code organisateur existant.

Le projet n'a aucune dépendance npm externe. Cette version a été testée avec Node.js 22.

### Stockage des inscriptions sur Render

Par défaut, Render utilise un système de fichiers temporaire. Sans stockage persistant, un redéploiement ou un redémarrage peut effacer les inscriptions et les tirages enregistrés localement. Cette mise à jour du code ne crée pas de disque persistant.

Le serveur lit toujours `data.json` dans son dossier de travail par défaut. Une variable optionnelle `DATA_FILE` permet maintenant de choisir un autre chemin.

Pour utiliser un disque persistant Render déjà configuré et monté sur `/var/data`, définissez :

```text
DATA_FILE=/var/data/data.json
```

**Ne changez pas ce chemin sans avoir sauvegardé et transféré le fichier existant vers le nouvel emplacement.** Un chemin vide crée une nouvelle liste, il ne déplace pas les anciennes inscriptions. Seuls les fichiers situés sous le point de montage du disque sont persistants. Render réserve les disques persistants aux services payants ; n'ajoutez pas de ressource payante sans en vérifier les conditions.

Ce stockage JSON est prévu pour une seule instance du serveur. Une base de données serait nécessaire pour plusieurs instances.

Documentation Render consultée le 10 novembre 2026 :
- Déploiements : https://render.com/docs/deploys
- Disques persistants : https://render.com/docs/disks

## Utilisation sur un appareil partagé

Avant de cliquer sur **Inscrire une autre personne**, conservez votre lien personnel affiché dans votre espace secret. Une confirmation est demandée. Le changement de session ne supprime pas votre inscription, mais retire votre lien mémorisé de ce navigateur. Chaque participant doit garder son propre lien confidentiel.

## Lancer sur ordinateur

Dans le dossier du projet :

macOS / Linux :
```bash
ADMIN_CODE='VotreCodeOrganisateur' npm start
```

Windows PowerShell :
```powershell
$env:ADMIN_CODE='VotreCodeOrganisateur'; npm start
```

Ouvrez ensuite `http://localhost:3000`. Ouvrir directement `index.html` permet seulement de voir le formulaire et le décor ; l'inscription requiert le serveur.

## Vérifications effectuées

Les tests automatisés vérifient l'inscription, les sessions mémorisées, les anciens liens invalides, la modification du nom sans doublon, les inscriptions anciennes, le changement de participant, les erreurs de connexion, les droits organisateur et les résultats secrets. La persistance des liens et du tirage a été vérifiée après redémarrage local du serveur avec le même fichier de données.

Les tests d'interface exécutent le JavaScript avec un DOM simulé ; aucun navigateur graphique n'était disponible pour une vérification visuelle. Aucun déploiement n'a été effectué sur votre compte Render.
