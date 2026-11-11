# Secret Santa 2026 — Neon Free + Render Free (v2.2)

## Nouveautés

- Bouton **« Déjà inscrit ? »** sous le formulaire : une personne peut retrouver
  son inscription sur un **autre téléphone ou navigateur**, en saisissant son
  prénom et son nom. Aucune création de compte ni code à noter. Cette option
  est également disponible **après le tirage**, quand les inscriptions sont fermées.
  Le nouvel appareil conserve ensuite sa session dans son propre navigateur.
- Interface mobile allégée : 2 champs avant l'inscription, puis uniquement
  « Inscription enregistrée ! » et un bloc « Mon espace » avec le résultat.
- Les participants ne voient plus la liste des autres, ni un champ/lien à copier.
- L'organisateur voit la liste privée, peut corriger ou supprimer des participants
  **avant le tirage**, puis lancer le tirage via son bouton.
- Notifications Web Push : au clic sur « Je participe ! », l'application
  demande directement la permission du navigateur compatible, puis abonne
  automatiquement l'appareil si la personne accepte. Aucun bouton supplementaire
  n'est necessaire pour les nouveaux inscrits ayant accepte. Les personnes deja
  inscrites peuvent encore utiliser « Activer les alertes » une fois.
  Un refus n'empeche jamais de s'inscrire. Le destinataire du cadeau n'est
  JAMAIS inclus dans la notification.
- Sauvegarde Neon conservée : données, tirage, abonnements push et clés VAPID
  sont stockés dans PostgreSQL. Les anciennes inscriptions déjà présentes sur
  Neon sont réutilisées, sans supprimer ni réinitialiser leur état.
- PWA installable sur téléphone ; ses ressources ne mettent jamais en cache les
  résultats du tirage.

## Mise à jour GitHub / Render

1. Si des participants sont déjà inscrits, vérifier qu'ils sont **bien sur
   Neon** ; une inscription encore stockée dans un ancien `data.json` local ne
   sera pas importée automatiquement. Conserver une sauvegarde privée.
2. **Décompresser** le ZIP, puis ouvrir le dépôt GitHub utilisé par Render.
3. À la racine du dépôt, utiliser `Add file` → `Upload files` et déposer
   **les fichiers**, pas le ZIP. Remplacer les anciens `index.html`,
   `server.js`, `storage.js` et `package.json` ; ajouter les nouveaux
   `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icon.svg`,
   `icon-192.png` et `icon-512.png`. `README.md` et `.gitignore` peuvent aussi
   être mis à jour.
4. Cliquer sur `Commit changes` (branche connectée à Render).
5. Vérifier sur Render : **Build Command : `npm install`**, **Start Command :
   `npm start`**. Attendre le statut `Live`.
6. Dans Render → `Environment`, conserver les 2 variables déjà configurées :
   `ADMIN_CODE` (code organisateur) et `DATABASE_URL` (lien PostgreSQL Neon).
   **Aucune nouvelle variable n'est requise pour les notifications.**
7. Dans Render → `Logs`, rechercher `Stockage : postgres` et
   `Notifications : Web Push`. Ne jamais mettre `DATABASE_URL` ni `ADMIN_CODE`
   dans les fichiers GitHub.

## Accès depuis un autre téléphone ou navigateur

1. Ouvrir l'adresse habituelle du Secret Santa.
2. Cliquer sur **« Déjà inscrit ? »** (visible même quand le tirage est terminé).
3. Saisir le même **Prénom** et le même **Nom** que lors de l'inscription
   puis toucher **« Retrouver mon espace »**.
4. La confirmation et le résultat personnel s'affichent automatiquement.
   Le navigateur mémorise la session pour les prochaines visites.

Le formulaire accepte les différences de majuscules et, si la correspondance
est unique, les accents. Si deux personnes ont des noms trop similaires,
il invite à contacter l'organisateur pour éviter une attribution incorrecte.
Il ne crée **jamais** une deuxième inscription.

**Confidentialité : cette méthode est volontairement moins sécurisée.** Toute
personne connaissant le prénom et le nom d'un participant peut consulter son
tirage en utilisant cette fonction. Il n'est donc **pas possible de garantir
un secret strict** avec cette méthode sans autre vérification. Une limite de
recherches réduit les tentatives massives, mais ne supprime pas ce risque.
Si tu veux une protection plus forte, utilise un code secret personnel ou une
authentification supplémentaire.

## Comment utiliser l'administration

