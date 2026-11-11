# Secret Santa - version Neon Free pour GitHub + Render

## Installer sur GitHub

Les fichiers de ce ZIP sont a la racine pour etre deposes directement dans
le depot GitHub utilise par Render. Ne pas televerser le ZIP lui-meme :
decompresser puis envoyer les fichiers `index.html`, `server.js`, `storage.js`,
`package.json` et `.gitignore` a la racine du depot. `README.md` est facultatif.

## Render

Environment : `DATABASE_URL` doit contenir la chaine PostgreSQL complete
fournie par Neon. Garder `ADMIN_CODE` existant. Ne jamais publier ces secrets
sur GitHub. Build Command : `npm install`. Start Command : `npm start`.
Utiliser Node.js 22 ou plus. Les tables Neon sont creees automatiquement au
premier demarrage. Dans les logs Render, chercher `Stockage : postgres`.

## IMPORTANT : inscriptions existantes

Les inscriptions deja stockees dans `data.json` sur Render ne sont PAS migrees
automatiquement vers Neon. Sauvegarder les donnees existantes avant de deployer
si elles doivent etre conservees. Ne jamais publier `data.json` sur GitHub :
il contient les liens personnels et les resultats du tirage.

Si les anciennes donnees sont perdues et aucune sauvegarde n'existe, elles ne
peuvent pas etre recuperees par cette mise a jour.

## Fonctionnement

Le navigateur conserve les liens personnels lors des pannes et redemarrages.
La base Neon conserve inscriptions et tirage entre les redemarrages Render.
Le service gratuit Render peut toujours se mettre en veille ; cela n'efface
pas la base Neon. Neon Free reste soumis aux conditions et quotas du service.

Tests automatises : 8 tests passes sur le projet complet. Connexion a une
instance Neon reelle non testee ici.
