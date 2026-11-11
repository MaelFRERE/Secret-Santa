# Secret Santa 2026 — Neon Free + Render Free (v2)

## Nouveautés

- Interface mobile allégée : 2 champs avant l'inscription, puis uniquement
  « Inscription enregistrée ! » et un bloc « Mon espace » avec le résultat.
- Les participants ne voient plus la liste des autres, ni un champ/lien à copier.
- L'organisateur voit la liste privée, peut corriger ou supprimer des participants
  **avant le tirage**, puis lancer le tirage via son bouton.
- Notifications Web Push : les participants qui cliquent sur
  « Me prévenir du tirage » reçoivent une alerte navigateur lors du tirage,
  si leur appareil et leur navigateur le permettent. Le destinataire du cadeau
  n'est JAMAIS inclus dans la notification.
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

## Comment utiliser l'administration

Ouvrir le site, toucher « Accès organisateur » en bas, saisir `ADMIN_CODE` et
« Accéder à la liste ». Utiliser « Modifier » ou « Supprimer » pour les pseudos
ou les doublons. Une confirmation est demandée avant suppression.

Quand tous les participants sont inscrits, cliquer sur « Lancer le tirage au
sort ». L'action est définitive : elle ferme les inscriptions et bloque les
modifications/suppressions, pour ne pas invalider les cadeaux attribués.

## Notifications sur téléphone

- **Android et ordinateur** : un participant inscrit clique sur
  « Me prévenir du tirage », puis accepte la demande de notification.
- **iPhone/iPad (iOS/iPadOS 16.4+)** : s'inscrire dans Safari, toucher
  « Me prévenir du tirage » pour obtenir l'aide ; utiliser Partager →
  « Sur l'écran d'accueil », **ouvrir ensuite l'icône installée**, puis
  recliquer sur « Me prévenir du tirage » et accepter la demande.
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

- L'URL `/?t=...` et le stockage du navigateur permettent de retrouver le bon
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