Ouvrir le site, toucher « Accès organisateur » en bas, saisir `ADMIN_CODE` et
« Accéder à la liste ». Utiliser « Modifier » ou « Supprimer » pour les pseudos
ou les doublons. Une confirmation est demandée avant suppression.

Quand tous les participants sont inscrits, cliquer sur « Lancer le tirage au
sort ». L'action est définitive : elle ferme les inscriptions et bloque les
modifications/suppressions, pour ne pas invalider les cadeaux attribués.

## Notifications sur téléphone

- **Android et ordinateur** : en cliquant sur « Je participe ! », le navigateur
  peut demander directement d'autoriser les notifications. Si la personne
  accepte, l'abonnement est automatique. Un participant inscrit avant cette
  mise a jour peut cliquer sur « Activer les alertes » si ce bouton apparait.
- **iPhone/iPad (iOS/iPadOS 16.4+)** : s'inscrire dans Safari, toucher
  « Activer les alertes » pour obtenir l'aide ; utiliser Partager →
  « Sur l'écran d'accueil », **ouvrir ensuite l'icône installée**, puis
  cliquer sur « Activer les alertes » et accepter la demande. Si l'inscription
  est faite directement dans l'application deja installee, la demande apparait
  des le clic sur « Je participe ! ».
  L'application ouvre automatiquement le bon espace personnel grâce à son
  manifeste de lancement personnalisé, même si l'app installée a un stockage
  distinct de Safari.
- Chaque participant doit autoriser les notifications **avant le tirage**.
  La réception dépend de son navigateur, de ses réglages et du service push ;
  elle n'est pas garantie. Le résultat reste toujours accessible sur le site.
- Les clés de chiffrement VAPID sont générées une seule fois et sauvegardées
  sur Neon. Render fournit `RENDER_EXTERNAL_URL` automatiquement comme sujet
  VAPID ; rien à copier. Ne réinitialiser ni supprimer la base Neon.

## Données et sécurité

- L’URL `/?t=...` et le stockage du navigateur permettent de retrouver le bon
  espace sans afficher de lien dans l'interface. **Ne partagez pas cette URL**
  : elle donne accès au résultat personnel. La liste admin ne dévoile pas ces
  clés secrètes.
- Le serveur n'expose plus la liste complète des noms via `/api/state` :
  seuls le nombre et l'état du tirage sont publics.
- La liste admin, les corrections, les suppressions et le lancement du tirage
  exigent `ADMIN_CODE` à chaque appel serveur. Ce code reste uniquement en
  mémoire pendant l'administration, jamais enregistré dans le navigateur.
- Le serveur refuse de démarrer sur Render sans `DATABASE_URL`, pour éviter
  des inscriptions enregistrées dans un stockage éphémère.
- Si un participant est supprimé, son ancienne clé n'est plus valable ; il
  peut se réinscrire avant le tirage. Les appareils perdant leurs paramètres
  de notification peuvent les réactiver sur leur page personnelle.

## Vérifications

Les tests locaux utilisent un serveur Node et un simulateur de transport Web
Push pour vérifier API, conservation des données, protection admin et UX mobile.
L'envoi réel vers Chrome/Safari et la connexion à une vraie base Neon doivent
encore être vérifiés sur l'hébergement après déploiement.

Pour tester un véritable push de bout en bout, le faire dans un environnement
**de test distinct** avec 2 participants fictifs : ne pas lancer un tirage
« juste pour voir » sur un groupe réel déjà inscrit.

## Limite des autorisations

Les navigateurs imposent une autorisation explicite : aucune application web
ne peut activer des notifications systeme de force. Le refus ou les limites
du telephone ne bloquent ni l'inscription, ni la consultation du tirage.


## Réinitialiser depuis l’espace organisateur (v2.3)

- **Refaire le tirage** : disponible après un tirage. Efface les attributions et remet les notifications en attente, mais garde tous les participants et leurs accès personnels. Il faut confirmer en saisissant `REFAIRE LE TIRAGE`. Un nouveau tirage peut envoyer de nouvelles notifications.
- **Tout réinitialiser** : supprime toutes les inscriptions et les attributions dans Neon (irréversible sans sauvegarde). Il faut saisir `TOUT SUPPRIMER`. Les anciens liens personnels deviennent invalides et les participants doivent se réinscrire. Les clés Web Push du service restent en place.

Ces opérations nécessitent `ADMIN_CODE` et sont enregistrées directement en base. Les notifications déjà parties vers les téléphones ne peuvent pas être rappelées.
