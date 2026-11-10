# Secret Santa Noël 2026

Application Node.js sans dépendances externes.

## Démarrage

Node.js 20 ou plus récent :

```bash
ADMIN_CODE='un-code-long-et-secret' npm start
```

Ouvrez http://localhost:3000. Pour partager l'application avec d'autres personnes, déployez ce dossier sur un hébergeur Node.js avec un stockage **persistant**, configurez la variable d'environnement `ADMIN_CODE` et partagez son URL HTTPS.

**Important :** les inscriptions et les résultats sont conservés dans `data.json` sur le serveur. Utilisez un disque persistant, sans quoi ils seront perdus lors d'un redéploiement. Ne partagez jamais le code administrateur. Les liens personnels donnent accès aux résultats : ils doivent rester privés. Aucune réinitialisation du tirage n'est prévue.
