# Bot Discord - Salon Vocal Privé Automatique

Ce bot Discord crée automatiquement des salons vocaux privés lorsqu'un utilisateur rejoint un salon vocal spécifique.

## 📋 Fonctionnalités

- ✅ Crée automatiquement un salon vocal privé quand quelqu'un clique sur le salon déclencheur
- ✅ Déplace automatiquement la personne dans son nouveau salon
- ✅ Le salon est invisible pour tout le monde sauf :
  - Le propriétaire du salon
  - Les administrateurs/gestionnaires du serveur
- ✅ Limité à 1 personne
- ✅ Supprime automatiquement le salon quand la personne se déconnecte ou change de salon

## 🚀 Installation

### Étape 1 : Installer Node.js

Téléchargez et installez Node.js depuis [nodejs.org](https://nodejs.org/) (version 18 ou supérieure recommandée).

### Étape 2 : Créer le bot sur Discord

1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Cliquez sur **"New Application"** et donnez un nom à votre application
3. Allez dans l'onglet **"Bot"** à gauche
4. Cliquez sur **"Add Bot"** et confirmez
5. Sous **"Token"**, cliquez sur **"Reset Token"** puis **"Copy"** → **SAUVEZ CETTE TOKEN** (vous ne la verrez qu'une fois !)
6. Désactivez **"Public Bot"** (si vous ne voulez pas que d'autres serveurs l'utilisent)
7. Activez les **Privileged Gateway Intents** suivants :
   - ✅ **Server Members Intent** (nécessaire pour détecter les membres)
8. Allez dans l'onglet **"OAuth2"** → **"URL Generator"**
9. Sélectionnez les **Scopes** :
   - ✅ `bot`
   - ✅ `applications.commands`
10. Sélectionnez les **Bot Permissions** :
    - ✅ View Channels
    - ✅ Connect (Voice)
    - ✅ Speak (Voice)
    - ✅ Manage Channels
    - ✅ Move Members
11. Copiez l'URL générée en bas et ouvrez-la dans votre navigateur
12. Sélectionnez votre serveur Discord et autorisez le bot

### Étape 3 : Configurer le bot sur votre serveur

1. Sur Discord, créez un salon vocal (ou utilisez un salon existant) qui servira de "salon déclencheur"
2. **Cliquez droit sur ce salon** → **Copier l'ID** (si vous ne voyez pas cette option, activez le Mode Développeur dans Discord : Paramètres → Avancé → Mode Développeur)
3. Configurez les permissions du salon :
   - **Cliquez droit sur le salon déclencheur** → **Modifier le salon**
   - Allez dans l'onglet **Permissions**
   - Cliquez sur **"+ Ajouter des membres ou des rôles"**
   - Sélectionnez le(s) rôle(s) qui doivent pouvoir utiliser ce salon
   - Assurez-vous que pour **@everyone**, les permissions sont désactivées (sauf pour le(s) rôle(s) autorisé(s))
   - Enregistrez les changements

### Étape 4 : Installer les dépendances du projet

Ouvrez un terminal dans le dossier du projet et exécutez :

```bash
npm install
```

### Étape 5 : Configurer les variables d'environnement

1. Copiez le fichier `.env.example` en `.env` :
   ```bash
   copy .env.example .env
   ```
   (ou sur Linux/Mac : `cp .env.example .env`)

2. Ouvrez le fichier `.env` et remplissez les valeurs :
   - `BOT_TOKEN` : Le token que vous avez copié à l'étape 2
   - `TRIGGER_CHANNEL_ID` : L'ID du salon déclencheur (étape 3)
   - `GUILD_ID` : L'ID de votre serveur Discord (cliquez droit sur votre serveur → Copier l'ID)

### Étape 6 : Lancer le bot

```bash
npm start
```

Vous devriez voir : `✅ Bot connecté en tant que [Nom du Bot]`

## 🎯 Comment ça fonctionne ?

1. Un utilisateur avec le bon rôle clique sur le salon vocal déclencheur
2. Le bot détecte cette action et crée automatiquement un salon vocal privé
3. L'utilisateur est déplacé automatiquement dans son nouveau salon
4. Le salon est invisible pour tous sauf l'utilisateur et les admins
5. Quand l'utilisateur quitte le salon ou se déconnecte, le salon est automatiquement supprimé

## ⚙️ Configuration

### Modifier le nom des salons créés

Dans `index.js`, ligne avec `name:`, changez :
```javascript
name: `🔒 Salon de ${member.displayName}`,
```
Par exemple :
```javascript
name: `🔒 Privé - ${member.displayName}`,
```

### Modifier la catégorie

Le bot crée automatiquement les salons dans la même catégorie que le salon déclencheur. Si vous voulez forcer une catégorie spécifique, vous pouvez modifier le code dans `index.js`.

## 🛠️ Dépannage

### Le bot ne se connecte pas
- Vérifiez que le token dans `.env` est correct
- Vérifiez que vous avez activé les intents nécessaires sur le Discord Developer Portal

### Le bot ne crée pas de salon
- Vérifiez que l'ID du salon déclencheur dans `.env` est correct
- Vérifiez que le bot a les permissions "Gérer les salons" et "Déplacer les membres"
- Vérifiez que l'utilisateur qui clique a bien le rôle avec les permissions sur le salon

### Les salons ne sont pas invisibles
- Vérifiez que le bot a bien la permission "Gérer les salons"
- Les salons sont visibles par les admins/gestionnaires par défaut (c'est normal)

## 📝 Notes

- Le bot doit avoir les permissions nécessaires sur votre serveur
- Les salons créés sont automatiquement supprimés quand ils sont vides
- Si le bot redémarre, les salons existants restent mais ne seront pas suivis jusqu'à ce qu'ils soient vides

## 🔒 Sécurité

⚠️ **NE PARTAGEZ JAMAIS VOTRE FICHIER `.env`** - Il contient votre token de bot qui donne un accès complet à votre bot !

## 📚 Ressources

- [Documentation Discord.js](https://discord.js.org/#/docs)
- [Discord Developer Portal](https://discord.com/developers/applications)

## 🆘 Support

Si vous avez des problèmes, vérifiez :
1. Que Node.js est installé (`node --version`)
2. Que toutes les dépendances sont installées (`npm install`)
3. Que le fichier `.env` est bien configuré
4. Que le bot a toutes les permissions nécessaires sur le serveur

