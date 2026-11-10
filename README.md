# Secret Santa Noël 2026

Application Secret Santa avec ambiance de Noël, tirage secret, budget conseillé de **10 € à 15 €**, et formulaire d'inscription avec **Prénom + Nom**.

## Fonctionnalités

- inscription des participants avec prénom et nom ;
- design festif : flocons qui tombent, sapins et ambiance enneigée ;
- tirage réservé à l'organisateur grâce à `ADMIN_CODE` ;
- chaque participant voit uniquement son propre résultat ;
- lien personnel à conserver après inscription.

## Lancement en local

1. Décompressez le ZIP.
2. Installez **Node.js 20** ou supérieur.
3. Ouvrez un terminal dans le dossier du projet.
4. Démarrez l'application :

### macOS / Linux
```bash
ADMIN_CODE='MonCodeSecret2026' npm start
```

### Windows PowerShell
```powershell
$env:ADMIN_CODE='MonCodeSecret2026'; npm start
```

5. Ouvrez **http://localhost:3000**.

## Déploiement sur Render

Créez un **Web Service** (et non un Static Site) avec ces réglages :

- **Build Command** : `npm install`
- **Start Command** : `npm start`
- **Environment Variable** : `ADMIN_CODE=VotreCodeSecret`

Le fichier `data.json` est utilisé pour stocker les participants et les résultats. Pour un usage réel, pensez à configurer un stockage persistant sur Render.

## Important

N'ouvrez pas simplement `index.html` depuis le ZIP : l'application doit tourner via le serveur Node.js pour que les inscriptions fonctionnent.
